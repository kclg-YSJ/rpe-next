import { wheelSeconds } from '../core/edit-grid.mjs';

export class EditorPlayback {
  constructor(audio, sounds, onSeek) { this.audio = audio; this.sounds = sounds; this.onSeek = onSeek; this.request = 0; this.pending = false; this.lastWheel = -Infinity; this.burstStart = 0; }
  pause() { this.request++; this.pending = false; this.buffering = null; this.audio.pause(); this.sounds.stop(); }
  waitForData() {
    if (!this.audio.playing || this.buffering) return;
    this.buffering = { request: this.request };
    this.audio.pause(); this.sounds.stop();
  }
  async resumeWhenReady() {
    const waiting = this.buffering;
    if (!waiting || waiting.request !== this.request || this.resumingData) return;
    this.resumingData = true;
    try {
      await this.audio.play();
      if (this.buffering === waiting && waiting.request === this.request) this.buffering = null;
      else this.audio.pause();
    } finally { this.resumingData = false; }
  }
  seek(seconds, pause = true) {
    if (pause) this.pause();
    this.audio.seek(seconds);
    this.sounds.stop(); this.onSeek();
  }
  async toggle(chart) {
    if (this.audio.playing || this.pending || this.buffering) { this.pause(); return; }
    const request = ++this.request; this.pending = true;
    try {
      this.sounds.chart = chart; await this.sounds.prepare();
      if (this.request === request) {
        // AudioTransport also restarts at its end, but editing views must see
        // the rewind before playback so effect windows and disk pages reset.
        if (Number.isFinite(this.audio.duration) && this.audio.time >= this.audio.duration) this.seek(0, false);
        await this.audio.play();
      }
    } finally { if (this.request === request) this.pending = false; }
  }
  wheel(event, settings, now) {
    const deltaMode = event.deltaMode ?? 0;
    const deltaY = event.deltaY;
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    const inputMode = settings.wheelInputMode === 'trackpad' ? 'trackpad' : 'mouse';
    if (now - this.lastWheel > 0.2 || this.wheelInputMode !== inputMode) this.burstStart = now;
    this.wheelInputMode = inputMode;
    this.lastWheel = now;
    const delta = wheelSeconds(deltaY, this.audio.duration, settings.scrollSpeed, this.audio.rate, settings.scrollAcceleration, now - this.burstStart, event.altKey, deltaMode, inputMode);
    const target = this.audio.time + delta;
    this.seek(settings.wheelStopAtAudioStart === false ? target : Math.max(0, target));
  }
}
