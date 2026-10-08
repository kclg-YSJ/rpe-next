import { mediaType } from './files.ts';

/**
 * The audio graph slice this transport drives.
 *
 * Declared as a structural minimum rather than `AudioContext` because tests inject small stand-ins
 * such as `{ currentTime, createGain, resume }` that are behaviourally compatible but are not real
 * `AudioContext` instances.
 */
export interface AudioContextLike {
  readonly currentTime: number;
  destination: unknown;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
  createMediaElementSource?(media: MediaElementLike): MediaSourceLike;
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<unknown>;
}

/** Any node a source or gain can be connected into; nothing beyond connecting is used. */
export type AudioNodeLike = unknown;

/** The `GainNode` slice used here. */
export interface GainNodeLike {
  gain: { value: number };
  connect(destination: AudioNodeLike): unknown;
}

/** The `AudioBufferSourceNode` slice used here. */
export interface BufferSourceLike {
  buffer: AudioBufferLike | null;
  playbackRate: { value: number };
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
  stop(): void;
  start(when?: number, offset?: number): void;
}

/** The decoded sample buffer slice used here. */
export interface AudioBufferLike {
  duration: number;
}

/** The `MediaElementAudioSourceNode` slice used here. */
export interface MediaSourceLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

/** Creates the context lazily on first playback, optionally with a stand-in for tests. */
export type AudioContextFactory = () => AudioContextLike;

/**
 * The HTMLMediaElement members reached on the `Audio()` element.
 *
 * Written as a structural minimum too: tests inject plain classes that mimic only this slice, and
 * the real `HTMLMediaElement` is far too wide for those assignments (and for the doubles that omit
 * `preload`/`duration`).
 */
export interface MediaElementLike {
  preload: string;
  playbackRate: number;
  preservesPitch: boolean;
  duration: number;
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  readyState: number | undefined;
  src: string;
  onloadedmetadata: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** An in-flight `startMedia()` attempt, cancellable while a seek is settling. */
interface MediaStart {
  media: MediaElementLike;
  revision: number;
  cancel?: (() => void) | null;
}

export class AudioTransport {
  contextFactory: AudioContextFactory;
  context: AudioContextLike | null;
  gain: GainNodeLike | null;
  buffer: AudioBufferLike | null;
  source: BufferSourceLike | null;
  playing: boolean;
  position: number;
  rate: number;
  volume: number;
  anchor: number;
  loadRevision: number;
  playRevision: number;
  preservePitch: boolean;
  media: MediaElementLike | null;
  mediaUrl: string | undefined;
  mediaSource: MediaSourceLike | null;
  mediaStart: MediaStart | null;
  lastError: unknown;

  constructor(contextFactory: AudioContextFactory = () => new AudioContext() as AudioContextLike) {
    this.contextFactory = contextFactory;
    this.context = null;
    this.gain = null;
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this.position = 0;
    this.rate = 1;
    this.volume = 0.75;
    this.anchor = 0;
    this.loadRevision = 0;
    this.playRevision = 0;
    this.preservePitch = true;
    this.media = null;
    this.mediaUrl = undefined;
    this.mediaSource = null;
    this.mediaStart = null;
    this.lastError = null;
  }

  ensureContext(): AudioContextLike {
    if (!this.context) {
      this.context = this.contextFactory();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }

  async load(bytes: ArrayBuffer, name = 'music.mp3'): Promise<boolean> {
    const revision = ++this.loadRevision;
    this.pause();
    const context = this.ensureContext();
    let decoded: AudioBufferLike | null = null;
    if (typeof Audio !== 'undefined') {
      const media = new Audio() as MediaElementLike; media.preload = 'auto';
      const url = URL.createObjectURL(new Blob([bytes], { type: mediaType(name) }));
      try {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: unknown) => {
            clearTimeout(timeout); media.onloadedmetadata = null; media.onerror = null;
            if (error) reject(error); else resolve();
          };
          const timeout = setTimeout(() => finish(new Error(`读取音乐 ${name} 超时，请检查文件或重新导入`)), 15000);
          media.onloadedmetadata = () => finish();
          media.onerror = () => finish(new Error(`无法解码音乐 ${name}；请检查文件完整性或转为 WAV/FLAC/MP3/OGG`));
          media.src = url;
        });
        if (typeof context.decodeAudioData === 'function') {
          try { decoded = await context.decodeAudioData(bytes.slice(0)); } catch { decoded = null; }
        }
        if (revision !== this.loadRevision) { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); return false; }
        this.releaseMedia(); this.media = media; this.mediaUrl = url;
        // `createMediaElementSource` is optional on the structural context type so the lightweight
        // stand-ins can omit it, but every real AudioContext defines it; non-null because a context
        // faithful enough to reach here always carries it.
        this.mediaSource = context.createMediaElementSource!(media); this.mediaSource.connect(this.gain);
        media.playbackRate = this.rate; media.preservesPitch = this.preservePitch;
        this.buffer = decoded ?? null; this.position = 0; return true;
      } catch (error) { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); if (revision === this.loadRevision) throw error; return false; }
    }
    decoded = await context.decodeAudioData(bytes.slice(0));
    if (revision !== this.loadRevision) return false;
    this.buffer = decoded;
    this.position = 0;
    return true;
  }

  releaseMedia(): void { if (this.media) { this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.mediaSource?.disconnect(); URL.revokeObjectURL(this.mediaUrl!); this.media = null; } }
  clear(): void { this.loadRevision++; this.pause(); this.releaseMedia(); this.buffer = null; this.position = 0; }
  get duration(): number { return this.buffer?.duration || this.media?.duration || 600; }
  get usesMedia(): boolean { return Boolean(this.media && (!this.buffer || this.preservePitch && this.rate !== 1)); }
  get clockReady(): boolean {
    return this.playing && (!this.usesMedia || this.position < 0 || !this.mediaStart && !this.media!.seeking && this.media!.paused !== true && (this.media!.readyState === undefined || this.media!.readyState >= 2));
  }
  get scheduleHorizon(): number { return this.usesMedia && this.position < 0 ? 0 : Infinity; }
  get time(): number {
    if (!this.playing) return this.position;
    if (this.usesMedia && this.position >= 0) return this.mediaStart || this.media!.seeking ? this.position : this.media!.currentTime;
    return this.position + (this.context!.currentTime - this.anchor) * this.rate;
  }

  async startMedia(): Promise<void> {
    const media = this.media!; const revision = this.playRevision;
    const start: MediaStart = { media, revision }; this.mediaStart = start;
    try {
      if (media.seeking) await new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          media.removeEventListener('seeked', seeked); media.removeEventListener('error', failed);
          start.cancel = null;
          if (error) reject(error); else resolve();
        };
        const seeked = () => { if (!media.seeking) finish(); };
        const failed = () => finish(new Error('音乐定位失败，请重新载入音频'));
        start.cancel = () => finish();
        media.addEventListener('seeked', seeked); media.addEventListener('error', failed);
        seeked();
      });
      if (revision !== this.playRevision || media !== this.media || !this.playing) return;
      await media.play();
      if (this.mediaStart === start && revision === this.playRevision && media === this.media && this.playing) this.mediaStart = null;
      if (revision !== this.playRevision && (!this.playing || media !== this.media)) media.pause();
    } catch (error) {
      if (revision === this.playRevision && media === this.media) { this.pause(); if ((error as Error).name !== 'AbortError') throw error; }
    }
  }

  async play(): Promise<void> {
    if (this.playing) return;
    const revision = ++this.playRevision;
    await this.ensureContext().resume();
    if (revision !== this.playRevision || this.playing) return;
    if (this.position >= this.duration) this.position = 0;
    this.anchor = this.context!.currentTime;
    this.playing = true;
    this.startSource();
    if (this.usesMedia && this.position >= 0) await this.startMedia();
  }

  startSource(): void {
    if (this.usesMedia) {
      const target = Math.max(0, this.position);
      if (Math.abs(this.media!.currentTime - target) > 1e-7) this.media!.currentTime = target;
      return;
    }
    if (!this.buffer || this.position >= this.duration) return;
    const source = this.context!.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    source.start(this.context!.currentTime + Math.max(0, -this.position) / this.rate, Math.max(0, this.position));
    this.source = source;
  }

  update(): void {
    if (!this.playing || !this.usesMedia || this.position >= 0 || this.time < 0) return;
    this.position = this.time; this.anchor = this.context!.currentTime;
    this.playRevision++; this.startSource();
    this.startMedia().catch((error: unknown) => { this.lastError = error; });
  }

  pause(): void {
    this.playRevision++;
    this.position = Math.min(this.time, this.duration);
    this.playing = false;
    this.stopSource();
  }

  stopSource(): void {
    this.mediaStart?.cancel?.();
    this.mediaStart = null;
    this.media?.pause();
    if (this.source) { this.source.stop(); this.source.disconnect(); this.source = null; }
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) throw new Error('非法播放位置');
    this.playRevision++;
    this.stopSource();
    this.position = Math.min(seconds, this.duration);
    if (this.position >= this.duration) this.playing = false;
    if (this.playing) {
      this.anchor = this.context!.currentTime; this.startSource();
      if (this.usesMedia && this.position >= 0) {
        this.startMedia().catch((error: unknown) => { this.lastError = error; });
      }
    } else if (this.usesMedia && Math.abs(this.media!.currentTime - Math.max(0, this.position)) > 1e-7) this.media!.currentTime = Math.max(0, this.position);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('倍速必须大于零');
    const position = this.time;
    const wasMedia = this.usesMedia;
    this.rate = rate;
    if (this.media) this.media.playbackRate = rate;
    if (wasMedia && this.usesMedia) {
      this.position = position; this.anchor = this.context?.currentTime ?? 0;
      this.media!.playbackRate = rate;
      if (!this.mediaStart) this.playRevision++;
    } else this.seek(position);
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) throw new Error('音量必须为有限数字');
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  setPreservePitch(enabled: unknown): void {
    const position = this.time; const wasMedia = this.usesMedia;
    this.preservePitch = Boolean(enabled);
    if (this.media) this.media.preservesPitch = this.preservePitch;
    if (wasMedia !== this.usesMedia) this.seek(position);
  }
}
