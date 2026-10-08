import { CollaborationTransport } from '../platform/collaboration-transport.ts';
import { sendCollaborationAsset } from '../platform/collaboration-assets.ts';
import { digestBytes } from '../platform/collaboration-media.ts';
import type { MediaManifest } from '../platform/collaboration-media.ts';
import { mediaErrorCode } from '../platform/media-diagnostics.ts';
import { CollaborationClient } from '../application/collaboration-client.ts';
import type { CollaborationMember } from '../application/collaboration-client.ts';
import { parseInvitation, COLLAB_ID } from '../core/collaboration.ts';
import { eventListAt } from '../application/event-commands.ts';
import { isTypingText } from './keyboard.ts';
import type { ShortcutTarget } from './keyboard.ts';
import { download } from '../platform/files.ts';
import { collaborationMarkerPosition, collaborationLabelBackground } from './collaboration-display.ts';
import type { Timeline, NoteHitEntry } from './timeline.ts';
import type { EditorSession } from '../application/session.ts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const button = (text: string, run: () => void): HTMLButtonElement => { const element = node('button', text); element.type = 'button'; element.onclick = run; return element; };
const input = (host: HTMLElement, text: string, type = 'text', value = ''): HTMLInputElement => { const label = node('label', text, 'field'); const field = node('input'); field.type = type; field.value = value; field.setAttribute('aria-label', text); label.append(field); host.append(label); return field; };
const hash = digestBytes;

/** The editor state the panel reads on every tick. */
export interface CollaborationContext {
  session: EditorSession;
  timeline: Timeline;
  interactionBusy: boolean;
  seconds: number;
  offset: number;
  duration: number;
  seek(seconds: number): void;
  sharedAssets(): [string, Uint8Array][];
}

export interface CollaborationPanelOptions {
  receiveChart: (chart: EditorSession['chart'], owner: boolean) => void;
  receiveAsset: (name: string, bytes: Uint8Array) => Promise<void>;
  notify: (message: string, level?: string, duration?: number) => void;
  activate: (pane: string) => void;
  confirmJoin: (run: () => void) => void;
}

/**
 * Views the client's room members as the shape the panel draws.
 *
 * The client types a member as open wire data — the server decides what extra fields ride along —
 * while the panel draws concrete ones (`name`, `color`, `presence`, `stats`) that the server always
 * sends. The two descriptions deliberately do not overlap, so the assertion is made once here rather
 * than at each use site.
 */
const panelMembers = (members: CollaborationMember[]): PanelMember[] => members as unknown as PanelMember[];

/** A collaborator's reported position and pointer, as sent over the presence channel. */
interface Presence {
  line: number;
  seconds: number;
  cursor?: { area: string; line: number; x: number; y?: number; beat?: number; layer?: number } | null;
  latency?: number;
}

/**
 * A member as the panel renders it.
 *
 * Declared standalone rather than extending the client's `CollaborationMember`: the client types a
 * member's `presence` as open wire data, while the panel needs the concrete fields it draws
 * (`line`, `seconds`, `cursor`). The two describe the same object at different levels of trust, and
 * the panel reads it only after the client has installed it.
 */
interface PanelMember {
  id: string;
  name: string;
  color: string;
  online?: boolean;
  host?: boolean;
  presence?: Presence;
  stats: { notes: number; events: number; operations: number };
}

/** One legacy chunked asset transfer being reassembled. */
interface AssetTransfer { chunks: Map<number, Uint8Array>; size: number; name: string; total: number; hash: string }

/** An incoming legacy asset chunk. */
interface AssetChunk {
  from?: string;
  transfer?: string;
  hash: string;
  name: string;
  total: number;
  index: number;
  data: string;
}

/** A `progress` event payload from the media layer. */
interface MediaProgress {
  phase: string;
  name?: string;
  bytes?: number;
  total?: number;
  sent?: number;
  seconds?: number;
  channel?: string;
  count?: number;
  skippedBytes?: number;
}

/** A chat entry as the panel renders it. */
interface PanelChat { name: string; color: string; text: string; time: number }

/** A toast element carrying its own dismissal timers. */
interface ToastElement extends HTMLDivElement { fadeTimer?: ReturnType<typeof setTimeout>; removeTimer?: ReturnType<typeof setTimeout> }

/** A collaborator marker carrying the member it belongs to. */
interface MarkerElement extends HTMLButtonElement { dataset: DOMStringMap }

/**
 * The collaboration side panel: room setup, member list, chat, and remote cursors.
 *
 * The panel is a thin view over `CollaborationClient`; it re-renders only when a cheap signature
 * changes, so the 100 ms tick can update cursor positions without rebuilding the DOM and stealing
 * focus or click handlers. Chat toasts each carry their own timers, so a new message never extends
 * the lifetime of an older one.
 */
export class CollaborationPanel {
  host: HTMLElement;
  context: () => CollaborationContext;
  receiveAsset: (name: string, bytes: Uint8Array) => Promise<void>;
  notify: (message: string, level?: string, duration?: number) => void;
  activate: (pane: string) => void;
  confirmJoin: (run: () => void) => void;
  transfers: Map<string, AssetTransfer>;
  transport: CollaborationTransport;
  client: CollaborationClient;
  cursors: HTMLElement;
  markers: HTMLElement;
  banner: HTMLElement;
  cursor: { area: string; line: number; x: number; y?: number; beat?: number; layer?: number } | null;
  timer!: ReturnType<typeof setInterval>;
  heartbeat?: number;
  lastLocks?: string;
  sharing?: boolean;
  chatSignature?: string;
  requestSignature?: string;
  userSignature?: string;
  status!: HTMLElement;
  assetStatus!: HTMLElement;
  requests!: HTMLElement;
  users!: HTMLElement;
  name!: HTMLInputElement;
  color!: HTMLInputElement;
  server!: HTMLInputElement;
  creationKey!: HTMLInputElement;
  invitation!: HTMLInputElement;
  acceptAssets!: HTMLInputElement;
  create!: HTMLButtonElement;
  join!: HTMLButtonElement;
  copy!: HTMLButtonElement;
  leave!: HTMLButtonElement;
  share!: HTMLButtonElement;
  recovery!: HTMLButtonElement;
  diagnostics!: HTMLButtonElement;
  chatBox!: HTMLDivElement;
  chatLog!: HTMLDivElement;
  chatInput!: HTMLInputElement;
  toast!: HTMLDivElement;

  constructor(host: HTMLElement, context: () => CollaborationContext, { receiveChart, receiveAsset, notify, activate, confirmJoin }: CollaborationPanelOptions) {
    this.host = host; this.context = context; this.receiveAsset = receiveAsset; this.notify = notify; this.activate = activate; this.confirmJoin = confirmJoin;
    this.cursor = null;
    this.transfers = new Map(); this.transport = new CollaborationTransport();
    this.client = new CollaborationClient(this.transport, { session: () => context().session, receiveChart, notify, interactionBusy: () => Boolean(context().timeline.drag || context().timeline.eventInteraction.drag || context().interactionBusy) });
    this.client.addEventListener('change', () => this.renderState());
    this.client.addEventListener('asset', event => { this.asset((event as CustomEvent<AssetChunk>).detail).catch(error => notify((error as Error).message, 'warning')); });
    this.client.addEventListener('asset-manifest', event => {
      if (!this.acceptAssets.checked) return;
      this.transport.media.receive((event as CustomEvent<MediaManifest>).detail, receiveAsset).catch(error => { this.assetStatus.textContent = (error as Error).message; notify((error as Error).message, 'warning'); });
    });
    this.transport.media.addEventListener('progress', event => this.mediaProgress((event as CustomEvent<MediaProgress>).detail));
    this.createForm(); this.createChat();
    this.cursors = node('div', '', 'collaboration-cursors'); document.body.append(this.cursors);
    this.markers = node('div', '', 'collaboration-markers'); this.markers.setAttribute('aria-label', '协作者时间位置'); document.querySelector('.scrubber-wrap')!.append(this.markers);
    this.banner = node('div', '', 'collaboration-banner'); document.querySelector('.stage')!.append(this.banner); this.banner.hidden = true;
    for (const [area, canvas] of [['notes', context().timeline.notesCanvas], ['events', context().timeline.eventsCanvas]] as [string, HTMLCanvasElement][]) {
      canvas.addEventListener('pointermove', event => this.pointer(event, canvas, area));
      canvas.addEventListener('pointerleave', () => { this.cursor = null; });
      canvas.addEventListener('pointerdown', event => {
        if (!this.client.active) return;
        const timeline = context().timeline; const point = timeline.point(event, canvas);
        // The two canvases hit-test to different shapes: the note canvas yields an indexed note
        // entry (`.item`), the event canvas an event rectangle (`.type`/`.index`). Branching here
        // keeps each lookup typed against the hit it actually came from.
        let item: unknown;
        if (area === 'notes') item = (timeline.hit(point) as NoteHitEntry | undefined)?.item;
        else {
          const hit = timeline.eventInteraction.hit(point);
          if (hit) item = eventListAt(context().session, hit.lineIndex ?? context().session.lineIndex, hit.type, timeline.layer)?.[hit.index];
        }
        const owner = item && this.client.locks.get((item as Record<string, unknown>)[COLLAB_ID]);
        if (owner && owner !== this.client.id || !this.client.ready) {
          event.preventDefault(); event.stopImmediatePropagation(); notify(owner ? '该物件正由其他人编辑' : '连接未就绪，编辑暂停', 'warning');
        }
      }, true);
    }
    const preview = document.querySelector<HTMLElement>('#preview')!;
    preview.addEventListener('pointermove', event => { const bounds = preview.getBoundingClientRect(); this.cursor = { area: 'preview', x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, line: context().session.lineIndex }; });
    preview.addEventListener('pointerleave', () => { this.cursor = null; });
    this.timer = setInterval(() => this.tick(), 100);
    window.addEventListener('beforeunload', event => { if (this.client.queue.length) { event.preventDefault(); event.returnValue = ''; } });
    const fragment = location.hash.startsWith('#collab=') ? location.href : null;
    if (fragment) { this.invitation.value = fragment; history.replaceState(null, '', location.pathname + location.search); }
  }
  createForm(): void {
    const title = node('h3', '联机协作'); this.host.append(title);
    const intro = node('p', '创建房间后复制邀请；伙伴粘贴邀请并等待房主批准。编辑自动同步，各自播放位置独立。', 'hint'); this.host.append(intro);
    this.name = input(this.host, '昵称', 'text', localStorage.getItem('rpe-collab-name') ?? '制谱者'); this.name.maxLength = 32;
    this.color = input(this.host, '我的远端鼠标颜色', 'color', localStorage.getItem('rpe-collab-color') ?? '#64dba5');
    this.server = input(this.host, '服务器地址', 'url', localStorage.getItem('rpe-collab-server') ?? 'ws://127.0.0.1:4182/collab');
    this.server.placeholder = '由维护者提供，通常为 wss://域名/collab';
    this.creationKey = input(this.host, '创建房间密钥（可选）', 'password');
    this.invitation = input(this.host, '粘贴邀请链接');
    this.acceptAssets = input(this.host, '接收房主发送的音乐和图片', 'checkbox'); this.acceptAssets.checked = false;
    this.transport.subscribeAssets(false);
    this.acceptAssets.onchange = () => this.transport.subscribeAssets(this.acceptAssets.checked);
    this.host.append(node('p', '勾选后自动接收房主最近发布的音乐和图片；以后发布的新一组也会自动接收。需要新版服务器。', 'hint'));
    const actions = node('div', '', 'collaboration-actions');
    this.create = button('创建房间', () => this.connect());
    this.join = button('加入邀请', () => this.confirmJoin(() => this.connect(true)));
    this.copy = button('复制邀请', async () => {
      try {
        const payload = encodeURIComponent(JSON.stringify({ server: this.client.server, room: this.client.room, token: this.client.token }));
        const invitation = `rpenext:${payload}`;
        await navigator.clipboard.writeText(invitation); this.invitation.value = invitation; this.notify('邀请已复制，房主批准后才能加入', 'success');
      } catch (error) { this.notify((error as Error).message, 'warning'); }
    });
    this.leave = button('离开房间', () => this.client.leave());
    this.share = button('发送本谱面引用的音乐和图片', () => this.shareAssets());
    this.recovery = button('导出冲突前本地副本', () => { if (this.client.recoveryChart) download(new Blob([JSON.stringify(this.client.recoveryChart)], { type: 'application/json' }), 'collaboration-recovery.json'); });
    this.diagnostics = button('导出联机诊断', () => download(new Blob([JSON.stringify({ format: 2, diagnosticBuild: 'media-local-route-v3', framed: true, mediaHttp: this.transport.mediaHttp === true, activeMedia: this.transport.media.diagnostics.snapshot(), entries: this.transport.diagnostics }, null, 2)], { type: 'text/plain' }), 'rpe-collaboration-diagnostics.log'));
    actions.append(this.create, this.join, this.copy, this.leave, this.share, this.recovery, this.diagnostics); this.host.append(actions);
    this.host.append(node('p', '诊断包含校验、请求、上传确认各阶段的耗时、文件序号与大小，每 10 秒记录仍在等待的阶段；不包含文件名、哈希值、谱面内容、昵称、服务器地址或邀请凭据。卡住时可直接导出。', 'hint'));
    this.status = node('p', '', 'hint'); this.status.setAttribute('role', 'status'); this.host.append(this.status);
    this.assetStatus = node('p', '', 'hint'); this.assetStatus.setAttribute('role', 'status'); this.host.append(this.assetStatus);
    this.requests = node('div'); this.host.append(this.requests);
    this.users = node('div', '', 'collaboration-users'); this.host.append(this.users);
    this.host.append(node('p', '传输：编辑操作经服务器可靠确认；鼠标优先 P2P，失败自动回退。昵称/颜色只保存在本机；邀请和密钥不写入设置。房间保留在服务器内存中，请正常保存或导出谱面。', 'hint'));
    this.renderState();
  }
  connect(joining = false): void {
    try {
      const invitation = joining ? parseInvitation(this.invitation.value) : null;
      const url = new URL(invitation?.server ?? this.server.value.trim());
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('请使用有效的 ws:// 或 wss:// 服务器地址');
      if (location.protocol === 'https:' && url.protocol !== 'wss:') throw new Error('在线 HTTPS 编辑器须使用 wss:// 公网入口');
      localStorage.setItem('rpe-collab-name', this.name.value); localStorage.setItem('rpe-collab-color', this.color.value); localStorage.setItem('rpe-collab-server', url.href);
      this.client.connect(url.href, { name: this.name.value, color: this.color.value }, invitation, this.creationKey.value); this.creationKey.value = '';
    } catch (error) { this.notify((error as Error).message, 'error'); }
  }
  renderState(): void {
    if (!this.status) return;
    const client = this.client; const active = Boolean(client.active); const host = client.id === client.host;
    this.create.disabled = active; this.join.disabled = active; this.name.disabled = active; this.color.disabled = active; this.server.disabled = active;
    this.copy.disabled = !client.ready; this.leave.disabled = !active; this.share.hidden = !active || !host; this.share.disabled = Boolean(this.sharing) || !client.ready;
    this.recovery.hidden = !client.recoveryChart;
    const direct = [...this.transport.peers.values()].filter(peer => peer.channel?.readyState === 'open').length;
    this.status.textContent = `${client.state}${active ? ` · ${client.latency ?? 0} ms · ${client.queue.length} 项待确认 · ${direct} 位鼠标直连` : ''}${client.ready ? this.transport.mediaHttp ? ' · 素材快速通道' : ' · 素材兼容通道（升级服务器可提速和自动补收）' : ''}`;
    const requestSignature = JSON.stringify([host, client.requests]);
    if (requestSignature !== this.requestSignature) {
      this.requestSignature = requestSignature; this.requests.replaceChildren();
      if (host) for (const request of client.requests) {
        const row = node('div', '', 'collaboration-user'); row.append(node('span', `${request.profile?.name} 请求加入`), button('允许', () => client.approve(request.request, true)), button('拒绝', () => client.approve(request.request, false))); this.requests.append(row);
      }
    }
    const signature = JSON.stringify(client.members.map(member => [member.id, member.online, member.stats, Math.round(Number(member.id === client.id ? client.latency ?? 0 : (member.presence?.latency ?? 0)) / 10)]));
    if (signature !== this.userSignature) {
      this.userSignature = signature; this.users.replaceChildren();
      for (const member of panelMembers(client.members)) {
        const row = node('div', '', 'collaboration-user'); const name = node('strong', `${member.name}${member.host ? ' · 房主' : ''}${member.id === client.id ? '（我）' : ''}`); name.style.color = member.color;
        row.append(name, node('span', `${member.online ? '在线' : '离线'} · ${Math.round(member.id === client.id ? client.latency ?? 0 : (member.presence?.latency ?? 0))} ms`), node('small', `本次操作涉及：音符 ${member.stats.notes} · 事件 ${member.stats.events} · 提交 ${member.stats.operations}`));
        if (host && member.id !== client.id) row.append(button('移出', () => this.transport.send({ type: 'kick', id: member.id })));
        this.users.append(row);
      }
    }
    if (this.chatLog) this.renderChat();
  }
  createChat(): void {
    this.chatBox = node('div', '', 'collaboration-chat'); this.chatBox.hidden = true;
    this.chatLog = node('div', '', 'collaboration-chat-log'); this.chatLog.setAttribute('role', 'log');
    this.chatInput = node('input'); this.chatInput.maxLength = 1000; this.chatInput.placeholder = 'Enter 发送 · Esc 关闭'; this.chatInput.setAttribute('aria-label', '联机聊天');
    this.chatBox.append(this.chatLog, this.chatInput); document.body.append(this.chatBox);
    window.addEventListener('keydown', event => this.handleChatKey(event), true);
    this.toast = node('div', '', 'collaboration-chat-toast'); this.toast.hidden = true; this.toast.setAttribute('role', 'log'); document.body.append(this.toast);
  }
  openChat(): void {
    this.chatBox.hidden = false; this.chatInput.focus(); this.chatLog.scrollTop = this.chatLog.scrollHeight;
    this.updateChatVisibility();
  }
  closeChat(): void {
    this.chatBox.hidden = true; this.chatInput.blur(); this.updateChatVisibility();
  }
  updateChatVisibility(): void {
    if (!this.toast) return;
    const visible = this.client.active && this.chatBox.hidden;
    this.toast.hidden = !visible;
    for (const message of this.toast.children as unknown as ToastElement[]) {
      clearTimeout(message.fadeTimer); clearTimeout(message.removeTimer);
      message.classList.remove('leaving');
      if (visible) message.fadeTimer = setTimeout(() => {
        message.classList.add('leaving');
        message.removeTimer = setTimeout(() => message.remove(), 1000);
      }, 5000);
    }
  }
  handleChatKey(event: KeyboardEvent): void {
    if (globalThis.document?.querySelector?.('dialog[open]')) return;
    if (!this.client.active || event.isComposing) return;
    if (event.key === 'Escape' && !this.chatBox.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); this.closeChat(); return;
    }
    if (event.target === this.chatInput) {
      event.stopImmediatePropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        try {
          if (this.chatInput.value.trim()) this.transport.send({ type: 'chat', text: this.chatInput.value });
          this.chatInput.value = ''; this.closeChat();
        } catch (error) { this.notify((error as Error).message, 'warning'); }
      }
    } else if (event.key === '/' && !isTypingText(event.target as ShortcutTarget | null) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation(); this.openChat();
    }
  }
  renderChat(): void {
    const signature = JSON.stringify(this.client.chat); if (signature === this.chatSignature) return;
    this.chatSignature = signature; this.chatLog.replaceChildren();
    for (const item of this.client.chat as PanelChat[]) { const row = node('div'); const name = node('strong', `${item.name}：`); name.style.color = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#fff'; row.append(name, node('span', item.text)); this.chatLog.append(row); }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    const last = (this.client.chat as PanelChat[]).at(-1);
    if (!last) {
      for (const message of this.toast.children as unknown as ToastElement[]) { clearTimeout(message.fadeTimer); clearTimeout(message.removeTimer); }
      this.toast.replaceChildren(); this.toast.hidden = true; return;
    }
    const message = node('div', `${last.name}：${last.text}`, 'collaboration-chat-message') as ToastElement; this.toast.append(message);
    while (this.toast.children.length > 5) {
      const oldest = this.toast.firstElementChild as ToastElement; clearTimeout(oldest.fadeTimer); clearTimeout(oldest.removeTimer); oldest.remove();
    }
    this.toast.hidden = !this.client.active || !this.chatBox.hidden;
    if (!this.toast.hidden) message.fadeTimer = setTimeout(() => {
      message.classList.add('leaving'); message.removeTimer = setTimeout(() => message.remove(), 1000);
    }, 5000);
  }
  pointer(event: PointerEvent, canvas: HTMLCanvasElement, area: string): void {
    const { timeline } = this.context(); const point = timeline.point(event, canvas); const line = timeline.lineIndexAt(point.x, canvas.clientWidth, area); const factor = timeline.factorForLine(line);
    const seconds = timeline.tempo.seconds(timeline.origin, factor) + (canvas.clientHeight - timeline.judgementOffset - point.y) / timeline.scale;
    const local = point.x - timeline.panelHorizontal(0, line, canvas.clientWidth, area);
    this.cursor = { area, line, beat: timeline.tempo.beat(seconds, factor), x: area === 'notes' ? timeline.notePositionAt(point.x, line) : local / timeline.panelWidth(canvas.clientWidth, area), layer: timeline.layer };
  }
  tick(): void {
    const { session, timeline, seconds, duration, seek } = this.context(); const client = this.client;
    client.finishInteraction();
    if (client.active && client.ready) {
      try {
        client.flush();
        this.transport.presence({ type: 'presence', seconds, line: session.lineIndex, cursor: this.cursor, latency: client.latency ?? 0 });
        if (!this.heartbeat || Date.now() - this.heartbeat > 3000) { this.transport.send({ type: 'ping', time: Date.now() }); this.transport.send({ type: 'locks', ids: client.selectionIds() }); this.heartbeat = Date.now(); }
        const locks = JSON.stringify(client.selectionIds()); if (locks !== this.lastLocks) { this.lastLocks = locks; this.transport.send({ type: 'locks', ids: JSON.parse(locks) as unknown }); }
      } catch {}
    }
    this.cursors.replaceChildren();
    const visibleMembers = panelMembers(client.members).filter(member => member.id !== client.id && member.online && member.presence).sort((left, right) => left.presence!.seconds - right.presence!.seconds);
    for (const marker of this.markers.children as unknown as MarkerElement[]) if (!visibleMembers.some(member => member.id === marker.dataset.member)) marker.remove();
    const selectedOwner = client.selectionIds().map(id => client.locks.get(id)).find(owner => owner && owner !== client.id);
    this.banner.hidden = !client.active || Boolean(client.ready && !selectedOwner);
    this.banner.textContent = selectedOwner ? `由 ${panelMembers(client.members).find(member => member.id === selectedOwner)?.name ?? '他人'} 编辑中 · 只读查看` : '联机编辑暂停 · 等待连接或房主恢复';
    const markerRows: number[] = [];
    const scrubber = document.querySelector<HTMLInputElement>('#scrubber')!; const track = scrubber.getBoundingClientRect(); const markerBounds = this.markers.getBoundingClientRect();
    for (const member of visibleMembers) {
      const presence = member.presence!; const label = `${member.name} 线:${presence.line}`;
      const position = track.left - markerBounds.left + collaborationMarkerPosition(presence.seconds, { offset: this.context().offset, minimum: Number(scrubber.min) || 0, maximum: Number(scrubber.max) || duration, width: track.width });
      let row = markerRows.findIndex(end => position - 65 > end); if (row < 0) row = markerRows.length; markerRows[row] = position + 65;
      let marker = [...this.markers.children].find(entry => (entry as MarkerElement).dataset.member === member.id) as MarkerElement | undefined;
      if (!marker) { marker = button(label, () => { const current = panelMembers(client.members).find(entry => entry.id === member.id)?.presence; if (current) seek(current.seconds); }) as MarkerElement; marker.dataset.member = member.id; this.markers.append(marker); }
      marker.textContent = label; marker.style.left = `${position}px`; marker.style.top = `${-row * 17}px`; marker.style.color = member.color; marker.style.backgroundColor = collaborationLabelBackground(member.color); marker.title = `${label} · ${presence.seconds.toFixed(2)} s`;
      const cursor = presence.cursor; if (!cursor || !Number.isFinite(cursor.x)) continue;
      if (cursor.area === 'preview' && Number.isFinite(cursor.y)) {
        const preview = document.querySelector<HTMLElement>('.preview-wrap')!.hidden ? document.querySelector<HTMLElement>('#realtime-preview')! : document.querySelector<HTMLElement>('#preview')!;
        const bounds = preview.getBoundingClientRect(); const pointer = node('div', `➤ ${label}`, 'collaboration-pointer'); pointer.style.color = member.color;
        pointer.style.opacity = Math.abs(presence.seconds - seconds) < 1 ? '1' : '.35';
        pointer.style.left = `${bounds.left + Math.max(0, Math.min(1, cursor.x)) * bounds.width}px`; pointer.style.top = `${bounds.top + Math.max(0, Math.min(1, cursor.y!)) * bounds.height}px`; this.cursors.append(pointer); continue;
      }
      if (!Number.isFinite(cursor.beat)) continue;
      const canvas = cursor.area === 'events' ? timeline.eventsCanvas : timeline.notesCanvas;
      const rectangle = canvas.getBoundingClientRect(); if (!rectangle.width || !rectangle.height) continue;
      const lineVisible = session.multiLineActive ? session.multiLineIndices.includes(cursor.line) && session.multiLineMode === cursor.area : cursor.line === session.lineIndex;
      const mappedLine = lineVisible ? cursor.line : session.lineIndex;
      const horizontal = cursor.area === 'notes' ? timeline.noteHorizontal(cursor.x, mappedLine) : timeline.panelHorizontal(cursor.x * timeline.panelWidth(rectangle.width, 'events'), mappedLine, rectangle.width, 'events');
      const vertical = timeline.verticalForLine(cursor.beat!, cursor.line, rectangle.height);
      const ownRange = [timeline.timeAt(rectangle.height), timeline.timeAt(0)];
      const timeVisible = presence.seconds >= Math.min(...ownRange) && presence.seconds <= Math.max(...ownRange);
      const inView = timeVisible && lineVisible && vertical >= 0 && vertical <= rectangle.height && horizontal >= 0 && horizontal <= rectangle.width;
      const pointer = node('div', `➤ ${label}`, 'collaboration-pointer'); pointer.style.color = member.color; pointer.style.opacity = inView ? '1' : '.35';
      pointer.style.left = `${rectangle.left + Math.max(2, Math.min(rectangle.width - 40, horizontal))}px`; pointer.style.top = `${rectangle.top + Math.max(2, Math.min(rectangle.height - 20, vertical))}px`; this.cursors.append(pointer);
    }
    if (!client.active) { this.chatBox.hidden = true; this.toast.hidden = true; }
  }
  async shareAssets(): Promise<void> {
    if (this.sharing) return;
    this.sharing = true; this.renderState();
    this.transport.trace?.('media-share-click', { channel: this.transport.mediaHttp ? 'http' : 'websocket' });
    try {
      const { sharedAssets } = this.context(); let count = 0;
      if (this.transport.mediaHttp) {
        const files = sharedAssets().filter(([name, bytes]) => /\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(name) && bytes.length > 0 && bytes.length <= 128 * 1024 * 1024);
        await this.transport.media.publish(files);
        this.notify('素材组已发布；勾选接收的成员及后来加入的成员将自动下载', 'success'); return;
      }
      for (const [name, bytes] of sharedAssets()) {
        if (!/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(name) || bytes.length > 128 * 1024 * 1024) continue;
        this.assetStatus.textContent = `正在后台校验：${name}`;
        const digest = await this.transport.media.hash(bytes, undefined, { direction: 'upload', fileIndex: count, kind: /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'audio' }); const started = performance.now();
        this.assetStatus.textContent = `正在发送：${name} · 等待接收确认`;
        const delivered = this.transport.media.diagnostics.start('legacy-delivery', { fileIndex: count, bytes: bytes.length });
        try { await sendCollaborationAsset(this.transport, name, bytes, digest, (sent, total) => {
          const speed = sent / Math.max(0.1, (performance.now() - started) / 1000) / 1048576;
          this.assetStatus.textContent = `发送 ${name} · ${Math.floor(sent / total * 100)}% · ${speed.toFixed(2)} MiB/s`;
        }); delivered(); } catch (error) { delivered('failed', { error: mediaErrorCode(error) }); throw error; }
        count++;
      }
      this.assetStatus.textContent = `已传输 ${count} 个引用素材，接收端会校验并载入`;
      this.notify(this.assetStatus.textContent, 'success');
    } catch (error) { this.transport.trace?.('media-share-failed', { error: mediaErrorCode(error) }); this.assetStatus.textContent = (error as Error).message; this.notify((error as Error).message, 'warning'); }
    finally { this.sharing = false; this.renderState(); }
  }
  mediaProgress(progress: MediaProgress): void {
    if (!this.assetStatus) return;
    if (progress.phase === 'hash') this.assetStatus.textContent = `正在校验：${progress.name}`;
    else if (progress.phase === 'prepare') this.assetStatus.textContent = '本地校验已完成，正在等待服务器准备上传…';
    else if (progress.phase === 'upload-fallback') this.assetStatus.textContent = 'HTTP 上传无进展，已切换备用通道续传…';
    else if (progress.phase === 'upload-transfer') this.assetStatus.textContent = `备用通道正在传输当前分片 · ${Math.floor((progress.sent ?? 0) / (progress.total ?? 1) * 100)}% · 等待服务器保存`;
    else if (progress.phase === 'upload' && !progress.bytes) this.assetStatus.textContent = progress.total ? '正在上传素材，等待首个分片确认…' : '服务器已有相同素材，准备发布…';
    else if (progress.phase === 'commit') this.assetStatus.textContent = '正在服务器校验并发布整组素材…';
    else if (progress.phase === 'verify') this.assetStatus.textContent = `正在校验 ${progress.name}…`;
    else if (progress.phase === 'published') this.assetStatus.textContent = `已发布 ${progress.count} 个素材 · 新成员可自动补收${progress.skippedBytes ? ' · 已复用相同文件' : ''}`;
    else if (progress.phase === 'received') this.assetStatus.textContent = `最近一组 ${progress.count} 个素材已就绪`;
    else {
      const speed = (progress.bytes ?? 0) / Math.max(0.1, progress.seconds ?? 0) / 1048576;
      this.assetStatus.textContent = `${progress.phase === 'upload-stream' ? '服务器接收中' : progress.phase === 'upload' ? '上传' : '下载'} ${progress.name} · ${Math.floor((progress.bytes ?? 0) / (progress.total ?? 1) * 100)}% · ${speed.toFixed(2)} MiB/s · ${progress.channel === 'socket' ? '备用联机通道' : progress.channel === 'local' ? '本机直连' : 'HTTP 4 路并发'}`;
    }
  }
  async asset(message: AssetChunk): Promise<void> {
    if (!this.acceptAssets.checked || message.from !== this.client.host) return;
    const key = message.transfer ?? message.hash;
    if (message.index === 0) for (const [id, entry] of this.transfers) if (id !== key && entry.name === message.name) this.transfers.delete(id);
    if (this.transfers.size > 8) this.transfers.clear();
    let transfer = this.transfers.get(key);
    if (!transfer) { transfer = { chunks: new Map(), size: 0, name: message.name, total: message.total, hash: message.hash }; this.transfers.set(key, transfer); }
    if (transfer.total !== message.total || transfer.name !== message.name || transfer.hash !== message.hash || transfer.chunks.has(message.index)) return;
    const bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0)); transfer.chunks.set(message.index, bytes); transfer.size += bytes.length;
    this.assetStatus.textContent = `接收 ${message.name} · ${Math.floor(transfer.chunks.size / transfer.total * 100)}% · ${(transfer.size / 1048576).toFixed(1)} MiB`;
    if (transfer.size > 128 * 1024 * 1024) { this.transfers.delete(key); throw new Error('接收素材超过 128 MiB，已停止'); }
    if (transfer.chunks.size !== transfer.total) return;
    const result = new Uint8Array(transfer.size); let offset = 0;
    for (let index = 0; index < transfer.total; index++) { const chunk = transfer.chunks.get(index)!; result.set(chunk, offset); offset += chunk.length; }
    this.transfers.delete(key); if (await hash(result) !== message.hash) throw new Error('素材校验失败，请重新发送');
    await this.receiveAsset(message.name, result); this.notify(`已接收素材：${message.name}`, 'success');
  }
}
