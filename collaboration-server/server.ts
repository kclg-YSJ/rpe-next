import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { applyChanges, changeResources, cleanProfile, COLLAB_PROTOCOL, validateData, validateIdentities, validateNewEventOverlaps } from '../src/core/collaboration.ts';
import type { ChartChange, CollaborationProfile } from '../src/core/collaboration.ts';
import { assertChart } from '../src/core/chart.ts';
import { CollaborationMessageReader, CollaborationMessageSender, CollaborationSyncDeadline } from '../src/core/collaboration-wire.ts';
import type { MessageSocket, WireMessage } from '../src/core/collaboration-wire.ts';
import { CollaborationAssetStore } from './asset-store.ts';
import type { MediaMember, MediaRoom, MediaSocket } from './asset-store.ts';
import type { Chart } from '../src/core/types.ts';

const token = (): string => randomBytes(24).toString('base64url');

/** A socket the server can address: the accepted `ws` socket plus the sender it installs. */
interface SendableSocket extends MediaSocket {
  close(code?: number, reason?: string): void;
  terminate(): void;
}

/** The extra state the server hangs off each accepted socket. */
interface ServerSocket extends SendableSocket {
  sender: CollaborationMessageSender;
  alive: boolean;
  assetDeliveries?: number;
  ping(): void;
  extensions: string;
}

interface SocketMessage extends Record<string, unknown> {
  type?: string;
  id?: string;
  room?: string;
  token?: string;
  resume?: string;
  operation?: string;
  request?: string;
  changes?: ChartChange[];
  chart?: Chart;
  profile?: { name?: unknown; color?: unknown } | null;
  acceptOwnChart?: boolean;
}

interface Member extends MediaMember {
  id: string;
  resume: string;
  profile: CollaborationProfile;
  socket: ServerSocket | null;
  stats: { notes: number; events: number; operations: number };
  presence: Presence | null;
  receiveAssets?: boolean;
}

interface Presence {
  seconds: number;
  line: number;
  cursor?: unknown;
  latency: number;
}

interface PendingJoin {
  socket: ServerSocket;
  profile: CollaborationProfile;
  approve: () => void;
  created: number;
}

interface Lock { owner: string; expires: number }

interface ChatItem { id: string; name: string; color: string; text: string; time: number }

interface Room extends MediaRoom {
  id: string;
  invite: string;
  chart: Chart;
  revision: number;
  members: Map<string, Member>;
  locks: Map<string, Lock>;
  pending: Map<string, PendingJoin>;
  chat: ChatItem[];
  accepted: Map<string, number>;
  host: string;
  touched: number;
}

/** The JSON-safe view of a member the server broadcasts. */
interface MemberView extends CollaborationProfile {
  id: string;
  online: boolean;
  host: boolean;
  stats: Member['stats'];
  presence: Presence | null;
}

interface LockView { id: string; owner: string }

interface ServerOptions {
  port?: number;
  host?: string;
  maxRooms?: number;
  maxMembers?: number;
  onStatus?: (status: { rooms: number; users: number }) => void;
  onDiagnostic?: (entry: Record<string, unknown>) => void;
  creationKey?: string;
}

export interface CollaborationService {
  port: number;
  rooms: Map<string, Room>;
  close: () => Promise<void>;
}

const send = (socket: MediaSocket | SendableSocket | null | undefined, message: WireMessage): void => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  try { (socket as ServerSocket).sender.send(message); } catch { (socket as SendableSocket).close(1013, '同步过慢，请重连'); }
};

export async function startCollaborationServer({ port = 4182, host = '127.0.0.1', maxRooms = 20, maxMembers = 12, onStatus = () => {}, onDiagnostic = () => {}, creationKey = '' }: ServerOptions = {}): Promise<CollaborationService> {
  const rooms = new Map<string, Room>();
  const localMediaProof = randomBytes(32);
  const assetStore = await CollaborationAssetStore.create({ onDiagnostic, onUploadProgress: (member, progress) => send(member.socket, { type: 'media-upload-progress', ...progress }) });
  const publishAssets = (room: MediaRoom, manifest: unknown): void => {
    for (const member of room.members.values()) if (member.id !== room.host && member.receiveAssets === true) send(member.socket, { type: 'asset-manifest', manifest });
  };
  const http: HttpServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const url = request.url ?? '';
    if (request.method === 'GET' && /^\/collab\/media\/local\/[0-9a-f]{32}$/.test(url)) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.end(JSON.stringify({ signature: createHmac('sha256', localMediaProof).update(url.split('/').at(-1) ?? '').digest('hex') }));
    } else if (url.startsWith('/collab/media/')) {
      assetStore.handle(request, response, rooms as unknown as Map<string, MediaRoom>, publishAssets).catch(() => { if (!response.headersSent) response.writeHead(500); response.end('{}'); });
    } else if (request.method === 'GET' && url === '/health') { response.end(JSON.stringify({ service: 'RPE Next 协作', protocol: COLLAB_PROTOCOL })); }
    else { response.writeHead(404); response.end('{}'); }
  });
  const wss = new WebSocketServer({ server: http, path: '/collab', maxPayload: 64 * 1024 * 1024, perMessageDeflate: {
    serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4, threshold: 1024, zlibDeflateOptions: { level: 3 }
  } });
  const status = (): void => onStatus({ rooms: rooms.size, users: [...rooms.values()].reduce((sum, room) => sum + [...room.members.values()].filter(member => member.socket?.readyState === WebSocket.OPEN).length, 0) });
  const broadcast = (room: Room, message: WireMessage, except: string | null = null): void => { for (const member of room.members.values()) if (member.id !== except) send(member.socket, message); };
  const members = (room: Room): MemberView[] => [...room.members.values()].map(member => ({ id: member.id, ...member.profile, online: member.socket?.readyState === WebSocket.OPEN, host: member.id === room.host, stats: member.stats, presence: member.presence }));
  const publishMembers = (room: Room): void => { broadcast(room, { type: 'members', members: members(room) }); status(); };
  const locks = (room: Room): LockView[] => [...room.locks].map(([id, lock]) => ({ id, owner: lock.owner }));
  const publishLocks = (room: Room): void => broadcast(room, { type: 'locks', locks: locks(room) });
  const welcome = (room: Room, member: Member, chartAccepted = false): void => {
    member.mediaToken ??= token();
    const address = http.address() as AddressInfo | null;
    send(member.socket, { type: 'welcome', protocol: COLLAB_PROTOCOL, mediaHttp: true, mediaSocketUpload: true, mediaSocketResume: true, mediaLocal: member.id === room.host && address ? { port: address.port, proof: localMediaProof.toString('hex') } : undefined, mediaToken: member.mediaToken, assetDelivery: true, chartAccepted, id: member.id, resume: member.resume, room: room.id, invite: room.invite, host: room.host, chart: chartAccepted ? undefined : room.chart, revision: room.revision, members: members(room), locks: locks(room), chat: room.chat });
    onDiagnostic({ phase: 'welcome-queued', members: room.members.size, chartAccepted, compression: member.socket?.extensions.includes('permessage-deflate') });
    publishMembers(room);
  };
  const memberFor = (socket: ServerSocket, profile: unknown): Member => ({ id: token(), resume: token(), profile: cleanProfile(profile as { name?: unknown; color?: unknown } | null | undefined), socket, stats: { notes: 0, events: 0, operations: 0 }, presence: null });
  wss.on('connection', (accepted: WebSocket) => {
    const socket = accepted as unknown as ServerSocket;
    const reader = new CollaborationMessageReader(receipt => socket.send(JSON.stringify(receipt)));
    socket.sender = new CollaborationMessageSender(socket as unknown as MessageSocket, (error: unknown) => { onDiagnostic({ phase: 'send-failed', error: error instanceof Error ? error.name : 'Error' }); socket.close(1011); });
    onDiagnostic({ phase: 'socket-open' });
    socket.alive = true; accepted.on('pong', () => { socket.alive = true; });
    let room: Room | undefined; let member: Member | undefined; let pendingRoom: Room | undefined;
    let windowStart = Date.now(); let count = 0; let bytes = 0; let stateCount = 0; let lastRateNotice = -Infinity;
    const deadline = new CollaborationSyncDeadline(reason => {
      onDiagnostic({ phase: 'sync-timeout', reason, pendingParts: reader.parts.length, receivedBytes: reader.bytes });
      socket.close(1008, reason === 'idle' ? '同步空闲超时' : '同步总时限');
    });
    deadline.start();
    accepted.on('error', () => {});
    accepted.on('message', (raw: Buffer) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; bytes = 0; stateCount = 0; }
        if ((bytes += raw.length) > 70 * 1024 * 1024) { socket.close(1008, '消息流量超限'); return; }
        const message = reader.read(raw.toString()) as SocketMessage | null; socket.alive = true;
        if (message?.type === '$rpeAck') { socket.sender.acknowledge({ type: '$rpeAck', id: Number(message.id), received: Number(message.received) }); return; }
        deadline.progress();
        if (!message) {
          if (reader.parts.length === 1 || reader.parts.length % 64 === 0) onDiagnostic({ phase: 'sync-receiving', parts: reader.parts.length, total: reader.total, bytes: reader.bytes });
          return;
        }
        const type = message.type;
        if (member && ['presence', 'ping', 'locks'].includes(type ?? '')) {
          if (++stateCount > 60) return;
        } else if (++count > 100) {
          if (Date.now() - lastRateNotice >= 5000) {
            lastRateNotice = Date.now(); onDiagnostic({ phase: 'request-rate-limited' });
            send(socket, { type: 'error', code: 'RATE_LIMIT', message: '消息发送过于频繁，请稍后重试' });
          }
          return;
        }
        validateData(message);
        if (['create', 'join', 'approve'].includes(type ?? '')) onDiagnostic({ phase: 'receive', type, bytes });
        if (!member) {
          if (pendingRoom) throw new Error('等待房主批准');
          if (type === 'create') {
            if (creationKey && message.creationKey !== creationKey) throw new Error('创建密钥不正确，请向服务器维护者获取');
            if (rooms.size >= maxRooms) throw new Error('服务器房间已满');
            const chart = message.chart;
            assertChart(chart); validateIdentities(chart);
            const created: Room = { id: token(), invite: token(), chart, revision: 0, members: new Map(), locks: new Map(), pending: new Map(), chat: [], accepted: new Map(), touched: Date.now(), host: '' };
            const hostMember = memberFor(socket, message.profile); created.host = hostMember.id; created.members.set(hostMember.id, hostMember); member = hostMember; room = created; rooms.set(created.id, created);
            welcome(created, hostMember, message.acceptOwnChart === true);
          } else if (type === 'join') {
            const target = rooms.get(typeof message.room === 'string' ? message.room : '');
            if (!target || target.invite !== message.token) throw new Error('房间不存在或邀请已失效');
            room = target;
            const previous = [...target.members.values()].find(entry => message.resume && entry.resume === message.resume);
            if (previous) { previous.socket?.close(4000, '已重新连接'); member = previous; previous.socket = socket; welcome(target, previous); }
            else {
              if (target.members.size + target.pending.size >= maxMembers) throw new Error('房间人数已满');
              if (target.members.get(target.host)?.socket?.readyState !== WebSocket.OPEN) throw new Error('房主离线，请稍后加入');
              pendingRoom = target; const request = token();
              target.pending.set(request, { socket, profile: cleanProfile(message.profile), approve: () => { const approved = memberFor(socket, message.profile); target.members.set(approved.id, approved); member = approved; pendingRoom = undefined; welcome(target, approved); }, created: Date.now() });
              send(socket, { type: 'waiting' });
              send(target.members.get(target.host)?.socket, { type: 'request', request, profile: cleanProfile(message.profile) });
            }
          } else throw new Error('请先创建或加入房间');
          if (member || pendingRoom) deadline.stop();
          return;
        }
        const currentRoom = room;
        if (!currentRoom) throw new Error('请先创建或加入房间');
        const self: Member = member;
        currentRoom.touched = Date.now();
        if (type === 'ping') { send(socket, { type: 'pong', time: message.time }); return; }
        if (type === 'approve' && self.id === currentRoom.host) {
          const request = typeof message.request === 'string' ? message.request : '';
          const pending = currentRoom.pending.get(request); if (!pending) return;
          currentRoom.pending.delete(request);
          if (message.allow) pending.approve(); else { send(pending.socket, { type: 'error', message: '房主拒绝了加入请求' }); pending.socket.close(4003); }
        } else if (type === 'kick' && self.id === currentRoom.host && message.id !== currentRoom.host) {
          const target = currentRoom.members.get(typeof message.id === 'string' ? message.id : ''); if (!target) return;
          target.socket?.close(4003, '已被房主移出'); currentRoom.members.delete(target.id);
          for (const [id, lock] of currentRoom.locks) if (lock.owner === target.id) currentRoom.locks.delete(id);
          publishMembers(currentRoom); publishLocks(currentRoom);
        } else if (type === 'presence') {
          self.presence = { seconds: Number(message.seconds) || 0, line: Math.max(0, Math.trunc(Number(message.line) || 0)), cursor: message.cursor, latency: Math.max(0, Math.min(60000, Number(message.latency) || 0)) };
          if (JSON.stringify(self.presence).length > 2000) throw new Error('光标数据过大');
          broadcast(currentRoom, { type: 'presence', id: self.id, ...self.presence }, self.id);
        } else if (type === 'signal') {
          if (JSON.stringify(message.signal).length > 32768) throw new Error('连接信息过大');
          send(currentRoom.members.get(typeof message.to === 'string' ? message.to : '')?.socket, { type: 'signal', from: self.id, signal: message.signal });
        } else if (type === 'locks') {
          const requested = new Set<string>(Array.isArray(message.ids) ? (message.ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 50000) : []);
          const conflicts = [...requested].filter(id => currentRoom.locks.has(id) && currentRoom.locks.get(id)?.owner !== self.id);
          for (const [id, lock] of currentRoom.locks) if (lock.owner === self.id && !requested.has(id)) currentRoom.locks.delete(id);
          if (!conflicts.length) for (const id of requested) currentRoom.locks.set(id, { owner: self.id, expires: Date.now() + 12000 });
          send(socket, { type: 'lock-result', conflicts }); publishLocks(currentRoom);
        } else if (type === 'edit') {
          const operation = typeof message.operation === 'string' ? message.operation : '';
          if (currentRoom.accepted.has(operation)) { send(socket, { type: 'receipt', operation }); return; }
          try {
            if (currentRoom.members.get(currentRoom.host)?.socket?.readyState !== WebSocket.OPEN) throw new Error('房主离线，编辑已暂停');
            if (typeof message.operation !== 'string' || message.operation.length > 100) throw new Error('操作编号无效');
            const changes: ChartChange[] = Array.isArray(message.changes) ? message.changes as ChartChange[] : [];
            for (const change of changes) for (const id of changeResources(change)) {
              const lock = currentRoom.locks.get(String(id)); if (lock && lock.owner !== self.id) throw new Error(`该物件由 ${currentRoom.members.get(lock.owner)?.profile.name ?? '其他用户'} 编辑中`);
            }
            const next = applyChanges(currentRoom.chart, changes); assertChart(next); validateIdentities(next); validateNewEventOverlaps(currentRoom.chart, next);
            currentRoom.chart = next; currentRoom.revision++;
            currentRoom.accepted.set(operation, currentRoom.revision); if (currentRoom.accepted.size > 3000) { const oldest = currentRoom.accepted.keys().next().value; if (oldest !== undefined) currentRoom.accepted.delete(oldest); }
            self.stats.operations++;
            for (const change of changes) {
              if (change.path.includes('notes')) self.stats.notes++;
              else if (change.path.some(key => typeof key === 'string' && (key.endsWith('Events') || key === 'effects'))) self.stats.events++;
            }
            broadcast(currentRoom, { type: 'edit', id: self.id, operation, changes, label: String(message.label ?? '联机编辑').slice(0, 80), revision: currentRoom.revision, stats: self.stats });
          } catch (error) { send(socket, { type: 'rejected', operation, message: error instanceof Error ? error.message : '编辑失败', chart: currentRoom.chart, revision: currentRoom.revision }); }
        } else if (type === 'chat') {
          const text = String(message.text ?? '').trim().slice(0, 1000); if (!text) return;
          const item: ChatItem = { id: self.id, name: self.profile.name, color: self.profile.color, text, time: Date.now() };
          currentRoom.chat.push(item); if (currentRoom.chat.length > 100) currentRoom.chat.shift(); broadcast(currentRoom, { type: 'chat', item });
        } else if (type === 'asset-subscribe') {
          self.receiveAssets = message.enabled === true;
          const manifest = assetStore.manifest(currentRoom.id);
          if (self.receiveAssets && self.id !== currentRoom.host && manifest) send(socket, { type: 'asset-manifest', manifest });
        } else if (type === 'media-upload' || type === 'media-upload-resume') {
          if (typeof message.request !== 'string' || !/^[0-9a-f-]{36}$/.test(message.request)) throw new Error('素材请求编号无效');
          const request = message.request;
          const uploading = type === 'media-upload'
            ? assetStore.uploadSocket(currentRoom, self, { upload: String(message.upload), hash: String(message.hash), index: Number(message.index), data: String(message.data) })
            : assetStore.resumeUpload(currentRoom, self, String(message.upload));
          uploading.then(
            result => send(socket, { type: 'media-upload-result', request, ...result }),
            (error: Error & { status?: number }) => send(socket, { type: 'media-upload-result', request, error: error.status ? error.message : '素材写入失败，请重试', status: error.status ?? 500 })
          );
        } else if (type === 'asset') {
          if (self.id !== currentRoom.host) throw new Error('仅房主可发送共享素材');
          if (message.transfer !== undefined && (typeof message.transfer !== 'string' || message.transfer.length > 80)) throw new Error('素材传输标识无效');
          if (typeof message.name !== 'string' || message.name.length > 256 || /(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)/.test(message.name) || !/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(message.name)) throw new Error('素材名称或格式不允许');
          if (!Number.isInteger(message.index) || !Number.isInteger(message.total) || Number(message.total) < 1 || Number(message.total) > 8192 || Number(message.index) < 0 || Number(message.index) >= Number(message.total) || typeof message.data !== 'string' || message.data.length > 350000 || !/^[0-9a-f]{64}$/.test(String(message.hash)) || message.delivery !== undefined && (typeof message.delivery !== 'string' || message.delivery.length > 80)) throw new Error('素材块无效');
          const recipients = [...currentRoom.members.values()].filter(entry => entry.id !== self.id && entry.receiveAssets !== false && entry.socket?.readyState === WebSocket.OPEN) as (Member & { socket: ServerSocket })[];
          if (message.delivery) {
            if ((socket.assetDeliveries ?? 0) >= 8) throw new Error('素材发送窗口已满');
            socket.assetDeliveries = (socket.assetDeliveries ?? 0) + 1;
            const pending = recipients.map(entry => entry.socket.sender.sendAsync({ ...message, type: 'asset', from: self.id }));
            Promise.allSettled(pending).then(results => {
              socket.assetDeliveries = (socket.assetDeliveries ?? 1) - 1;
              send(socket, { type: 'asset-delivered', delivery: message.delivery, recipients: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length });
            });
          } else for (const recipient of recipients) send(recipient.socket, { ...message, type: 'asset', from: self.id });
        } else throw new Error('不支持的消息或无权限');
      } catch (error) { onDiagnostic({ phase: 'request-failed', error: error instanceof Error ? error.name : 'Error' }); send(socket, { type: 'error', message: String(error instanceof Error ? error.message : error).slice(0, 180) }); }
    });
    accepted.on('close', (code: number) => {
      socket.sender.close(); onDiagnostic({ phase: 'socket-close', code, pendingParts: reader.parts.length, receivedBytes: reader.bytes });
      deadline.stop();
      if (pendingRoom) for (const [id, pending] of pendingRoom.pending) if (pending.socket === socket) pendingRoom.pending.delete(id);
      if (!member || member.socket !== socket || !room) return;
      member.socket = null; room.touched = Date.now();
      for (const [id, lock] of room.locks) if (lock.owner === member.id) room.locks.delete(id);
      publishMembers(room); publishLocks(room);
    });
  });
  const timer = setInterval(() => {
    for (const [id, room] of rooms) {
      let changed = false;
      for (const [key, lock] of room.locks) if (lock.expires < Date.now()) { room.locks.delete(key); changed = true; }
      if (changed) publishLocks(room);
      for (const [key, pending] of room.pending) if (Date.now() - pending.created > 60000) { pending.socket.close(4003, '批准超时'); room.pending.delete(key); }
      if (![...room.members.values()].some(member => member.socket) && Date.now() - room.touched > 30 * 60 * 1000) { rooms.delete(id); assetStore.remove(id).catch(() => {}); }
    }
    status();
  }, 3000);
  timer.unref();
  const heartbeat = setInterval(() => { for (const client of wss.clients) { const socket = client as unknown as ServerSocket; if (!socket.alive) { onDiagnostic({ phase: 'heartbeat-timeout' }); socket.terminate(); } else { socket.alive = false; socket.ping(); } } }, 15000); heartbeat.unref();
  try { await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(port, host, () => resolve()); }); }
  catch (error) { clearInterval(timer); clearInterval(heartbeat); await assetStore.close(); throw error; }
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => { clearInterval(timer); clearInterval(heartbeat); for (const socket of wss.clients) socket.terminate(); http.closeAllConnections(); await new Promise<void>(resolve => wss.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); await assetStore.close(); })();
  return { port: (http.address() as AddressInfo).port, rooms, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await startCollaborationServer({ port: Number(process.env.RPE_COLLAB_PORT ?? 4182), host: process.env.RPE_COLLAB_HOST ?? '127.0.0.1', creationKey: process.env.RPE_COLLAB_KEY ?? '' });
  console.log(`RPE Next 协作服务已启动：ws://127.0.0.1:${service.port}/collab`);
  process.on('SIGINT', async () => { await service.close(); process.exit(0); });
}
