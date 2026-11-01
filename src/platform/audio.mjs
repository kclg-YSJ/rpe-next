import { mediaType } from './files.mjs';
import { pcmWave } from './pcm-wave.mjs';
import { ResourceCache } from '../core/resource-cache.mjs';
import { t } from '../i18n.mjs';

function loadMediaSource(media, url, name, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => finish(Object.assign(new Error(t('audio.s27e0136')), { name: 'AbortError' }));
    const finish = error => {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort); media.onloadedmetadata = null; media.onerror = null;
      if (error) reject(error); else resolve();
    };
    const timeout = setTimeout(() => finish(new Error(t('audio.s16ce4ff', { p0: name }))), 15000);
    media.onloadedmetadata = () => finish();
    media.onerror = () => finish(new Error(t('audio.s2dd0ec8', { p0: name })));
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) { abort(); return; }
    media.src = url;
  });
}

export class AudioTransport {
  constructor(contextFactory = () => new AudioContext(), { playbackCacheBytes = 192 * 1024 ** 2, playbackCacheEntries = 3 } = {}) {
    this.contextFactory = contextFactory;
    this.context = null;
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
    this.mediaStart = null;
    this.playbackOverride = null;
    this.overrideRevision = 0;
    this.playbackCache = new ResourceCache({ maxBytes: playbackCacheBytes, maxEntries: playbackCacheEntries, dispose: override => this.disposePlaybackOverride(override), retain: override => override === this.playbackOverride });
  }

  ensureContext() {
    if (!this.context) {
      this.context = this.contextFactory();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.context.destination);
    }
    return this.context;
  }

  async load(bytes, name = 'music.mp3') {
    const revision = ++this.loadRevision;
    this.pause();
    this.resetPlaybackBuffer({ clearCache: true });
    const context = this.ensureContext();
    let decoded;
    if (typeof Audio !== 'undefined') {
      const media = new Audio(); media.preload = 'auto';
      let url = URL.createObjectURL(new Blob([bytes], { type: mediaType(name) }));
      try {
        await loadMediaSource(media, url, name);
        if (typeof context.decodeAudioData === 'function') {
          try { decoded = await context.decodeAudioData(bytes.slice(0)); } catch { decoded = null; }
        }
        if (decoded && revision === this.loadRevision) {
          let pcmUrl;
          try {
            const wave = await pcmWave(decoded, () => revision !== this.loadRevision);
            if (wave) {
              pcmUrl = URL.createObjectURL(wave);
              await loadMediaSource(media, pcmUrl, name);
              URL.revokeObjectURL(url); url = pcmUrl;
            }
          } catch {
            if (pcmUrl) { URL.revokeObjectURL(pcmUrl); await loadMediaSource(media, url, name); }
          }
        }
        if (revision !== this.loadRevision) { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(url); return false; }
        this.releaseMedia(); this.media = media; this.mediaUrl = url;
        this.mediaSource = context.createMediaElementSource(media); this.mediaSource.connect(this.gain);
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

  releaseMedia() { if (this.media) { this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.mediaSource?.disconnect(); URL.revokeObjectURL(this.mediaUrl); this.media = null; } }
  async loadStream(url, duration = 600) {
    this.clear(); this.streamDuration = duration;
    if (!url) return;
    const revision = this.loadRevision, media = new Audio(); media.preload = 'metadata';
    try {
      await loadMediaSource(media, url, '超大谱音乐');
      if (revision !== this.loadRevision) { media.removeAttribute('src'); media.load(); return; }
      this.media = media; this.mediaUrl = url;
      this.mediaSource = this.ensureContext().createMediaElementSource(media); this.mediaSource.connect(this.gain);
      media.playbackRate = this.rate; media.preservesPitch = this.preservePitch;
    } catch (error) { media.removeAttribute('src'); media.load(); throw error; }
  }
  clear() { this.loadRevision++; this.pause(); this.resetPlaybackBuffer({ clearCache: true }); this.releaseMedia(); this.buffer = null; this.position = 0; this.streamDuration = null; }
  get playbackBuffer() { return this.playbackOverride?.buffer ?? this.buffer; }
  get playbackMedia() { return this.playbackOverride ? this.playbackOverride.media : this.media; }
  disposePlaybackOverride(override) { if (!override) return; override.media?.pause(); override.media?.removeAttribute('src'); override.media?.load(); override.source?.disconnect(); if (override.url) URL.revokeObjectURL(override.url); }
  applyPlaybackOverride(override) {
    const position = this.time, previous = this.playbackOverride; this.playRevision++; this.stopSource(); this.playbackOverride = override; this.position = position; this.anchor = this.context?.currentTime ?? 0;
    if (previous && !this.playbackCache.has(previous.buffer)) this.disposePlaybackOverride(previous);
    if (override) this.playbackCache.set(override.buffer, override, override.bytes ?? override.buffer.length * override.buffer.numberOfChannels * 4);
    else this.playbackCache.trim();
    if (this.playbackMedia) { this.playbackMedia.playbackRate = this.rate; this.playbackMedia.preservesPitch = this.preservePitch; }
    if (this.playing) { this.startSource(); if (this.usesMedia && this.position >= 0) this.startMedia().catch(error => { this.lastError = error; }); }
  }
  resetPlaybackBuffer({ clearCache = false } = {}) { this.overrideRevision++; if (this.playbackOverride) this.applyPlaybackOverride(null); if (clearCache) this.playbackCache.clear(); }
  async setPlaybackBuffer(buffer, { signal } = {}) {
    if (signal?.aborted) throw Object.assign(new Error(t('audio.s27e0136')), { name: 'AbortError' });
    if (!buffer || buffer === this.buffer) { this.resetPlaybackBuffer(); return; }
    if (buffer === this.playbackBuffer) return;
    const revision = ++this.overrideRevision, original = this.buffer, cached = this.playbackCache.get(buffer);
    if (cached && cached.original === original) { this.applyPlaybackOverride(cached); return; }
    if (cached) this.playbackCache.delete(buffer);
    const override = { buffer, original, media: null, source: null, url: null };
    const valid = () => revision === this.overrideRevision && original === this.buffer && !signal?.aborted;
    try {
      if (typeof Audio !== 'undefined') {
        const wave = await pcmWave(buffer, () => !valid()); if (!wave || !valid()) throw Object.assign(new Error(t('audio.s27e0136')), { name: 'AbortError' });
        override.bytes = wave.size; override.media = new Audio(); override.media.preload = 'auto'; override.url = URL.createObjectURL(wave);
        await loadMediaSource(override.media, override.url, t('audio.s724a91c'), signal);
        override.media.playbackRate = this.rate; override.media.preservesPitch = this.preservePitch;
        override.source = this.ensureContext().createMediaElementSource(override.media); override.source.connect(this.gain);
      }
      if (!valid()) throw Object.assign(new Error(t('audio.s27e0136')), { name: 'AbortError' });
      this.applyPlaybackOverride(override);
    } catch (error) { this.disposePlaybackOverride(override); throw error; }
  }
  get duration() { return this.buffer?.duration || this.media?.duration || this.streamDuration || 600; }
  get usesMedia() { return Boolean(this.playbackMedia && (!this.playbackBuffer || this.preservePitch && this.rate !== 1)); }
  get clockReady() {
    const media = this.playbackMedia;
    return this.playing && (!this.usesMedia || this.position < 0 || !this.mediaStart && !media.seeking && media.paused !== true && (media.readyState === undefined || media.readyState >= 2));
  }
  get scheduleHorizon() { return this.usesMedia && this.position < 0 ? 0 : Infinity; }
  get time() {
    if (!this.playing) return this.position;
    if (this.usesMedia && this.position >= 0) return this.mediaStart || this.playbackMedia.seeking ? this.position : this.playbackMedia.currentTime;
    return this.position + (this.context.currentTime - this.anchor) * this.rate;
  }

  async startMedia() {
    const media = this.playbackMedia; const revision = this.playRevision;
    const start = { media, revision }; this.mediaStart = start;
    try {
      if (media.seeking) await new Promise((resolve, reject) => {
        const finish = error => {
          media.removeEventListener('seeked', seeked); media.removeEventListener('error', failed);
          start.cancel = null;
          if (error) reject(error); else resolve();
        };
        const seeked = () => { if (!media.seeking) finish(); };
        const failed = () => finish(new Error(t('audio.s09649b0')));
        start.cancel = () => finish();
        media.addEventListener('seeked', seeked); media.addEventListener('error', failed);
        seeked();
      });
      if (revision !== this.playRevision || media !== this.playbackMedia || !this.playing) return;
      await media.play();
      if (this.mediaStart === start && revision === this.playRevision && media === this.playbackMedia && this.playing) this.mediaStart = null;
      if (revision !== this.playRevision && (!this.playing || media !== this.playbackMedia)) media.pause();
    } catch (error) {
      if (revision === this.playRevision && media === this.playbackMedia) { this.pause(); if (error.name !== 'AbortError') throw error; }
    }
  }

  async play() {
    if (this.playing) return;
    const revision = ++this.playRevision;
    await this.ensureContext().resume();
    if (revision !== this.playRevision || this.playing) return;
    if (this.position >= this.duration) this.position = 0;
    this.anchor = this.context.currentTime;
    this.playing = true;
    this.startSource();
    if (this.usesMedia && this.position >= 0) await this.startMedia();
  }

  startSource() {
    if (this.usesMedia) {
      const target = Math.max(0, this.position);
      if (Math.abs(this.playbackMedia.currentTime - target) > 1e-7) this.playbackMedia.currentTime = target;
      return;
    }
    if (!this.playbackBuffer || this.position >= this.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = this.playbackBuffer;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    source.start(this.context.currentTime + Math.max(0, -this.position) / this.rate, Math.max(0, this.position));
    this.source = source;
  }

  update() {
    if (!this.playing || !this.usesMedia || this.position >= 0 || this.time < 0) return;
    this.position = this.time; this.anchor = this.context.currentTime;
    this.playRevision++; this.startSource();
    this.startMedia().catch(error => { this.lastError = error; });
  }

  pause() {
    this.playRevision++;
    const position = this.time;
    const usePausedMediaTime = this.playing && this.usesMedia && this.position >= 0 && !this.mediaStart && !this.playbackMedia.seeking;
    this.stopSource();
    this.position = Math.min(usePausedMediaTime ? this.playbackMedia.currentTime : position, this.duration);
    this.playing = false;
  }

  stopSource() {
    this.mediaStart?.cancel?.();
    this.mediaStart = null;
    this.media?.pause();
    if (this.playbackOverride) this.playbackOverride.media?.pause();
    if (this.source) { this.source.stop(); this.source.disconnect(); this.source = null; }
  }

  seek(seconds) {
    if (!Number.isFinite(seconds)) throw new Error(t('audio.s8ad1694'));
    this.playRevision++;
    this.stopSource();
    this.position = Math.min(seconds, this.duration);
    if (this.position >= this.duration) this.playing = false;
    if (this.playing) {
      this.anchor = this.context.currentTime; this.startSource();
      if (this.usesMedia && this.position >= 0) {
        this.startMedia().catch(error => { this.lastError = error; });
      }
    } else if (this.usesMedia && Math.abs(this.playbackMedia.currentTime - Math.max(0, this.position)) > 1e-7) this.playbackMedia.currentTime = Math.max(0, this.position);
  }

  setRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(t('audio.sde2da75'));
    const position = this.time;
    const wasMedia = this.usesMedia;
    this.rate = rate;
    if (this.playbackMedia) this.playbackMedia.playbackRate = rate;
    if (wasMedia && this.usesMedia) {
      this.position = position; this.anchor = this.context?.currentTime ?? 0;
      this.playbackMedia.playbackRate = rate;
      if (!this.mediaStart) this.playRevision++;
    } else this.seek(position);
  }

  setVolume(volume) {
    if (!Number.isFinite(volume)) throw new Error(t('audio.s9730e08'));
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  setPreservePitch(enabled) {
    const position = this.time; const wasMedia = this.usesMedia;
    this.preservePitch = Boolean(enabled);
    if (this.playbackMedia) this.playbackMedia.preservesPitch = this.preservePitch;
    if (wasMedia !== this.usesMedia) this.seek(position);
  }
}
