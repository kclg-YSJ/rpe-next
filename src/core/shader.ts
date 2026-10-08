// Shader effect runtime: canonicalises the names RPE charts use for their GLSL post-processing
// shaders, projects the loose on-disk effect records onto a normalised form, samples their
// parameter tracks in real seconds and lazily fetches the GLSL sources.
import { beatValue } from './beat.ts';
import { easing, bezier } from './easing.ts';
import { assetUrl } from './asset-url.ts';
import type { Beat, Chart, ChartEvent } from './types.ts';
import type { TempoMap } from './tempo.ts';

export const SHADER_NAMES = [
  'chromatic', 'circle_blur', 'fisheye', 'glitch', 'grayscale', 'noise', 'pixel', 'radial_blur', 'shockwave', 'vignette',
  'chromatic_2', 'circle_blur_2', 'fisheye_2', 'glitch_2', 'grayscale_2', 'noise_2', 'pixel_2', 'radial_blur_2', 'shockwave_2', 'vignette_2',
  'liquid', 'flowing', 'image_noise', 'snow', 'glow_effect', 'flip', 'night_vision', 'scanline', 'rain', 'rainbow',
  'flare', 'underwater', 'fog', 'kaleidoscope', 'emboss', 'sobel', 'oil_painting', 'distortion', 'hologram', 'burn',
  'camera', 'lightning', 'old_tv', 'bokeh', 'neon', 'heat_distortion', 'rays', 'color_shift', 'wave', 'two_tone',
];

const aliases = new Map<string, string>([
  ['radialblur', 'radial_blur'], ['circleblur', 'circle_blur'], ['grayscale', 'grayscale'],
  ['oldtv', 'old_tv'], ['oilpainting', 'oil_painting'], ['heateffect', 'heat_distortion'],
]);

/**
 * An effect record as it appears in a chart. Everything is optional: the `effects` / `shaderEvents`
 * arrays are not covered by `assertChart`, so these objects are untrusted, and different RPE builds
 * spell the same field differently (`shader` vs `shaderType` vs `name`, `startTime` vs `start`).
 */
export interface ShaderEffectRecord {
  shader?: unknown;
  shaderType?: unknown;
  name?: unknown;
  clone?: unknown;
  line?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  start?: unknown;
  end?: unknown;
  time1?: unknown;
  time2?: unknown;
  global?: unknown;
  order?: unknown;
  vars?: unknown;
  [key: string]: unknown;
}

/** One effect after normalisation, with its beat range resolved to absolute beats. */
interface NormalisedEffect {
  shader: string;
  line: number;
  startBeat: number;
  endBeat: number;
  global: boolean;
  order: number;
  /** Parameter name to the tracks that carry it; each track is a list of PIE-like segments. */
  vars: Map<string, ShaderVariableTrack>;
  sourceName: string;
}

/**
 * One parameter segment. Charts spell the value fields inconsistently: `start`/`end` may hold the
 * payload, a redundant copy of the beat range, or nothing at all, so every shape is accepted and
 * narrowed by the helpers below.
 */
interface ShaderVariableSegment {
  startTime: number | Beat;
  start?: unknown;
  endTime?: number | Beat;
  end?: unknown;
  easingType?: number;
  easingLeft?: number;
  easingRight?: number;
  bezier?: unknown;
  bezierPoints?: number[];
  [key: string]: unknown;
}

type ShaderVariableTrack = ShaderVariableSegment[];

/** An effect that is active at the sampled instant, carrying its sampled parameter values. */
interface ActiveShaderEffect extends NormalisedEffect {
  values: Record<string, unknown>;
}

/**
 * Turns the accepted spellings of a shader name into one of {@link SHADER_NAMES}, or `null`.
 *
 * The input is untrusted on purpose: it arrives as a bare numeric index, an RPE path like
 * `/rain_pr.glsl`, or an arbitrary user string, so the parameter is `unknown` and is coerced.
 */
export function canonicalShaderName(value: unknown): string | null {
  if (Number.isInteger(value)) return SHADER_NAMES[value as number] ?? null;
  let name = String(value ?? '').trim().replace(/^[/\\]+/, '').split('/').at(-1)!.replace(/\.(glsl|frag)$/i, '').replace(/_pr$/i, '');
  name = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replaceAll('-', '_');
  name = aliases.get(name.replaceAll('_', '')) ?? name;
  return SHADER_NAMES.includes(name) ? name : null;
}

/** The shader identity of one effect, adding the original's `_2` clone suffix where required. */
export function shaderIdentity(event: ShaderEffectRecord): string {
  const name = canonicalShaderName(event.shader ?? event.shaderType ?? event.name) ?? 'chromatic';
  return event.clone && SHADER_NAMES.indexOf(name) < 10 ? `${name}_2` : name;
}

/** Resolves which judge line an effect belongs to, wrapping negative/overflowing indices. */
export function shaderLine(event: ShaderEffectRecord, chart: Chart): number {
  const count = chart.judgeLineList?.length ?? 0;
  const index = Number.isInteger(event.line) ? event.line as number : Math.max(0, SHADER_NAMES.indexOf(shaderIdentity(event)));
  return count ? ((index % count) + count) % count : 0;
}

/** Beat triples are preferred, but charts also store plain beat numbers here. */
function beatNumber(value: unknown, fallback = 0): number {
  if (Array.isArray(value)) {
    try { return beatValue(value); } catch { return fallback; }
  }
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * The beat a segment starts at, accepting the three spellings charts use: `startTime`, a plain
 * `start` beat, or the segment's own payload when neither is present.
 *
 * `start` is `unknown`, and the intermediate arrays built by `flatMap`/`sort` widen it further, so
 * the read is funnelled through one narrowing helper.
 */
function segmentStartBeat(segment: ShaderVariableSegment): number {
  const startTime: unknown = segment.startTime;
  const start: unknown = segment.start;
  return beatNumber(startTime, startTime === undefined ? 0 : beatNumber(start));
}

/** Deep-enough copy for parameter payloads: arrays are copied, everything else is shared. */
function cloneValue(value: unknown): unknown {
  return Array.isArray(value) ? value.map(cloneValue) : value;
}

/**
 * One interpolation step of a parameter track. Vector payloads interpolate component-wise; a
 * non-numeric payload (a shader texture reference) simply switches at the end of the segment.
 */
function interpolate(start: unknown, end: unknown, amount: number): unknown {
  if (Array.isArray(start) && Array.isArray(end)) return start.map((value, index) => Number(value) + (Number(end[index] ?? value) - Number(value)) * amount);
  if (typeof start === 'number' && typeof end === 'number') return start + (end - start) * amount;
  return amount >= 1 ? cloneValue(end) : cloneValue(start);
}

/**
 * Samples a parameter track at `seconds`, using the owning line's tempo factor.
 *
 * Returns `undefined` before the first segment starts, which is what lets the caller drop the
 * parameter and fall back to the shader's own default value.
 */
function sampleValue(events: ShaderVariableTrack | undefined, seconds: number, tempo: TempoMap | null, factor: number, fallback: unknown): unknown {
  if (!events?.length) return cloneValue(fallback);
  const beat = tempo?.beat(seconds, factor) ?? seconds;
  const ordered = [...events].sort((left, right) => segmentStartBeat(left) - segmentStartBeat(right));
  if (beat < segmentStartBeat(ordered[0])) return undefined;
  let selected = ordered[0];
  for (const event of ordered) {
    if (beat >= segmentStartBeat(event)) selected = event;
    else break;
  }
  const startBeat = segmentStartBeat(selected);
  const endBeat = beatNumber(selected.endTime, beatNumber(selected.end ?? startBeat));
  const startSeconds = tempo?.seconds(startBeat, factor) ?? startBeat;
  const endSeconds = tempo?.seconds(endBeat, factor) ?? endBeat;
  const progress = endSeconds <= startSeconds ? (seconds >= endSeconds ? 1 : 0) : Math.max(0, Math.min(1, (seconds - startSeconds) / (endSeconds - startSeconds)));
  // `easing()` and `bezier()` are still untyped; `Number(...)` narrows their result at the call site.
  const amount = selected.bezier ? Number(bezier(progress, selected.bezierPoints)) : Number(easing(progress, selected.easingType ?? 1, selected.easingLeft ?? 0, selected.easingRight ?? 1));
  return interpolate(selected.start, selected.end, amount);
}

/**
 * Accepts either a plain value or an already-authored track, and returns a track either way.
 *
 * A bare value becomes a single segment spanning beats 0..999999, i.e. "constant for the whole
 * chart"; this is what lets scalars and vector parameters share the sampling path.
 */
function normaliseVars(vars: unknown): Map<string, ShaderVariableTrack> {
  if (!vars || typeof vars !== 'object') return new Map();
  return new Map(Object.entries(vars).map(([name, value]): [string, ShaderVariableTrack] => {
    const isTrack = Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null && ('start' in value[0] || 'startTime' in value[0]);
    return [name, isTrack ? value as ShaderVariableTrack : [{ startTime: [0, 0, 1] as Beat, endTime: [999999, 0, 1] as Beat, start: value, end: value, easingType: 1 }]];
  }));
}

/** Projects one untrusted effect record onto {@link NormalisedEffect}; `null` when unusable. */
function normaliseEffect(effect: ShaderEffectRecord | null | undefined, lineIndex = -1): NormalisedEffect | null {
  if (!effect || typeof effect !== 'object') return null;
  let shader = canonicalShaderName(effect.shader ?? effect.shaderType ?? effect.name);
  if (!shader) return null;
  if (effect.clone && SHADER_NAMES.indexOf(shader) < 10) shader += '_2';
  const start = effect.startTime ?? effect.start ?? effect.time1 ?? [0, 0, 1];
  const end = effect.endTime ?? effect.end ?? effect.time2 ?? start;
  return {
    shader, line: Number.isInteger(effect.line) ? effect.line as number : lineIndex,
    startBeat: beatNumber(start), endBeat: beatNumber(end, beatNumber(start)),
    global: Boolean(effect.global), order: Number(effect.order ?? 0),
    vars: normaliseVars(effect.vars), sourceName: String(effect.shader ?? ''),
  };
}

/** Every effect the chart declares, from the three roots and each line's paint track. */
function chartEffects(chart: Chart): NormalisedEffect[] {
  const effects: NormalisedEffect[] = [];
  const roots: unknown[] = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat();
  for (const effect of roots) {
    const record = effect && typeof effect === 'object' ? effect as ShaderEffectRecord : null;
    const normalised = normaliseEffect(record, record ? shaderLine(record, chart) : -1);
    if (normalised && record) normalised.line = shaderLine(record, chart);
    if (normalised) effects.push(normalised);
  }
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    for (const event of line.extended?.paintEvents ?? []) {
      const normalised = normaliseEffect(event, lineIndex);
      if (normalised) effects.push(normalised);
    }
  }
  return effects.sort((left, right) => left.order - right.order || left.startBeat - right.startBeat);
}

export class ShaderRuntime {
  /** Called whenever the loaded source set changes, so the renderer can rebuild its pipeline. */
  invalidate: () => void;
  chart: Chart | null;
  tempo: TempoMap | null;
  effects: NormalisedEffect[];
  /** Loaded GLSL sources, keyed by shader name (preview variants use a `:pr` suffix). */
  sources: Map<string, string>;
  /** Keys currently being fetched, so concurrent `load` calls do not duplicate requests. */
  loading: Set<string>;

  constructor(invalidate: () => void = () => {}) { this.invalidate = invalidate; this.chart = null; this.tempo = null; this.effects = []; this.sources = new Map(); this.loading = new Set(); }

  /** Rebuilds the effect list when the document or the tempo map changes, then prefetches sources. */
  compile(chart: Chart, tempo: TempoMap): void {
    if (this.chart === chart && this.tempo === tempo) return;
    this.chart = chart; this.tempo = tempo; this.effects = chartEffects(chart);
    for (const effect of this.effects) this.load(effect.shader, effect.sourceName);
  }

  /** Fetches one shader source, preferring the `_pr` preview variant when the chart referenced it. */
  async load(name: string, sourceName = ''): Promise<void> {
    const previewSource = /(?:_pr\.glsl|\/pr\/)/i.test(sourceName);
    const key = previewSource ? `${name}:pr` : name;
    if (this.sources.has(key) || this.loading.has(key)) return;
    this.loading.add(key);
    const candidates = previewSource ? [`/assets/rpe/shaders/pr/${name}_pr.glsl`, `/assets/rpe/shaders/${name}.glsl`] : [`/assets/rpe/shaders/${name}.glsl`, `/assets/rpe/shaders/pr/${name}_pr.glsl`];
    try {
      for (const url of candidates) {
        const response = await fetch(assetUrl(url.slice('/assets/'.length)));
        if (response.ok) { this.sources.set(key, await response.text()); break; }
      }
    } catch { /* WebGL gracefully falls back to the unprocessed preview. */ }
    this.loading.delete(key); this.invalidate();
  }

  /** Effects whose beat range covers `seconds`, ordered the way they should be composited. */
  active(seconds: number): ActiveShaderEffect[] {
    const active = this.effects.flatMap((effect): ActiveShaderEffect[] => {
      const factor = this.chart?.judgeLineList?.[effect.line]?.bpmfactor ?? 1;
      const beat = this.tempo?.beat(seconds, factor) ?? seconds;
      if (beat < effect.startBeat || beat >= effect.endBeat) return [];
      // `vars` is a Map, so it is iterated directly: `Object.entries` on a Map yields nothing and
      // would silently produce an effect with no parameter values at all.
      return [{ ...effect, values: Object.fromEntries([...effect.vars].map(([name, events]) => [name, sampleValue(events, seconds, this.tempo, factor, events[0]?.start)]).filter(([, value]) => value !== undefined)) }];
    });
    return active.sort((left, right) => left.order - right.order || left.startBeat - right.startBeat);
  }

  /** The GLSL source for a shader, or `''` while it is still loading. */
  source(name: string, sourceName = ''): string { return this.sources.get(/(?:_pr\.glsl|\/pr\/)/i.test(sourceName) ? `${name}:pr` : name) ?? ''; }
}

/** A uniform's default value, used when the chart supplies no parameter for it. */
export function defaultShaderUniform(name: string, resolution: number[] = [1350, 900]): unknown {
  const defaults: Record<string, unknown> = {
    sampleCount: 3, power: 0.03, size: 3, rate: 0.6, speed: 1, blockCount: 30.5, colorRate: 0.01,
    factor: 1, seed: 81, centerX: 0.5, centerY: 0.5, progress: 0.2, width: 0.1, distortion: 0.8, expand: 10,
    extend: 0.25, radius: 15, frequency: 10, amplitude: 0.02, speedx: 1, speedy: 1, snowCount: 100,
    direction: [1, 0], threshold: 0.5, intensity: 1, density: 1, lightpos: [0.5, 0.5], fogColor: [0.5, 0.5, 0.5, 1],
    fogStart: 0, fogEnd: 1, segments: 8, center: [0.5, 0.5], angle: 0, hologramColor: [0, 1, 1, 1], burnColor: [1, 0.2, 0, 1],
    zoom: 1, offset: 0, rotation: 0, numBolts: 5, flashDuration: 0.1, rainColor: [0.4, 0.6, 1, 1], height: 1,
    strength: 1, blurRadius: 1, exposure: 1, decay: 1, weight: 0.5, hueShift: 0, saturationShift: 0, valueShift: 0,
    color1: [0, 0, 0, 1], color2: [1, 1, 1, 1], resolution,
  };
  return defaults[name];
}
