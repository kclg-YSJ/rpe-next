import { t } from '../i18n.mjs';
const frameSize = 8192;
const maxMessageBytes = 64 * 1024 * 1024;
const encoder = new TextEncoder();

export class CollaborationSyncDeadline {
  constructor(onTimeout, { idleMilliseconds = 60000, totalMilliseconds = 600000 } = {}) {
    this.onTimeout = onTimeout; this.idleMilliseconds = idleMilliseconds; this.totalMilliseconds = totalMilliseconds; this.active = false;
  }
  start() { this.started = Date.now(); this.active = true; this.progress(); }
  progress() {
    if (!this.active) return;
    clearTimeout(this.timer);
    const remaining = this.totalMilliseconds - (Date.now() - this.started);
    const totalLimit = remaining <= this.idleMilliseconds;
    this.timer = setTimeout(() => { this.active = false; this.onTimeout(totalLimit ? 'total' : 'idle'); }, Math.max(0, Math.min(this.idleMilliseconds, remaining)));
  }
  stop() { this.active = false; clearTimeout(this.timer); }
}

export function encodeCollaborationMessage(message, id = 0) {
  const text = JSON.stringify(message);
  if (encoder.encode(text).byteLength > maxMessageBytes) throw new Error(t('collaboration-wire.scca0c58'));
  if (text.length <= frameSize) return [text];
  const total = Math.ceil(text.length / frameSize);
  return Array.from({ length: total }, (_, index) => JSON.stringify({ type: '$rpeFrame', id, index, total, data: text.slice(index * frameSize, (index + 1) * frameSize) }));
}

export class CollaborationMessageReader {
  constructor(acknowledge = () => {}) { this.acknowledge = acknowledge; this.reset(); }
  reset() { this.parts = []; this.bytes = 0; this.total = 0; this.id = null; }
  read(text) {
    const message = JSON.parse(text);
    if (message?.type === '$rpeAck') return message;
    if (message?.type !== '$rpeFrame') {
      if (this.parts.length) throw new Error(t('collaboration-wire.sb1d432f'));
      return message;
    }
    const { id, index, total, data } = message;
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 0) || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > Math.ceil(maxMessageBytes / frameSize) || index !== this.parts.length || index >= total || typeof data !== 'string' || data.length > frameSize || this.total && (total !== this.total || id !== this.id)) throw new Error(t('collaboration-wire.s7f9fd79'));
    this.bytes += encoder.encode(data).byteLength;
    if (this.bytes > maxMessageBytes) { this.reset(); throw new Error(t('collaboration-wire.s887a9be')); }
    this.total = total; this.id = id; this.parts.push(data);
    if (id !== undefined) this.acknowledge({ type: '$rpeAck', id, received: this.parts.length });
    if (this.parts.length < total) return null;
    const result = JSON.parse(this.parts.join('')); this.reset(); return result;
  }
}

export class CollaborationMessageSender {
  constructor(socket, onError = () => {}, onProgress = () => {}) { this.socket = socket; this.onError = onError; this.onProgress = onProgress; this.queue = []; this.bytes = 0; this.closed = false; this.nextId = 0; this.window = 16; this.maximumWindow = 128; this.growAt = 16; }
  send(message) { this.enqueue(message); }
  sendAsync(message) { return new Promise((resolve, reject) => this.enqueue(message, resolve, reject)); }
  enqueue(message, resolve, reject) {
    if (this.closed || this.socket.readyState !== 1) throw new Error(t('collaboration-wire.s154c54c'));
    const id = ++this.nextId; const frames = encodeCollaborationMessage(message, id);
    const bytes = frames.reduce((sum, frame) => sum + frame.length * 2, 0);
    const stateKey = !resolve && ['presence', 'ping', 'pong', 'locks'].includes(message.type) ? `${message.type}:${message.id ?? ''}` : null;
    if (stateKey) {
      for (let index = this.queue.length - 1; index >= 0; index--) {
        const queued = this.queue[index];
        if (message.type === 'locks' && queued.type === 'edit') break;
        if (queued.stateKey !== stateKey || queued.index !== 0) continue;
        if (this.bytes - queued.bytes + bytes > maxMessageBytes * 4) throw new Error(t('collaboration-wire.s3cf1b8a'));
        this.bytes += bytes - queued.bytes;
        this.queue[index] = { frames, index: 0, acknowledged: 0, id, bytes, type: message.type, stateKey };
        this.pump(); return;
      }
    }
    if (this.bytes + bytes > maxMessageBytes * 4) throw new Error(t('collaboration-wire.s3cf1b8a'));
    this.queue.push({ frames, index: 0, acknowledged: 0, id, bytes, type: message.type, stateKey, resolve, reject }); this.bytes += bytes; this.pump();
  }
  acknowledge(message) {
    const item = this.queue[0];
    if (!item || item.id !== message.id) return;
    if (!Number.isInteger(message.received) || message.received < 0 || message.received > item.index) throw new Error(t('collaboration-wire.sbe999ad'));
    if (message.received <= item.acknowledged) return;
    item.acknowledged = message.received;
    if (item.acknowledged >= this.growAt) { this.window = Math.min(this.maximumWindow, this.window * 2); this.growAt = item.acknowledged + this.window; }
    this.onProgress({ type: item.type, sent: item.acknowledged, total: item.frames.length });
    if (item.acknowledged === item.frames.length) { this.bytes -= item.bytes; this.queue.shift(); this.growAt = this.window; item.resolve?.(); }
    this.pump();
  }
  pump() {
    clearTimeout(this.timer);
    if (this.closed || this.socket.readyState !== 1) { this.close(); return; }
    try {
      while (this.queue.length && this.socket.bufferedAmount < 512 * 1024) {
        const item = this.queue[0];
        if (item.index >= item.frames.length || item.index - item.acknowledged >= this.window) return;
        this.socket.send(item.frames[item.index++]);
        if (item.frames.length === 1) {
          this.onProgress({ type: item.type, sent: 1, total: 1 }); this.bytes -= item.bytes; this.queue.shift(); this.growAt = this.window; item.resolve?.();
        }
      }
      if (this.queue.length) this.timer = setTimeout(() => this.pump(), 8);
    } catch (error) { this.close(); this.onError(error); }
  }
  close() { this.closed = true; clearTimeout(this.timer); for (const item of this.queue) item.reject?.(new Error(t('collaboration-wire.sbc9d39d'))); this.queue = []; this.bytes = 0; }
}
