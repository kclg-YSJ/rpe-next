import { COLLAB_ID, identifyChart, chartChanges, applyChanges, inverseChanges, changeResources, cleanProfile, validateData, validateIdentities, shareChartReferences } from '../core/collaboration.ts';
import type { ChartChange, CollaborationProfile } from '../core/collaboration.ts';
import { assertChart } from '../core/chart.ts';
import type { Chart } from '../core/types.ts';
import { eventListAt } from './event-commands.ts';
import { remapSelection, restoreSelection } from './selection-history.ts';
import type { SelectionState } from './selection-history.ts';
import type { EditorSession } from './session.ts';

/** One member of the shared room, as described by the server. */
export interface CollaborationMember {
  id: string;
  name?: string;
  online?: boolean;
  stats?: unknown;
  /** The member's last presence report, and when it arrived, used to place their cursor. */
  presence?: { line?: number; seconds?: number; cursor?: unknown } & Record<string, unknown>;
  directAt?: number;
  seen?: number;
  [key: string]: unknown;
}

/** A local edit awaiting server confirmation. */
export interface QueuedOperation {
  type: 'edit';
  operation: string;
  label: string;
  changes: ChartChange[];
  sent?: boolean;
  travel?: { direction: 'undo' | 'redo'; entry: { label: string; changes: ChartChange[] } };
}

/** A chat line as broadcast to the room. */
export interface ChatEntry {
  name: string;
  color: string;
  text: string;
  time: number;
  [key: string]: unknown;
}

/** One committed, invertible edit in the local undo/redo pair. */
interface HistoryEntry { label: string; changes: ChartChange[] }

/**
 * Installs the collaboration history stacks on the session.
 *
 * The two stacks are structurally different from `History`'s own `HistoryCommand` entries: `History`
 * snapshots a whole document (`before`/`after`), while collaboration records a change *set* against
 * the authoritative revision, because only the server's revision can say what an edit is relative to.
 * The shapes never coexist in one stack — while a collaboration client is attached, `session.travel`
 * delegates here, so `History.undo()`/`redo()` never see a change-set entry — which is why the
 * assignment is narrowed rather than unified into one type.
 */
function installHistory(session: EditorSession, undo: HistoryEntry[], redo: HistoryEntry[]): void {
  session.history.undoStack = undo as unknown as typeof session.history.undoStack;
  session.history.redoStack = redo as unknown as typeof session.history.redoStack;
}

/** An edit request awaiting the host's approval. */
interface JoinRequest { request: string; profile?: { name?: string }; [key: string]: unknown }

/** The transport surface this client drives, declared structurally so a test double can satisfy it. */
export interface CollaborationClientTransport extends EventTarget {
  connected?: boolean;
  connect(server: string, hello: Record<string, unknown>): void;
  send(message: Record<string, unknown>): void;
  close(): void;
  trace?(phase: string, details?: Record<string, unknown>): void;
}

/**
 * One message from the server.
 *
 * Fields are optional because the protocol is discriminated by `type` and the server only populates
 * the ones its message kind defines; each branch below asserts the fields it needs, matching the
 * upstream contract where the payload is trusted once `validateData` and `assertChart` have passed.
 * The index signature keeps genuinely protocol-specific extras (a member's presence fields, for
 * example) readable without widening the whole object to `any`.
 */
export interface WireMessage {
  type?: string;
  id?: string;
  host?: string;
  room?: string;
  invite?: string;
  chart?: Chart;
  revision?: number;
  members?: CollaborationMember[];
  chat?: ChatEntry[];
  locks?: { id: unknown; owner: unknown }[];
  conflicts?: unknown[];
  operation?: string;
  label?: string;
  changes?: ChartChange[];
  time?: number;
  seconds?: number;
  line?: number;
  direct?: boolean;
  stats?: unknown;
  message?: string;
  item?: ChatEntry;
  manifest?: unknown;
  [key: string]: unknown;
}

export interface CollaborationClientOptions {
  session: () => EditorSession;
  receiveChart: (chart: Chart, owner: boolean) => void;
  notify: (message: string, level?: string, duration?: number) => void;
  interactionBusy?: () => boolean;
}

/**
 * Keeps one shared document in step with the room.
 *
 * Local edits are applied optimistically and queued; when the server confirms one, the queue is
 * rebased on the authoritative revision, so a pending local edit survives someone else's concurrent
 * change. Undo and redo are the *confirmed* history only — an unconfirmed edit cannot be inverted
 * because the server may still reject it.
 */
export class CollaborationClient extends EventTarget {
  transport: CollaborationClientTransport;
  getSession: () => EditorSession;
  receiveChart: (chart: Chart, owner: boolean) => void;
  notify: (message: string, level?: string, duration?: number) => void;
  interactionBusy: () => boolean;
  queue: QueuedOperation[];
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  members: CollaborationMember[];
  locks: Map<unknown, unknown>;
  requests: JoinRequest[];
  chat: ChatEntry[];
  state: string;
  active!: boolean;
  id?: string;
  host?: string;
  room?: string;
  token?: string;
  server?: string;
  profile?: CollaborationProfile;
  authoritative?: Chart | null;
  deferred?: Chart | null;
  recoveryChart?: Chart;
  recovery?: QueuedOperation[];
  revision?: number;
  latency?: number;
  session?: EditorSession;

  constructor(transport: CollaborationClientTransport, { session, receiveChart, notify, interactionBusy = () => false }: CollaborationClientOptions) {
    super(); this.transport = transport; this.getSession = session; this.receiveChart = receiveChart; this.notify = notify;
    this.interactionBusy = interactionBusy;
    this.queue = []; this.undo = []; this.redo = []; this.members = []; this.locks = new Map(); this.requests = []; this.chat = []; this.state = '未连接';
    transport.addEventListener('message', event => this.message((event as CustomEvent).detail));
    transport.addEventListener('state', event => { this.state = (event as CustomEvent).detail; this.changed(); });
  }
  changed(): void { this.dispatchEvent(new Event('change')); }
  connect(server: string, profile: { name?: unknown; color?: unknown }, invitation: { server?: string; room?: string; token?: string } | null = null, creationKey = ''): void {
    this.queue = []; this.undo = []; this.redo = []; this.requests = []; this.chat = []; this.authoritative = null; this.deferred = null;
    this.profile = cleanProfile(profile); this.server = server;
    const chart = invitation ? null : identifyChart(this.getSession().chart);
    try { this.transport.connect(server, invitation ? { type: 'join', ...invitation, profile: this.profile } : { type: 'create', chart, profile: this.profile, creationKey }); }
    catch (error) { this.active = false; this.state = '连接未建立'; this.changed(); throw error; }
    this.active = true;
    this.session = this.getSession(); this.session.collaboration = this;
    this.state = '连接中'; this.changed();
  }
  get ready(): boolean | undefined { return this.active && this.transport.connected && Boolean(this.authoritative) && this.members.some(member => member.id === this.host && member.online); }
  attach(session: EditorSession): void { session.collaboration = this; this.session = session; this.syncHistory(); }
  syncHistory(): void { if (this.session) installHistory(this.session, this.undo, this.redo); }
  setChart(chart: Chart, local = false): void {
    const session = this.session!; const source = session.chart; const selection = session.selectionState();
    const shared = shareChartReferences(source, chart);
    session.history.document = shared;
    if (!local) restoreSelection(session, remapSelection(source, shared, selection));
    this.syncHistory(); session.notify();
  }
  commit(label: string, chart: Chart): void {
    try {
      if (!this.ready) throw new Error('联机尚未就绪或房主离线，编辑暂停');
      const next = identifyChart(chart); const changes = chartChanges(this.session!.chart, next); if (!changes.length) return;
      for (const change of changes) for (const id of changeResources(change)) {
        const owner = this.locks.get(id); if (owner && owner !== this.id) throw new Error(`该物件由 ${this.members.find(member => member.id === owner)?.name ?? '其他用户'} 编辑中`);
      }
      const operation: QueuedOperation = { type: 'edit', operation: crypto.randomUUID(), label, changes };
      this.queue.push(operation); this.setChart(next, true); this.flush(); this.changed();
    } catch (error) { this.notify((error as Error).message, 'warning'); this.session!.notify(); }
  }
  flush(): void {
    const first = this.queue[0];
    if (!first || first.sent || !this.ready) return;
    this.transport.send({ type: 'edit', operation: first.operation, label: first.label, changes: first.changes }); first.sent = true;
  }
  travel(direction: 'undo' | 'redo'): void {
    if (this.queue.length) { this.notify('等待本次修改同步完成后再撤销', 'warning'); return; }
    const entry = (direction === 'undo' ? this.undo : this.redo).at(-1); if (!entry) return;
    try {
      const changes = direction === 'undo' ? inverseChanges(entry.changes) : entry.changes;
      const next = applyChanges(this.session!.chart, changes);
      this.commit(`${direction === 'undo' ? '撤销' : '重做'}：${entry.label}`, next);
      if (this.queue.length) this.queue.at(-1)!.travel = { direction, entry };
    } catch (error) { this.notify(`无法覆盖他人的后续修改：${(error as Error).message}`, 'warning'); }
  }
  /**
   * Handles one server message.
   *
   * Every branch validates what it is about to install — the chart, the identities, the lock map — and
   * any failure tears the connection down rather than leaving a half-applied document, because a
   * partially synchronised chart is worse than a disconnected one.
   */
  message(message: WireMessage): void {
    try {
      if (message.type === 'welcome') {
        validateData(message.chart); assertChart(message.chart); validateIdentities(message.chart);
        this.id = message.id; this.host = message.host; this.room = message.room; this.token = message.invite;
        // The fields below are non-null-asserted rather than defaulted: `welcome` always carries them,
        // and the upstream code read them directly, so a default here would mask a malformed frame.
        const reconnect = Boolean(this.authoritative); this.authoritative = message.chart; this.revision = message.revision; this.members = message.members!; this.chat = message.chat!;
        this.locks = new Map(message.locks!.map(lock => [lock.id, lock.owner]));
        if (!reconnect) { this.receiveChart(message.chart, this.id === this.host); this.attach(this.getSession()); this.undo = []; this.redo = []; this.setChart(message.chart); }
        else {
          this.recoveryChart = this.queue.length ? structuredClone(this.session!.chart) : this.recoveryChart;
          this.setChart(message.chart);
          const pending = this.queue.splice(0);
          if (pending.length) this.notify('重连已恢复最新谱面；未确认操作已保留为本地恢复副本', 'warning');
          this.recovery = pending;
        }
        this.state = '已连接'; this.syncHistory();
        if (!reconnect) this.notify('已加入联机房间：按 / 打开聊天，Enter 发送，Esc 关闭', 'success', 6000);
      } else if (message.type === 'members') this.members = message.members!;
      else if (message.type === 'locks') this.locks = new Map(message.locks!.map(lock => [lock.id, lock.owner]));
      else if (message.type === 'lock-result' && message.conflicts!.length) this.notify('选中内容正由其他人编辑，暂不可修改', 'warning');
      else if (message.type === 'waiting') this.state = '等待房主批准';
      else if (message.type === 'request') this.requests.push(message as JoinRequest);
      else if (message.type === 'pong') this.latency = Math.max(0, Date.now() - message.time!);
      else if (message.type === 'presence') {
        const member = this.members.find(member => member.id === message.id);
        if (member && Number.isFinite(message.seconds) && Number.isInteger(message.line)) {
          if (message.direct) member.directAt = performance.now();
          if (message.direct || performance.now() - (member.directAt ?? -10000) > 1500) member.presence = message;
          member.seen = performance.now();
        }
      } else if (message.type === 'chat') { this.chat.push(message.item!); if (this.chat.length > 100) this.chat.shift(); }
      else if (message.type === 'edit') {
        if (message.revision! <= (this.revision ?? -1)) return;
        const next = applyChanges(this.authoritative!, message.changes!); assertChart(next); validateIdentities(next); this.authoritative = next; this.revision = message.revision;
        const own = this.queue.find(entry => entry.operation === message.operation);
        if (own) {
          this.queue = this.queue.filter(entry => entry !== own);
          if (own.travel) {
            const { direction, entry } = own.travel;
            (direction === 'undo' ? this.undo : this.redo).pop(); (direction === 'undo' ? this.redo : this.undo).push(entry);
          } else { this.undo.push({ label: own.label, changes: own.changes }); this.redo = []; if (this.undo.length > 150) this.undo.shift(); }
        }
        const member = this.members.find(member => member.id === message.id); if (member) member.stats = message.stats;
        this.rebase();
      } else if (message.type === 'rejected') {
        this.recoveryChart = structuredClone(this.session!.chart);
        this.recovery = [...this.queue]; this.queue = []; this.authoritative = message.chart!; this.revision = message.revision;
        this.setChart(message.chart!); this.notify(message.message!, 'warning');
      } else if (message.type === 'error') this.notify(message.message!, 'error');
      else if (message.type === 'asset') this.dispatchEvent(new CustomEvent('asset', { detail: message }));
      else if (message.type === 'asset-manifest') this.dispatchEvent(new CustomEvent('asset-manifest', { detail: message.manifest }));
      this.changed();
    } catch (error) { this.transport.trace?.('apply-failed', { type: message.type, error: (error as Error).name }); this.state = '同步异常，已暂停'; this.transport.close(); this.notify((error as Error).message, 'error'); this.changed(); }
  }
  rebase(): void {
    let chart = this.authoritative!;
    try { for (const pending of this.queue) chart = applyChanges(chart, pending.changes); }
    catch { this.recoveryChart = structuredClone(this.session!.chart); this.recovery = [...this.queue]; this.queue = []; chart = this.authoritative!; this.notify('操作与他人修改冲突，已恢复确认版本', 'warning'); }
    if (this.interactionBusy()) this.deferred = chart; else { this.deferred = null; this.setChart(chart); }
    this.flush();
  }
  finishInteraction(): void { if (this.deferred && !this.interactionBusy()) { this.deferred = null; this.rebase(); } }
  selectionIds(): unknown[] {
    const session = this.session; if (!session) return [];
    const ids: unknown[] = session.selectedNoteEntries().map(entry => entry.note?.[COLLAB_ID]);
    // `multiEventSelection` holds sets; the single-line path is given the same shape so both branches
    // iterate identically, which is what the upstream code did with a plain array.
    const groups: Map<number, Iterable<string>> = session.multiLineActive && session.multiLineMode === 'events' ? session.multiEventSelection : new Map([[session.lineIndex, session.eventSelection]]);
    for (const [line, keys] of groups) for (const key of keys) {
      const [type, index] = key.split(':');
      ids.push(eventListAt(session, line, type as Parameters<typeof eventListAt>[2])?.[Number(index)]?.[COLLAB_ID]);
    }
    return [...new Set(ids.filter(Boolean))];
  }
  approve(request: string, allow: boolean): void { this.transport.send({ type: 'approve', request, allow }); this.requests = this.requests.filter(entry => entry.request !== request); this.changed(); }
  leave(): void {
    this.active = false; this.transport.close();
    if (this.session) {
      this.session.collaboration = null;
      if (this.authoritative) { this.session.history.undoStack = []; this.session.history.redoStack = []; }
      this.session.notify();
    }
    this.authoritative = null; this.deferred = null; this.queue = []; this.members = []; this.requests = []; this.chat = []; this.locks.clear(); this.state = '已离开，当前谱面保留在本地'; this.changed();
  }
}
