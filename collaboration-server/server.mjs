import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { applyChanges, changeResources, cleanProfile, COLLAB_ID, COLLAB_PROTOCOL, validateData, validateIdentities, validateNewEventOverlaps } from '../src/core/collaboration.ts';
import { assertChart } from '../src/core/chart.ts';
import { CollaborationMessageReader, CollaborationMessageSender, CollaborationSyncDeadline } from '../src/core/collaboration-wire.ts';
import { CollaborationAssetStore } from './asset-store.mjs';

const token = () => randomBytes(24).toString('base64url');
const send = (socket, message) => {
  if (socket?.readyState !== WebSocket.OPEN) return;
  try { socket.sender.send(message); } catch { socket.close(1013, '同步过慢，请重连'); }
};

export async function startCollaborationServer({ port = 4182, host = '127.0.0.1', maxRooms = 20, maxMembers = 12, onStatus = () => {}, onDiagnostic = () => {}, creationKey = '' } = {}) {
  const rooms = new Map();
  const localMediaProof = randomBytes(32);
  const assetStore = await CollaborationAssetStore.create({ onDiagnostic, onUploadProgress: (member, progress) => send(member.socket, { type: 'media-upload-progress', ...progress }) });
  const publishAssets = (room, manifest) => {
    for (const member of room.members.values()) if (member.id !== room.host && member.receiveAssets === true) send(member.socket, { type: 'asset-manifest', manifest });
  };
  const http = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && /^\/collab\/media\/local\/[0-9a-f]{32}$/.test(request.url ?? '')) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.end(JSON.stringify({ signature: createHmac('sha256', localMediaProof).update(request.url.split('/').at(-1)).digest('hex') }));
    } else if (request.url?.startsWith('/collab/media/')) {
      assetStore.handle(request, response, rooms, publishAssets).catch(() => { if (!response.headersSent) response.writeHead(500); response.end('{}'); });
    } else if (request.method === 'GET' && request.url === '/health') { response.end(JSON.stringify({ service: 'RPE Next 协作', protocol: COLLAB_PROTOCOL })); }
    else { response.writeHead(404); response.end('{}'); }
  });
  const wss = new WebSocketServer({ server: http, path: '/collab', maxPayload: 64 * 1024 * 1024, perMessageDeflate: {
    serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4, threshold: 1024, zlibDeflateOptions: { level: 3 }
  } });
  const status = () => onStatus({ rooms: rooms.size, users: [...rooms.values()].reduce((sum, room) => sum + [...room.members.values()].filter(member => member.socket?.readyState === WebSocket.OPEN).length, 0) });
  const broadcast = (room, message, except = null) => { for (const member of room.members.values()) if (member.id !== except) send(member.socket, message); };
  const members = room => [...room.members.values()].map(member => ({ id: member.id, ...member.profile, online: member.socket?.readyState === WebSocket.OPEN, host: member.id === room.host, stats: member.stats, presence: member.presence }));
  const publishMembers = room => { broadcast(room, { type: 'members', members: members(room) }); status(); };
  const locks = room => [...room.locks].map(([id, lock]) => ({ id, owner: lock.owner }));
  const publishLocks = room => broadcast(room, { type: 'locks', locks: locks(room) });
  const welcome = (room, member, chartAccepted = false) => {
    member.mediaToken ??= token();
    send(member.socket, { type: 'welcome', protocol: COLLAB_PROTOCOL, mediaHttp: true, mediaSocketUpload: true, mediaSocketResume: true, mediaLocal: member.id === room.host ? { port: http.address().port, proof: localMediaProof.toString('hex') } : undefined, mediaToken: member.mediaToken, assetDelivery: true, chartAccepted, id: member.id, resume: member.resume, room: room.id, invite: room.invite, host: room.host, chart: chartAccepted ? undefined : room.chart, revision: room.revision, members: members(room), locks: locks(room), chat: room.chat });
    onDiagnostic({ phase: 'welcome-queued', members: room.members.size, chartAccepted, compression: Boolean(member.socket.extensions.includes('permessage-deflate')) });
    publishMembers(room);
  };
  const memberFor = (socket, profile) => ({ id: token(), resume: token(), profile: cleanProfile(profile), socket, stats: { notes: 0, events: 0, operations: 0 }, presence: null });
  wss.on('connection', socket => {
    const reader = new CollaborationMessageReader(receipt => socket.send(JSON.stringify(receipt)));
    socket.sender = new CollaborationMessageSender(socket, error => { onDiagnostic({ phase: 'send-failed', error: error.name }); socket.close(1011); });
    onDiagnostic({ phase: 'socket-open' });
    socket.alive = true; socket.on('pong', () => { socket.alive = true; });
    let room; let member; let pendingRoom; let windowStart = Date.now(); let count = 0; let bytes = 0; let stateCount = 0; let lastRateNotice = -Infinity;
    const deadline = new CollaborationSyncDeadline(reason => {
      onDiagnostic({ phase: 'sync-timeout', reason, pendingParts: reader.parts.length, receivedBytes: reader.bytes });
      socket.close(1008, reason === 'idle' ? '同步空闲超时' : '同步总时限');
    });
    deadline.start();
    socket.on('error', () => {});
    socket.on('message', raw => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; bytes = 0; stateCount = 0; }
        if ((bytes += raw.length) > 70 * 1024 * 1024) { socket.close(1008, '消息流量超限'); return; }
        const message = reader.read(raw.toString()); socket.alive = true;
        if (message?.type === '$rpeAck') { socket.sender.acknowledge(message); return; }
        deadline.progress();
        if (!message) {
          if (reader.parts.length === 1 || reader.parts.length % 64 === 0) onDiagnostic({ phase: 'sync-receiving', parts: reader.parts.length, total: reader.total, bytes: reader.bytes });
          return;
        }
        if (member && ['presence', 'ping', 'locks'].includes(message.type)) {
          if (++stateCount > 60) return;
        } else if (++count > 100) {
          if (Date.now() - lastRateNotice >= 5000) {
            lastRateNotice = Date.now(); onDiagnostic({ phase: 'request-rate-limited' });
            send(socket, { type: 'error', code: 'RATE_LIMIT', message: '消息发送过于频繁，请稍后重试' });
          }
          return;
        }
        validateData(message);
        if (['create', 'join', 'approve'].includes(message.type)) onDiagnostic({ phase: 'receive', type: message.type, bytes });
        if (!member) {
          if (pendingRoom) throw new Error('等待房主批准');
          if (message.type === 'create') {
            if (creationKey && message.creationKey !== creationKey) throw new Error('创建密钥不正确，请向服务器维护者获取');
            if (rooms.size >= maxRooms) throw new Error('服务器房间已满');
            assertChart(message.chart); validateIdentities(message.chart);
            room = { id: token(), invite: token(), chart: message.chart, revision: 0, members: new Map(), locks: new Map(), pending: new Map(), chat: [], accepted: new Map(), touched: Date.now() };
            member = memberFor(socket, message.profile); room.host = member.id; room.members.set(member.id, member); rooms.set(room.id, room); welcome(room, member, message.acceptOwnChart === true);
          } else if (message.type === 'join') {
            room = rooms.get(message.room);
            if (!room || room.invite !== message.token) throw new Error('房间不存在或邀请已失效');
            const previous = [...room.members.values()].find(entry => message.resume && entry.resume === message.resume);
            if (previous) { previous.socket?.close(4000, '已重新连接'); member = previous; member.socket = socket; welcome(room, member); }
            else {
              if (room.members.size + room.pending.size >= maxMembers) throw new Error('房间人数已满');
              if (room.members.get(room.host)?.socket?.readyState !== WebSocket.OPEN) throw new Error('房主离线，请稍后加入');
              pendingRoom = room; const request = token();
              room.pending.set(request, { socket, profile: cleanProfile(message.profile), approve: () => { member = memberFor(socket, message.profile); room.members.set(member.id, member); pendingRoom = null; welcome(room, member); }, created: Date.now() });
              send(socket, { type: 'waiting' }); send(room.members.get(room.host).socket, { type: 'request', request, profile: cleanProfile(message.profile) });
            }
          } else throw new Error('请先创建或加入房间');
          if (member || pendingRoom) deadline.stop();
          return;
        }
        room.touched = Date.now();
        if (message.type === 'ping') { send(socket, { type: 'pong', time: message.time }); return; }
        if (message.type === 'approve' && member.id === room.host) {
          const pending = room.pending.get(message.request); if (!pending) return;
          room.pending.delete(message.request);
          if (message.allow) pending.approve(); else { send(pending.socket, { type: 'error', message: '房主拒绝了加入请求' }); pending.socket.close(4003); }
        } else if (message.type === 'kick' && member.id === room.host && message.id !== room.host) {
          const target = room.members.get(message.id); if (!target) return;
          target.socket?.close(4003, '已被房主移出'); room.members.delete(target.id);
          for (const [id, lock] of room.locks) if (lock.owner === target.id) room.locks.delete(id);
          publishMembers(room); publishLocks(room);
        } else if (message.type === 'presence') {
          member.presence = { seconds: Number(message.seconds) || 0, line: Math.max(0, Math.trunc(Number(message.line) || 0)), cursor: message.cursor, latency: Math.max(0, Math.min(60000, Number(message.latency) || 0)) };
          if (JSON.stringify(member.presence).length > 2000) throw new Error('光标数据过大');
          broadcast(room, { type: 'presence', id: member.id, ...member.presence }, member.id);
        } else if (message.type === 'signal') {
          if (JSON.stringify(message.signal).length > 32768) throw new Error('连接信息过大');
          send(room.members.get(message.to)?.socket, { type: 'signal', from: member.id, signal: message.signal });
        } else if (message.type === 'locks') {
          const requested = new Set(Array.isArray(message.ids) ? message.ids.filter(id => typeof id === 'string').slice(0, 50000) : []);
          const conflicts = [...requested].filter(id => room.locks.has(id) && room.locks.get(id).owner !== member.id);
          for (const [id, lock] of room.locks) if (lock.owner === member.id && !requested.has(id)) room.locks.delete(id);
          if (!conflicts.length) for (const id of requested) room.locks.set(id, { owner: member.id, expires: Date.now() + 12000 });
          send(socket, { type: 'lock-result', conflicts }); publishLocks(room);
        } else if (message.type === 'edit') {
          if (room.accepted.has(message.operation)) { send(socket, { type: 'receipt', operation: message.operation }); return; }
          try {
            if (room.members.get(room.host)?.socket?.readyState !== WebSocket.OPEN) throw new Error('房主离线，编辑已暂停');
            if (typeof message.operation !== 'string' || message.operation.length > 100) throw new Error('操作编号无效');
            for (const change of message.changes ?? []) for (const id of changeResources(change)) {
              const lock = room.locks.get(id); if (lock && lock.owner !== member.id) throw new Error(`该物件由 ${room.members.get(lock.owner)?.profile.name ?? '其他用户'} 编辑中`);
            }
            const next = applyChanges(room.chart, message.changes); assertChart(next); validateIdentities(next); validateNewEventOverlaps(room.chart, next);
            room.chart = next; room.revision++;
            room.accepted.set(message.operation, room.revision); if (room.accepted.size > 3000) room.accepted.delete(room.accepted.keys().next().value);
            member.stats.operations++;
            for (const change of message.changes) {
              if (change.path.includes('notes')) member.stats.notes++;
              else if (change.path.some(key => typeof key === 'string' && (key.endsWith('Events') || key === 'effects'))) member.stats.events++;
            }
            broadcast(room, { type: 'edit', id: member.id, operation: message.operation, changes: message.changes, label: String(message.label ?? '联机编辑').slice(0, 80), revision: room.revision, stats: member.stats });
          } catch (error) { send(socket, { type: 'rejected', operation: message.operation, message: error.message, chart: room.chart, revision: room.revision }); }
        } else if (message.type === 'chat') {
          const text = String(message.text ?? '').trim().slice(0, 1000); if (!text) return;
          const item = { id: member.id, name: member.profile.name, color: member.profile.color, text, time: Date.now() };
          room.chat.push(item); if (room.chat.length > 100) room.chat.shift(); broadcast(room, { type: 'chat', item });
        } else if (message.type === 'asset-subscribe') {
          member.receiveAssets = message.enabled === true;
          const manifest = assetStore.manifest(room.id);
          if (member.receiveAssets && member.id !== room.host && manifest) send(socket, { type: 'asset-manifest', manifest });
        } else if (message.type === 'media-upload' || message.type === 'media-upload-resume') {
          if (typeof message.request !== 'string' || !/^[0-9a-f-]{36}$/.test(message.request)) throw new Error('素材请求编号无效');
          const uploading = message.type === 'media-upload' ? assetStore.uploadSocket(room, member, message) : assetStore.resumeUpload(room, member, message.upload);
          uploading.then(
            result => send(socket, { type: 'media-upload-result', request: message.request, ...result }),
            error => send(socket, { type: 'media-upload-result', request: message.request, error: error.status ? error.message : '素材写入失败，请重试', status: error.status ?? 500 })
          );
        } else if (message.type === 'asset') {
          if (member.id !== room.host) throw new Error('仅房主可发送共享素材');
          if (message.transfer !== undefined && (typeof message.transfer !== 'string' || message.transfer.length > 80)) throw new Error('素材传输标识无效');
          if (typeof message.name !== 'string' || message.name.length > 256 || /(^[/\\]|(^|[/\\])\.\.([/\\]|$)|:)/.test(message.name) || !/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(message.name)) throw new Error('素材名称或格式不允许');
          if (!Number.isInteger(message.index) || !Number.isInteger(message.total) || message.total < 1 || message.total > 8192 || message.index < 0 || message.index >= message.total || typeof message.data !== 'string' || message.data.length > 350000 || !/^[0-9a-f]{64}$/.test(message.hash) || message.delivery !== undefined && (typeof message.delivery !== 'string' || message.delivery.length > 80)) throw new Error('素材块无效');
          const recipients = [...room.members.values()].filter(entry => entry.id !== member.id && entry.receiveAssets !== false && entry.socket?.readyState === WebSocket.OPEN);
          if (message.delivery) {
            if ((socket.assetDeliveries ?? 0) >= 8) throw new Error('素材发送窗口已满');
            socket.assetDeliveries = (socket.assetDeliveries ?? 0) + 1;
            const pending = recipients.map(entry => entry.socket.sender.sendAsync({ ...message, type: 'asset', from: member.id }));
            Promise.allSettled(pending).then(results => {
              socket.assetDeliveries--;
              send(socket, { type: 'asset-delivered', delivery: message.delivery, recipients: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length });
            });
          } else for (const recipient of recipients) send(recipient.socket, { ...message, type: 'asset', from: member.id });
        } else throw new Error('不支持的消息或无权限');
      } catch (error) { onDiagnostic({ phase: 'request-failed', error: error.name }); send(socket, { type: 'error', message: String(error.message).slice(0, 180) }); }
    });
    socket.on('close', code => {
      socket.sender.close(); onDiagnostic({ phase: 'socket-close', code, pendingParts: reader.parts.length, receivedBytes: reader.bytes });
      deadline.stop();
      if (pendingRoom) for (const [id, pending] of pendingRoom.pending) if (pending.socket === socket) pendingRoom.pending.delete(id);
      if (!member || member.socket !== socket) return;
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
  const heartbeat = setInterval(() => { for (const socket of wss.clients) { if (!socket.alive) { onDiagnostic({ phase: 'heartbeat-timeout' }); socket.terminate(); } else { socket.alive = false; socket.ping(); } } }, 15000); heartbeat.unref();
  try { await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, resolve); }); }
  catch (error) { clearInterval(timer); clearInterval(heartbeat); await assetStore.close(); throw error; }
  let closing;
  const close = () => closing ??= (async () => { clearInterval(timer); clearInterval(heartbeat); for (const socket of wss.clients) socket.terminate(); http.closeAllConnections(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => http.close(resolve)); await assetStore.close(); })();
  return { port: http.address().port, rooms, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await startCollaborationServer({ port: Number(process.env.RPE_COLLAB_PORT ?? 4182), host: process.env.RPE_COLLAB_HOST ?? '127.0.0.1', creationKey: process.env.RPE_COLLAB_KEY ?? '' });
  console.log(`RPE Next 协作服务已启动：ws://127.0.0.1:${service.port}/collab`);
  process.on('SIGINT', async () => { await service.close(); process.exit(0); });
}
