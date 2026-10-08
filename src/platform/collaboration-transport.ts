import { CollaborationMessageReader, CollaborationMessageSender, CollaborationSyncDeadline } from '../core/collaboration-wire.ts';
import type { FragmentAck, SendProgress, WireMessage } from '../core/collaboration-wire.ts';
import { CollaborationMedia } from './collaboration-media.ts';
import type { MediaManifest, SocketResume, SocketUpload } from './collaboration-media.ts';
import { assetBase64 } from './collaboration-assets.ts';

/** A member as the server lists it. */
interface TransportMember { id: string; online?: boolean }

/** One peer's WebRTC connection plus the candidates that arrived before its remote description. */
interface Peer {
  connection: RTCPeerConnection;
  candidates: RTCIceCandidateInit[];
  channel?: RTCDataChannel;
}

/** A pending asset delivery awaiting the recipients' acknowledgement. */
interface AssetReceipt {
  resolve: (value: AssetDeliveryResult) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The recipients' report for a delivered asset. */
interface AssetDeliveryResult { failed?: boolean; recipients?: number; [key: string]: unknown }

/** A pending chunk upload over the WebSocket fallback. */
interface MediaReceipt {
  finish: (error: unknown, result?: ChunkResult) => void;
  touch: () => void;
}

/** The server's confirmation of one chunk. */
interface ChunkResult { received: number; completed?: unknown[] }

/** A `welcome` frame, as far as this module reads it. */
interface WelcomeMessage extends WireMessage {
  chartAccepted?: boolean;
  mediaHttp?: boolean;
  mediaToken?: string;
  mediaSocketUpload?: boolean;
  mediaLocal?: { port?: unknown; proof?: unknown } | null;
  mediaSocketResume?: boolean;
  assetDelivery?: boolean;
  room?: string;
  invite?: string;
  resume?: unknown;
  host?: string;
  revision?: number;
}

/** A `media-upload-progress` frame. */
interface MediaProgressMessage extends WireMessage { phase?: string; channel?: string; index?: number; bytes?: number; total?: number }

/** A `media-upload-result` frame. */
interface MediaResultMessage extends WireMessage { request?: string; error?: string; status?: number; received?: number; completed?: unknown[] }

/** An `asset-delivered` frame. */
interface AssetDeliveredMessage extends WireMessage { delivery?: string }

/** A `signal` frame carrying one WebRTC description or candidate. */
interface SignalMessage extends WireMessage {
  from?: string;
  signal?: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
}

/** One entry of the exported diagnostic log. */
interface DiagnosticEntry { time: string; phase: string; [key: string]: unknown }

/**
 * Owns the collaboration WebSocket, the WebRTC presence mesh, and media transfer.
 *
 * Large frames are fragmented by `CollaborationMessageSender`/`Reader` and a sync deadline aborts a
 * connection that stops making progress, so a stalled transfer surfaces as a diagnosable timeout
 * rather than a hang. Presence is mirrored over unreliable data channels when a direct peer
 * connection exists, and always sent through the server as the fallback.
 */
export class CollaborationTransport extends EventTarget {
  peers: Map<string, Peer>;
  connected: boolean;
  closed: boolean;
  diagnostics: DiagnosticEntry[];
  assetReceipts: Map<string, AssetReceipt>;
  mediaReceipts: Map<string, MediaReceipt>;
  media: CollaborationMedia;
  retry?: ReturnType<typeof setTimeout>;
  syncDeadline: CollaborationSyncDeadline | null;
  sender: CollaborationMessageSender | null;
  socket: WebSocket | null;
  url?: string;
  hello: Record<string, unknown>;
  id?: string;
  mediaHttp: boolean;
  assetDelivery: boolean;
  acceptAssets?: boolean;

  constructor() {
    super(); this.peers = new Map(); this.connected = false; this.closed = false; this.diagnostics = []; this.assetReceipts = new Map(); this.mediaReceipts = new Map(); this.media = new CollaborationMedia();
    this.syncDeadline = null; this.sender = null; this.socket = null; this.hello = {}; this.mediaHttp = false; this.assetDelivery = false;
    this.media.addEventListener('diagnostic', event => { const { phase, ...details } = (event as CustomEvent<{ phase: string } & Record<string, unknown>>).detail; this.trace(phase, details); });
    this.media.addEventListener('progress', event => {
      const progress = (event as CustomEvent<Record<string, unknown>>).detail;
      if (['upload', 'download'].includes(String(progress.phase)) && progress.bytes === progress.total) this.trace(`media-${String(progress.phase)}-complete`, { bytes: progress.bytes, seconds: Number((progress.seconds as number).toFixed(2)), channel: progress.channel ?? 'http', concurrency: progress.channel === 'socket' ? 2 : 4 });
    });
  }
  trace(phase: string, details: Record<string, unknown> = {}): void {
    this.diagnostics.push({ time: new Date().toISOString(), phase, ...details });
    if (this.diagnostics.length > 2000) this.diagnostics.shift();
  }
  emit(type: string, detail: unknown): void { this.dispatchEvent(new CustomEvent(type, { detail })); }
  connect(url: string, hello: Record<string, unknown>): void {
    clearTimeout(this.retry);
    this.syncDeadline?.stop();
    this.cancelAssetTransfers(); this.media.close(); this.mediaHttp = false; this.assetDelivery = false;
    this.url = url; this.hello = { acceptOwnChart: true, ...hello }; this.closed = false;
    const socket = new WebSocket(url); this.socket = socket;
    const reader = new CollaborationMessageReader(receipt => socket.send(JSON.stringify(receipt)));
    let synchronized = false; let uploadPercent = -1; let downloadPercent = -1;
    const deadline = new CollaborationSyncDeadline(reason => {
      if (this.socket !== socket) return;
      this.trace('sync-timeout', { reason });
      this.emit('message', { type: 'error', message: reason === 'idle' ? '谱面同步已连续 60 秒没有进展，请检查网络或导出联机诊断' : '谱面同步超过 10 分钟，请检查网络或导出联机诊断' });
      socket.close();
    });
    this.syncDeadline = deadline;
    this.sender = new CollaborationMessageSender(socket, error => { this.trace('send-failed', { error: (error as Error).name }); socket.close(); }, progress => {
      if (this.socket !== socket) return;
      if (progress.type === 'media-upload') {
        for (const receipt of this.mediaReceipts.values()) receipt.touch();
        if (progress.sent % 16 === 0 || progress.sent === progress.total) {
          this.trace('media-socket-frames', { sent: progress.sent, total: progress.total });
          this.media.progress({ phase: 'upload-transfer', sent: progress.sent, total: progress.total });
        }
      }
      if (synchronized || !['create', 'join'].includes(String(progress.type))) return;
      deadline.progress();
      const percent = Math.floor(progress.sent / progress.total * 100);
      if (progress.type === 'create' && percent !== uploadPercent) {
        uploadPercent = percent;
        this.emit('state', percent === 100 ? '谱面已发送，等待服务器确认' : `正在发送谱面 ${percent}%`);
        if (percent % 10 === 0) this.trace('sync-sending', { sent: progress.sent, total: progress.total });
      }
    });
    this.trace('connect', { operation: hello.type, secure: url.startsWith('wss:'), acknowledgementWindow: 16, maximumWindow: 128 });
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.connected = true; this.trace('socket-open');
      deadline.start(); this.emit('state', '已连接，正在同步');
      try { this.send(this.hello); }
      catch (error) { this.trace('hello-failed', { error: (error as Error).name }); this.emit('message', { type: 'error', message: (error as Error).message }); socket.close(); }
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const message = reader.read(event.data);
        if (message?.type === '$rpeAck') { this.sender!.acknowledge(message as unknown as FragmentAck); return; }
        if (!synchronized) {
          if (!deadline.active) deadline.start(); else deadline.progress();
        }
        if (!message) {
          const percent = Math.floor(reader.parts.length / reader.total * 100);
          if (!synchronized && percent !== downloadPercent) { downloadPercent = percent; this.emit('state', `正在接收谱面 ${percent}%`); }
          if (reader.parts.length === 1 || reader.parts.length % 64 === 0) this.trace('sync-receiving', { parts: reader.parts.length, total: reader.total, bytes: reader.bytes });
          return;
        }
        const members = message.members as TransportMember[] | undefined;
        if (!['presence', 'locks', 'pong', 'signal', 'lock-result', 'media-upload-progress', 'media-upload-result'].includes(String(message.type))) this.trace('receive', { type: message.type, bytes: event.data.length, members: members?.length });
        if (['welcome', 'waiting', 'error'].includes(String(message.type))) deadline.stop();
        if (message.type === 'welcome') {
          const welcome = message as WelcomeMessage;
          if (welcome.chartAccepted) {
            if (this.hello.type !== 'create' || !this.hello.chart || welcome.id !== welcome.host || welcome.revision !== 0) throw new Error('谱面确认不匹配');
            welcome.chart = this.hello.chart;
          }
          synchronized = true;
          this.mediaHttp = welcome.mediaHttp === true;
          this.trace('media-channel', { binaryHttp: this.mediaHttp, socketUpload: welcome.mediaSocketUpload === true });
          if (this.mediaHttp) this.media.configure(url, welcome.room!, welcome.mediaToken!, welcome.mediaSocketUpload === true ? (chunk, signal) => this.uploadMediaChunk(chunk, signal) : null, welcome.id === welcome.host ? welcome.mediaLocal ?? null : null, welcome.mediaSocketResume === true ? ((upload, signal) => this.requestMediaUpload({ type: 'media-upload-resume', upload }, signal)) as SocketResume : null);
          this.assetDelivery = welcome.assetDelivery === true;
          if (this.assetDelivery && this.acceptAssets !== undefined) this.send({ type: 'asset-subscribe', enabled: this.acceptAssets });
          this.id = welcome.id as string;
          this.hello = { type: 'join', room: welcome.room, token: welcome.invite, resume: welcome.resume, profile: hello.profile };
        }
        if (message.type === 'media-upload-progress') {
          const progress = message as MediaProgressMessage;
          if (['accepted', 'receiving', 'writing', 'stored', 'failed'].includes(String(progress.phase)) && ['http', 'socket'].includes(String(progress.channel)) && [progress.index, progress.bytes, progress.total].every(value => Number.isSafeInteger(value) && Number(value) >= 0)) {
            this.trace(`media-server-${String(progress.phase)}`, { channel: progress.channel, index: progress.index, bytes: progress.bytes, total: progress.total });
            this.media.dispatchEvent(new CustomEvent('server-progress', { detail: progress }));
          }
          return;
        }
        if (message.type === 'media-upload-result') {
          const result = message as MediaResultMessage;
          const receipt = this.mediaReceipts.get(result.request!);
          if (receipt) {
            if (result.error) receipt.finish(Object.assign(new Error(result.error), { status: result.status }));
            else receipt.finish(null, { received: result.received!, completed: result.completed });
          }
          return;
        }
        if (message.type === 'asset-delivered') {
          const delivery = (message as AssetDeliveredMessage).delivery!;
          const receipt = this.assetReceipts.get(delivery);
          if (receipt) { clearTimeout(receipt.timer); this.assetReceipts.delete(delivery); receipt.resolve(message as unknown as AssetDeliveryResult); }
          return;
        }
        if (message.type === 'signal') { this.signal(message as SignalMessage).catch(() => this.dropPeer((message as SignalMessage).from!)); return; }
        if (message.type === 'members' || message.type === 'welcome') {
          try { this.updatePeers(members!); } catch (error) { this.trace('p2p-fallback', { error: (error as Error).name }); }
        }
        this.emit('message', message);
      } catch (error) { this.trace('decode-failed', { error: (error as Error).name }); this.emit('state', '收到无效消息，请导出联机诊断'); }
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      deadline.stop(); this.sender!.close(); this.cancelAssetTransfers(); this.media.close(); this.trace('socket-close', { code: event.code, clean: event.wasClean, pendingParts: reader.parts.length, receivedBytes: reader.bytes });
      this.connected = false; for (const id of this.peers.keys()) this.dropPeer(id);
      this.emit('state', event.code === 4003 ? '加入被拒绝或已被移出' : `连接已断开（${event.code}），编辑暂停`);
      if (!this.closed && this.hello.resume && event.code !== 4003 && event.code !== 4000) this.retry = setTimeout(() => this.connect(url, this.hello), 2500);
    };
    socket.onerror = () => { if (this.socket === socket) { this.trace('socket-error'); this.emit('state', '连接失败，请检查服务器地址或联系维护者'); } };
  }
  send(message: Record<string, unknown>): void {
    if (!this.connected || this.socket!.readyState !== WebSocket.OPEN) throw new Error('尚未连接，修改不会发送');
    this.sender!.send(message);
    if (['create', 'join', 'approve', 'edit'].includes(String(message.type))) this.trace('send', { type: message.type, bytes: new TextEncoder().encode(JSON.stringify(message)).byteLength });
  }
  subscribeAssets(enabled: unknown): void {
    this.acceptAssets = Boolean(enabled);
    if (!enabled) this.media.stopReceiving();
    if (this.connected && this.assetDelivery) this.send({ type: 'asset-subscribe', enabled: this.acceptAssets });
  }
  async sendAsset(message: Record<string, unknown>): Promise<void> {
    if (!this.connected) throw new Error('传输连接已关闭');
    if (!this.assetDelivery) { await this.sender!.sendAsync(message); return; }
    if (this.assetReceipts.size >= 4) throw new Error('素材发送窗口已满');
    const delivery = crypto.randomUUID();
    const result = await new Promise<AssetDeliveryResult>((resolve, reject) => {
      const timer = setTimeout(() => { this.assetReceipts.delete(delivery); reject(new Error('素材接收超过 60 秒没有确认，请检查接收者连接')); }, 60000);
      this.assetReceipts.set(delivery, { resolve, reject, timer });
      try { this.send({ ...message, delivery }); }
      catch (error) { clearTimeout(timer); this.assetReceipts.delete(delivery); reject(error); }
    });
    if (result.failed) throw new Error('部分接收者连接中断，请重新发送素材');
    if (!result.recipients) throw new Error('没有已开启接收素材的在线协作者');
  }
  cancelAssetTransfers(): void {
    for (const receipt of this.assetReceipts.values()) { clearTimeout(receipt.timer); receipt.reject(new Error('素材传输连接已关闭')); }
    this.assetReceipts.clear();
    for (const receipt of this.mediaReceipts.values()) receipt.finish(new Error('素材传输连接已关闭'));
  }
  uploadMediaChunk(chunk: { upload: string; hash: string; index: number; bytes: Uint8Array }, signal: AbortSignal): Promise<ChunkResult> {
    return this.requestMediaUpload({ type: 'media-upload', upload: chunk.upload, hash: chunk.hash, index: chunk.index, data: assetBase64(chunk.bytes) }, signal);
  }
  requestMediaUpload(message: Record<string, unknown>, signal: AbortSignal): Promise<ChunkResult> {
    signal.throwIfAborted();
    if (!this.connected) return Promise.reject(new Error('素材传输连接已关闭'));
    if (this.mediaReceipts.size >= 2) return Promise.reject(new Error('备用素材发送窗口已满'));
    const request = crypto.randomUUID();
    return new Promise<ChunkResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined; const started = Date.now();
      // `finish` deletes the receipt first, so a late timeout or abort after completion is a no-op.
      const finish = (error: unknown, result?: ChunkResult): void => {
        if (!this.mediaReceipts.delete(request)) return;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result!);
      };
      const abort = (): void => finish(signal.reason ?? new DOMException('操作已取消', 'AbortError'));
      const touch = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new DOMException('备用素材通道没有继续收到确认，请检查连接并导出诊断', 'TimeoutError')), Math.max(0, Math.min(60000, 600000 - (Date.now() - started))));
      };
      this.mediaReceipts.set(request, { finish, touch }); touch(); signal.addEventListener('abort', abort, { once: true });
      try { this.send({ ...message, request }); }
      catch (error) { finish(error); }
    });
  }
  presence(message: Record<string, unknown>): void {
    const frame = JSON.stringify({ ...message, type: 'presence', id: this.id });
    for (const peer of this.peers.values()) if (peer.channel?.readyState === 'open' && peer.channel.bufferedAmount < 16384) peer.channel.send(frame);
    this.send(message);
  }
  updatePeers(members: TransportMember[]): void {
    const online = new Set(members.filter(member => member.online && member.id !== this.id).map(member => member.id));
    for (const id of this.peers.keys()) if (!online.has(id)) this.dropPeer(id);
    if (typeof RTCPeerConnection === 'undefined') return;
    for (const id of online) if (!this.peers.has(id)) {
      const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
      const peer: Peer = { connection, candidates: [] }; this.peers.set(id, peer);
      connection.onicecandidate = event => { if (event.candidate && this.connected) this.send({ type: 'signal', to: id, signal: { candidate: event.candidate.toJSON() } }); };
      const attach = (channel: RTCDataChannel): void => {
        peer.channel = channel;
        channel.onmessage = event => {
          if (typeof event.data !== 'string' || event.data.length > 3000) return;
          try { const message = JSON.parse(event.data) as { type?: string }; if (message.type === 'presence') this.emit('message', { ...message, id, direct: true }); } catch {}
        };
      };
      connection.ondatachannel = event => attach(event.channel);
      if (this.id! < id) {
        attach(connection.createDataChannel('presence', { ordered: false, maxRetransmits: 0 }));
        connection.createOffer().then(offer => connection.setLocalDescription(offer)).then(() => this.send({ type: 'signal', to: id, signal: { description: connection.localDescription } })).catch(() => this.dropPeer(id));
      }
    }
  }
  async signal(message: SignalMessage): Promise<void> {
    const peer = this.peers.get(message.from!); if (!peer) return;
    const signal = message.signal!;
    if (signal.description) {
      await peer.connection.setRemoteDescription(signal.description);
      for (const candidate of peer.candidates.splice(0)) await peer.connection.addIceCandidate(candidate);
      if (signal.description.type === 'offer') {
        await peer.connection.setLocalDescription(await peer.connection.createAnswer());
        this.send({ type: 'signal', to: message.from, signal: { description: peer.connection.localDescription } });
      }
    } else if (signal.candidate) {
      if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(signal.candidate);
      else peer.candidates.push(signal.candidate);
    }
  }
  dropPeer(id: string): void { this.peers.get(id)?.connection.close(); this.peers.delete(id); }
  close(): void { this.closed = true; clearTimeout(this.retry); this.syncDeadline?.stop(); this.sender?.close(); this.cancelAssetTransfers(); this.media.close(); this.connected = false; const socket = this.socket; this.socket = null; socket?.close(); for (const id of this.peers.keys()) this.dropPeer(id); }
}
