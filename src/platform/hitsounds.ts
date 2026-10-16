import { upperBound } from '../core/beat.ts';
import { assetBytes } from './files.ts';
import { assetUrl } from '../core/asset-url.ts';
import type { Chart } from '../core/types.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { ArchiveEntries } from './archive.ts';

/**
 * The subset of `AudioTransport` the hit scheduler drives.
 *
 * `tests/audio-seek.test.ts` hands `HitSounds` a hand-built stand-in transport, so the scheduler is
 * typed against the surface it actually uses — context, clock and play revision — rather than the
 * concrete class. The real `AudioTransport` satisfies this structurally.
 */
interface HitSoundTransport {
  /** Idempotent: returns the running context, creating one on first use. */
  ensureContext(): AudioContext;
  playing: boolean;
  /** `false` while playback is still seeking or buffering, which suppresses scheduling. */
  clockReady: boolean;
  readonly context: AudioContext;
  readonly time: number;
  readonly rate: number;
  playRevision: number;
  readonly scheduleHorizon: number;
}

/** One scheduled hit: the chart time it belongs at and the sound it should play. */
interface HitEntry {
  time: number;
  /**
   * The sound name. RPE charts carry `hitsound` as free-form JSON, so it is read as `unknown`: a
   * truthy non-string simply finds no buffer and plays nothing, which is what the untyped original
   * did. Widening a `string` return type to `unknown` adds no runtime code and keeps the object
   * shape the tests assert on (`{ time, sound }`).
   */
  sound: unknown;
}

/**
 * Builds the sorted list of hits a chart triggers.
 *
 * `lineIndex` of `null`/`undefined` means every line; otherwise only that line is walked, which is
 * what the "仅当前线" toggle asks for. Fake notes never sound, and a note's own `hitsound` wins over
 * the default named after its type (flick, drag, otherwise tap).
 */
export function hitTimeline(chart: Chart, tempo: TempoMap, offsets: [number, number] = [0, 0], lineIndex: number | null = null): HitEntry[] {
  const entries: HitEntry[] = [];
  const lines = lineIndex === null || lineIndex === undefined
    ? chart.judgeLineList ?? []
    : [chart.judgeLineList?.[lineIndex]].filter(Boolean);
  for (const line of lines) for (const note of line.notes ?? []) {
    if (note.isFake) continue;
    entries.push({ time: tempo.seconds(note.startTime, line.bpmfactor ?? 1) + (chart.META.offset ?? 0) / 1000 + (note.type === 4 ? offsets[1] : offsets[0]),
      sound: note.hitsound || note.hitSound || (note.type === 3 ? 'flick' : note.type === 4 ? 'drag' : 'tap') });
  }
  return entries.sort((left, right) => left.time - right.time);
}

/**
 * Schedules chart hitsounds against the transport's audio clock.
 *
 * Note names come from RPE's free-form `hitsound` field, so the chart document is read loosely at
 * the two places it is touched: the note lookup in `hitTimeline` and the name collection below.
 */
export class HitSounds {
  transport: HitSoundTransport;
  buffers: Map<string, AudioBuffer>;
  sources: Set<AudioBufferSourceNode>;
  volume: number;
  enabled: boolean;
  onlyCurrentLine: boolean;
  assets: ArchiveEntries;
  chartName: string;
  generation: number;
  maxVoices: number;
  maxBurst: number;
  maxSameTime: number;
  gain?: GainNode;
  chart?: Chart;
  compiled: Chart | null;
  compiledLine: number | null;
  tempo?: TempoMap;
  entries: HitEntry[];
  next: number;
  revision: number;

  constructor(transport: HitSoundTransport) {
    this.transport = transport; this.buffers = new Map(); this.sources = new Set(); this.volume = 0.3; this.enabled = true; this.onlyCurrentLine = false; this.assets = new Map(); this.chartName = ''; this.generation = 0;
    this.maxVoices = 192;
    this.maxBurst = 96;
    this.maxSameTime = 64;
    this.compiled = null;
    this.compiledLine = null;
    this.entries = [];
    this.next = 0;
    this.revision = -1;
  }

  async prepare(): Promise<void> {
    const context = this.transport.ensureContext();
    if (!this.gain) { this.gain = context.createGain(); this.gain.connect(context.destination); }
    this.gain.gain.value = this.volume;
    const generation = this.generation;
    const names = new Set<string>(['tap', 'drag', 'flick', ...(this.chart?.judgeLineList ?? []).flatMap(line => (line.notes ?? []).map((note): unknown => note.hitsound || note.hitSound).filter((name): name is string => typeof name === 'string' && name !== ''))]);
    await Promise.all([...names].map(async name => {
      if (this.buffers.has(name)) return;
      let bytes = assetBytes(this.assets, name, this.chartName);
      if (!bytes && ['tap', 'drag', 'flick'].includes(name)) {
        const response = await fetch(assetUrl(`rpe/SE/${name}.ogg`)); if (!response.ok) return;
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (!bytes) return;
      // `Uint8Array.buffer` is `ArrayBufferLike`, which admits `SharedArrayBuffer`; the DOM
      // `decodeAudioData` overload only takes `ArrayBuffer`. The bytes here always come from a file,
      // an archive or `fetch`, so the buffer is a plain one — same reasoning as `legacy-text.ts`.
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      try {
        const decoded = await context.decodeAudioData(data);
        if (generation === this.generation) this.buffers.set(name, decoded);
      } catch { return; }
    }));
  }

  setProject(chart: Chart, assets: ArchiveEntries, chartName: string): void { this.stop(); this.generation++; this.buffers.clear(); this.chart = chart; this.assets = assets; this.chartName = chartName; this.compiled = null; this.compiledLine = null; this.onlyCurrentLine = false; }
  setVolume(value: number): void { this.volume = Math.max(0, Math.min(1, value)); if (this.gain) this.gain.gain.value = this.volume; }
  stop(): void { for (const source of this.sources) { source.stop(); source.disconnect(); } this.sources.clear(); this.revision = -1; }

  tick(chart: Chart, tempo: TempoMap, currentLine: number | null = null): void {
    if (!this.enabled || !this.transport.playing || this.transport.clockReady === false) { this.stop(); return; }
    const line = this.onlyCurrentLine ? currentLine : null;
    if (this.compiled !== chart || this.tempo !== tempo || this.compiledLine !== line) {
      this.stop(); this.compiled = chart; this.tempo = tempo; this.compiledLine = line; this.entries = hitTimeline(chart, tempo, [0, 0], line);
    }
    const time = this.transport.time; const context = this.transport.context;
    if (this.revision !== this.transport.playRevision) {
      this.stop(); this.revision = this.transport.playRevision;
      this.next = upperBound(this.entries, time - 0.02, entry => entry.time);
    }
    this.next = Math.max(this.next, upperBound(this.entries, time - 0.08, entry => entry.time));
    const until = time + 0.1 * this.transport.rate;
    let burst = 0;
    const sameTime = new Map<number, number>();
    while (this.next < this.entries.length && this.entries[this.next].time <= until && this.entries[this.next].time < (this.transport.scheduleHorizon ?? Infinity)) {
      const entry = this.entries[this.next++];
      // Narrowing instead of casting: a non-string `hitsound` finds no buffer, exactly as before.
      const buffer = typeof entry.sound === 'string' ? this.buffers.get(entry.sound) : undefined;
      if (!buffer || !this.gain) continue;
      const timeKey = Math.round(entry.time * 1000);
      const timeCount = sameTime.get(timeKey) ?? 0;
      if (burst >= this.maxBurst || this.sources.size >= this.maxVoices || timeCount >= this.maxSameTime) continue;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.gain);
      source.onended = () => { this.sources.delete(source); source.disconnect(); };
      source.start(context.currentTime + Math.max(0, entry.time - time) / this.transport.rate);
      this.sources.add(source);
      sameTime.set(timeKey, timeCount + 1); burst++;
    }
  }
}
