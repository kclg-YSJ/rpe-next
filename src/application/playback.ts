import { wheelSeconds } from '../core/edit-grid.ts';
import type { Chart } from '../core/types.ts';
import type { MigratedSettings } from '../core/preferences.ts';

/**
 * The transport slice the play/pause/seek controls drive.
 *
 * Declared as the structural minimum the controls actually touch rather than as `AudioTransport`,
 * because the interaction tests inject small stand-ins such as
 * `{ time, duration, rate, playing, pause, seek, play }` that are behaviourally compatible without
 * being real transports. `AudioTransport` satisfies this structurally.
 */
export interface PlaybackTransport {
  time: number;
  duration: number;
  rate: number;
  playing: boolean;
  pause(): void;
  seek(seconds: number): void;
  play(): Promise<void>;
}

/**
 * The hit-sound scheduler slice `toggle` drives.
 *
 * `chart` is a write-only hand-off to `HitSounds`: the scheduler keeps the document and reads it on
 * the next `tick`. Both fields are optional so the test doubles — which only implement
 * `stop`/`prepare`, or `stop` plus a chart assignment — stay assignable.
 */
export interface PlaybackSounds {
  stop(): void;
  prepare(): Promise<void>;
  chart?: Chart;
}

/**
 * The wheel-scroll settings the animation loop passes in: the migrated settings spread, optionally
 * overridden with the stored editor's scroll speed.
 */
export type PlaybackWheelSettings = Pick<MigratedSettings, 'scrollSpeed' | 'scrollAcceleration'>;

/** The wheel event slice read by the transport: the deltas plus the ALt-key burst multiplier. */
export interface PlaybackWheelEvent {
  deltaY: number;
  altKey?: boolean;
}

/**
 * Play/pause/seek transport shared by the toolbar, the timeline scrubber, the wheel and the preview.
 *
 * Owns no audio graph of its own: it forwards to the audio transport and the hit scheduler, and uses
 * a monotonically increasing `request` counter to drop stale asynchronous results, so a pause or a
 * later seek cancels the play request that is still preparing.
 */
export class EditorPlayback {
  /** The audio transport being driven. */
  audio: PlaybackTransport;
  /** The hitsound scheduler started and stopped alongside playback. */
  sounds: PlaybackSounds;
  /**
   * Invoked after every seek so callers can realign the timeline origin and the preview clock.
   *
   * The callback the app registers reads `audio.time` and ignores its argument, so a zero-argument
   * function is the honest type: it also keeps the tests' `() => { ... }` doubles assignable.
   */
  onSeek: () => void;
  /** Incremented by every state change; an async step still sees the old value once it is stale. */
  request: number;
  /** `true` while a play request is preparing sounds, so the UI can show it and cancel it. */
  pending: boolean;
  /** Time of the previous wheel event, used to detect the start of a scroll burst. */
  lastWheel: number;
  /** Time the current wheel burst started, fed to the acceleration ramp. */
  burstStart: number;

  constructor(audio: PlaybackTransport, sounds: PlaybackSounds, onSeek: () => void) {
    this.audio = audio; this.sounds = sounds; this.onSeek = onSeek; this.request = 0; this.pending = false; this.lastWheel = -Infinity; this.burstStart = 0;
  }

  pause(): void { this.request++; this.pending = false; this.audio.pause(); this.sounds.stop(); }

  seek(seconds: number, pause = true): void {
    if (pause) this.pause();
    this.audio.seek(seconds);
    this.sounds.stop(); this.onSeek();
  }

  async toggle(chart: Chart): Promise<void> {
    if (this.audio.playing || this.pending) { this.pause(); return; }
    const request = ++this.request; this.pending = true;
    try {
      this.sounds.chart = chart; await this.sounds.prepare();
      if (this.request === request) await this.audio.play();
    } finally { if (this.request === request) this.pending = false; }
  }

  wheel(event: PlaybackWheelEvent, settings: PlaybackWheelSettings, now: number): void {
    if (now - this.lastWheel > 0.2) this.burstStart = now;
    this.lastWheel = now;
    const delta = wheelSeconds(event.deltaY, this.audio.duration, settings.scrollSpeed, this.audio.rate, settings.scrollAcceleration, now - this.burstStart, event.altKey);
    this.seek(this.audio.time + delta);
  }
}
