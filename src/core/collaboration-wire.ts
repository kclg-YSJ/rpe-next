const frameSize = 8192;
const maxMessageBytes = 64 * 1024 * 1024;
const encoder = new TextEncoder();

/** A decoded wire message. Field types are only known after each reader's own validation. */
export type WireMessage = Record<string, unknown>;

/** The slice of `WebSocket` the sender drives. Declared structurally so tests can pass a double. */
export interface MessageSocket {
  readyState: number;
  bufferedAmount: number;
  send(data: string): void;
}

/** The acknowledgement a reader sends back for each accepted fragment. */
export interface FragmentAck {
  type: string;
  id: number;
  received: number;
}

/** One queued message and its in-flight acknowledgement state. */
interface QueuedMessage {
  frames: string[];
  index: number;
  acknowledged: number;
  id: number;
  bytes: number;
  type: string | undefined;
  stateKey: string | null;
  resolve?: () => void;
  reject?: (error: Error) => void;
}

/** The progress report the sender emits as fragments are acknowledged. */
export interface SendProgress {
  type: string | undefined;
  sent: number;
  total: number;
}

/**
 * Watches a collaboration sync and calls `onTimeout` when it stalls.
 *
 * Two limits apply: an idle limit that resets on every `progress()`, and a total limit measured from
 * `start()`. The shorter of the two wins, and the reason string says which one fired.
 */
export class CollaborationSyncDeadline {
  // Declared with definite-assignment where the constructor assigns them; `started` and `timer`
  // genuinely do not exist until `start()`/`progress()` runs.
  onTimeout: (reason: 'idle' | 'total') => void;
  idleMilliseconds: number;
  totalMilliseconds: number;
  active: boolean;
  started!: number;
  timer: ReturnType<typeof setTimeout> | undefined;

  constructor(onTimeout: (reason: 'idle' | 'total') => void, { idleMilliseconds = 60000, totalMilliseconds = 600000 }: { idleMilliseconds?: number; totalMilliseconds?: number } = {}) {
    this.onTimeout = onTimeout; this.idleMilliseconds = idleMilliseconds; this.totalMilliseconds = totalMilliseconds; this.active = false;
  }
  start(): void { this.started = Date.now(); this.active = true; this.progress(); }
  progress(): void {
    if (!this.active) return;
    clearTimeout(this.timer);
    const remaining = this.totalMilliseconds - (Date.now() - this.started);
    const totalLimit = remaining <= this.idleMilliseconds;
    this.timer = setTimeout(() => { this.active = false; this.onTimeout(totalLimit ? 'total' : 'idle'); }, Math.max(0, Math.min(this.idleMilliseconds, remaining)));
  }
  stop(): void { this.active = false; clearTimeout(this.timer); }
}

export function encodeCollaborationMessage(message: unknown, id = 0): string[] {
  const text = JSON.stringify(message);
  if (encoder.encode(text).byteLength > maxMessageBytes) throw new Error('联机消息超过 64 MiB');
  if (text.length <= frameSize) return [text];
  const total = Math.ceil(text.length / frameSize);
  return Array.from({ length: total }, (_, index) => JSON.stringify({ type: '$rpeFrame', id, index, total, data: text.slice(index * frameSize, (index + 1) * frameSize) }));
}

/** Reassembles the fragments `encodeCollaborationMessage` produced, acking each one it accepts. */
export class CollaborationMessageReader {
  acknowledge: (message: FragmentAck) => void;
  parts!: string[];
  bytes!: number;
  total!: number;
  /**
   * The fragment id currently being assembled. `reset()` clears it to `null` while a frame without
   * an id leaves it `undefined`, and the continuity guard below compares against it directly — so
   * all three states are meaningful and must not be collapsed.
   */
  id!: number | null | undefined;

  constructor(acknowledge: (message: FragmentAck) => void = () => {}) { this.acknowledge = acknowledge; this.reset(); }
  reset(): void { this.parts = []; this.bytes = 0; this.total = 0; this.id = null; }
  read(text: string): WireMessage | null {
    const message: WireMessage = JSON.parse(text);
    if (message?.type === '$rpeAck') return message;
    if (message?.type !== '$rpeFrame') {
      if (this.parts.length) throw new Error('联机同步分片被中断');
      return message;
    }
    const { id, index, total, data } = message;
    if (id !== undefined && (!Number.isSafeInteger(id) || Number(id) < 0) || !Number.isInteger(index) || !Number.isInteger(total) || Number(total) < 1 || Number(total) > Math.ceil(maxMessageBytes / frameSize) || index !== this.parts.length || Number(index) >= Number(total) || typeof data !== 'string' || data.length > frameSize || this.total && (total !== this.total || id !== this.id)) throw new Error('联机同步分片无效');
    // The guard above has already proved each field's runtime type; these bindings record that for
    // the compiler. `Number(id)` is exact because the guard required a safe integer.
    const frameId: number | undefined = id === undefined ? undefined : Number(id);
    const frameTotal: number = Number(total);
    this.bytes += encoder.encode(data).byteLength;
    if (this.bytes > maxMessageBytes) { this.reset(); throw new Error('联机同步消息过大'); }
    this.total = frameTotal; this.id = frameId; this.parts.push(data);
    if (frameId !== undefined) this.acknowledge({ type: '$rpeAck', id: frameId, received: this.parts.length });
    if (this.parts.length < frameTotal) return null;
    const result: WireMessage = JSON.parse(this.parts.join('')); this.reset(); return result;
  }
}

/** Sends wire messages as acknowledged fragments, with a congestion window that doubles as it drains. */
export class CollaborationMessageSender {
  socket: MessageSocket;
  onError: (error: unknown) => void;
  onProgress: (progress: SendProgress) => void;
  queue: QueuedMessage[];
  bytes: number;
  closed: boolean;
  nextId: number;
  window: number;
  maximumWindow: number;
  growAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;

  constructor(socket: MessageSocket, onError: (error: unknown) => void = () => {}, onProgress: (progress: SendProgress) => void = () => {}) { this.socket = socket; this.onError = onError; this.onProgress = onProgress; this.queue = []; this.bytes = 0; this.closed = false; this.nextId = 0; this.window = 16; this.maximumWindow = 128; this.growAt = 16; }
  send(message: WireMessage): void { this.enqueue(message); }
  sendAsync(message: WireMessage): Promise<void> { return new Promise<void>((resolve, reject) => this.enqueue(message, resolve, reject)); }
  enqueue(message: WireMessage, resolve?: () => void, reject?: (error: Error) => void): void {
    if (this.closed || this.socket.readyState !== 1) throw new Error('连接已经关闭');
    const id = ++this.nextId; const frames = encodeCollaborationMessage(message, id);
    const bytes = frames.reduce((sum, frame) => sum + frame.length * 2, 0);
    // `message.type` is only a string once it matched this list, so the narrowing is recorded here.
    const type: string | undefined = typeof message.type === 'string' ? message.type : undefined;
    const stateKey = !resolve && type !== undefined && ['presence', 'ping', 'pong', 'locks'].includes(type) ? `${type}:${message.id ?? ''}` : null;
    if (stateKey) {
      for (let index = this.queue.length - 1; index >= 0; index--) {
        const queued = this.queue[index]!;
        if (type === 'locks' && queued.type === 'edit') break;
        if (queued.stateKey !== stateKey || queued.index !== 0) continue;
        if (this.bytes - queued.bytes + bytes > maxMessageBytes * 4) throw new Error('网络拥堵，请稍后重试');
        this.bytes += bytes - queued.bytes;
        this.queue[index] = { frames, index: 0, acknowledged: 0, id, bytes, type, stateKey };
        this.pump(); return;
      }
    }
    if (this.bytes + bytes > maxMessageBytes * 4) throw new Error('网络拥堵，请稍后重试');
    this.queue.push({ frames, index: 0, acknowledged: 0, id, bytes, type, stateKey, resolve, reject }); this.bytes += bytes; this.pump();
  }
  acknowledge(message: FragmentAck): void {
    const item = this.queue[0];
    if (!item || item.id !== message.id) return;
    if (!Number.isInteger(message.received) || message.received < 0 || message.received > item.index) throw new Error('联机分片确认无效');
    if (message.received <= item.acknowledged) return;
    item.acknowledged = message.received;
    if (item.acknowledged >= this.growAt) { this.window = Math.min(this.maximumWindow, this.window * 2); this.growAt = item.acknowledged + this.window; }
    this.onProgress({ type: item.type, sent: item.acknowledged, total: item.frames.length });
    if (item.acknowledged === item.frames.length) { this.bytes -= item.bytes; this.queue.shift(); this.growAt = this.window; item.resolve?.(); }
    this.pump();
  }
  pump(): void {
    clearTimeout(this.timer);
    if (this.closed || this.socket.readyState !== 1) { this.close(); return; }
    try {
      while (this.queue.length && this.socket.bufferedAmount < 512 * 1024) {
        const item = this.queue[0]!;
        if (item.index >= item.frames.length || item.index - item.acknowledged >= this.window) return;
        this.socket.send(item.frames[item.index++]!);
        if (item.frames.length === 1) {
          this.onProgress({ type: item.type, sent: 1, total: 1 }); this.bytes -= item.bytes; this.queue.shift(); this.growAt = this.window; item.resolve?.();
        }
      }
      if (this.queue.length) this.timer = setTimeout(() => this.pump(), 8);
    } catch (error) { this.close(); this.onError(error); }
  }
  close(): void { this.closed = true; clearTimeout(this.timer); for (const item of this.queue) item.reject?.(new Error('传输连接已关闭')); this.queue = []; this.bytes = 0; }
}
