import { beatValue } from './beat.mjs';
import { eventEasing, eventEndpoints } from './event-easing.mjs';
import { assetUrl } from './asset-url.mjs';
import { shaderAssetPath, shaderText } from './shader-assets.mjs';
import { t } from '../i18n.mjs';

export const LEGACY_SHADER_NAMES = [
  'chromatic', 'circle_blur', 'fisheye', 'glitch', 'grayscale', 'noise', 'pixel', 'radial_blur', 'shockwave', 'vignette',
  'chromatic_2', 'circle_blur_2', 'fisheye_2', 'glitch_2', 'grayscale_2', 'noise_2', 'pixel_2', 'radial_blur_2', 'shockwave_2', 'vignette_2',
  'liquid', 'flowing', 'image_noise', 'snow', 'glow_effect', 'flip', 'night_vision', 'scanline', 'rain', 'rainbow',
  'flare', 'underwater', 'fog', 'kaleidoscope', 'emboss', 'sobel', 'oil_painting', 'distortion', 'hologram', 'burn',
  'camera', 'lightning', 'old_tv', 'bokeh', 'neon', 'heat_distortion', 'rays', 'color_shift', 'wave', 'two_tone',
];
export const SHADER_NAMES = LEGACY_SHADER_NAMES.filter(name => !name.endsWith('_2'));

const aliases = new Map([
  ['radialblur', 'radial_blur'], ['circleblur', 'circle_blur'], ['grayscale', 'grayscale'],
  ['oldtv', 'old_tv'], ['oilpainting', 'oil_painting'], ['heateffect', 'heat_distortion'],
]);

export function canonicalShaderName(value) {
  if (Number.isInteger(value)) value = LEGACY_SHADER_NAMES[value];
  let name = String(value ?? '').trim().replace(/^[/\\]+/, '').split('/').at(-1).replace(/\.(glsl|frag)$/i, '').replace(/_pr$/i, '');
  name = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replaceAll('-', '_');
  name = name.replace(/_2$/, '');
  name = aliases.get(name.replaceAll('_', '')) ?? name;
  return SHADER_NAMES.includes(name) ? name : null;
}
export function builtinShaderReference(value) {
  if (!canonicalShaderName(value)) return false;
  if (typeof value !== 'string') return true;
  const reference = value.replaceAll('\\', '/');
  return !reference.includes('/') || /^\/?(?:pr\/)?[^/]+_pr\.glsl$/i.test(reference);
}

export function shaderIdentity(event) {
  const value = event.shader ?? event.shaderType ?? event.name;
  return canonicalShaderName(value) ?? (typeof value === 'string' && value.trim() ? value : 'chromatic');
}

export function shaderLine(event, chart) {
  const count = chart.judgeLineList?.length ?? 0;
  let legacyIndex = LEGACY_SHADER_NAMES.indexOf(shaderIdentity(event));
  if (event.clone && legacyIndex >= 0 && legacyIndex < 10) legacyIndex += 10;
  if (typeof event.shader === 'string' && /_2(?:\.|$)/.test(event.shader) && legacyIndex >= 0 && legacyIndex < 10) legacyIndex += 10;
  if (Number.isInteger(event.shaderType)) legacyIndex = event.shaderType;
  const index = Number.isInteger(event.line) ? event.line : Math.max(0, legacyIndex);
  return count ? ((index % count) + count) % count : 0;
}

function beatNumber(value, fallback = 0) {
  if (Array.isArray(value)) {
    try { return beatValue(value); } catch { return fallback; }
  }
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function cloneValue(value) {
  return Array.isArray(value) ? value.map(cloneValue) : value;
}

function interpolate(start, end, amount) {
  if (Array.isArray(start) && Array.isArray(end)) return start.map((value, index) => Number(value) + (Number(end[index] ?? value) - Number(value)) * amount);
  if (typeof start === 'number' && typeof end === 'number') return start + (end - start) * amount;
  return amount >= 1 ? cloneValue(end) : cloneValue(start);
}

const trackStarts = new WeakMap();
function sampleValue(events, seconds, tempo, factor, fallback) {
  if (!events?.length) return cloneValue(fallback);
  const beat = tempo?.beat(seconds, factor) ?? seconds;
  const ordered = events;
  const starts = trackStarts.get(ordered);
  if (beat < starts[0]) return undefined;
  let low = 0, high = ordered.length;
  while (low < high) { const middle = (low + high) >>> 1; if (starts[middle] <= beat) low = middle + 1; else high = middle; }
  const selected = ordered[Math.max(0, low - 1)];
  const startBeat = starts[Math.max(0, low - 1)];
  const endBeat = beatNumber(selected.endTime, selected.end ?? startBeat);
  const startSeconds = tempo?.seconds(startBeat, factor) ?? startBeat;
  const endSeconds = tempo?.seconds(endBeat, factor) ?? endBeat;
  const progress = endSeconds <= startSeconds ? (seconds >= endSeconds ? 1 : 0) : Math.max(0, Math.min(1, (seconds - startSeconds) / (endSeconds - startSeconds)));
  const amount = eventEasing(selected, progress);
  return selected.customEasing ? interpolate(...eventEndpoints(selected), amount) : interpolate(selected.start, selected.end, amount);
}

function normaliseVars(vars) {
  if (!vars || typeof vars !== 'object') return {};
  return Object.fromEntries(Object.entries(vars).map(([name, value]) => {
    const isTrack = Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && ('start' in value[0] || 'startTime' in value[0]);
    const events = isTrack ? [...value].sort((a, b) => beatNumber(a.startTime, a.start ?? 0) - beatNumber(b.startTime, b.start ?? 0)) : [{ startTime: [0, 0, 1], endTime: [999999, 0, 1], start: value, end: value, easingType: 1 }];
    trackStarts.set(events, events.map(event => beatNumber(event.startTime, event.start ?? 0)));
    return [name, events];
  }));
}

function normaliseEffect(effect, lineIndex = -1) {
  if (!effect || typeof effect !== 'object') return null;
  let shader = shaderIdentity(effect);
  if (!shader) return null;
  const start = effect.startTime ?? effect.start ?? effect.time1 ?? [0, 0, 1];
  const end = effect.endTime ?? effect.end ?? effect.time2 ?? start;
  return {
    shader, line: Number.isInteger(effect.line) ? effect.line : lineIndex,
    startBeat: beatNumber(start), endBeat: beatNumber(end, beatNumber(start)),
    global: Boolean(effect.global), order: Number(effect.order ?? 0),
    vars: normaliseVars(effect.vars), sourceName: String(effect.shader ?? effect.name ?? ''),
  };
}

function chartEffects(chart) {
  const effects = [];
  const roots = [chart.effects, chart.shaderEvents, chart.META?.effects].filter(Array.isArray).flat();
  for (const effect of roots) {
    const normalised = normaliseEffect(effect, effect && typeof effect === 'object' ? shaderLine(effect, chart) : -1);
    if (normalised) normalised.line = shaderLine(effect, chart);
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

export function builtinShaderSource(source, legacy = false) {
  source = source.replace(/\r\n?/g, '\n');
  const match = source.match(/#ifdef RPEN_LEGACY_SOURCE\n([\s\S]*?)\n#else\n([\s\S]*)\n#endif\s*$/);
  return '// @rpen-builtin\n' + (match ? '#version 100\n' + (legacy ? match[1] : match[2]) : source);
}
export function legacyShaderSource(name, sourceName = '') {
  return SHADER_NAMES.indexOf(name) >= 10 && !/(?:_pr\.glsl|\/pr\/)/i.test(sourceName);
}
export class ShaderRuntime {
  constructor(invalidate = () => {}, report = () => {}) {
    Object.assign(this, { invalidate, report, chart: null, tempo: null, effects: [], sources: new Map(), sourceBytes: new Map(), loading: new Set(), errors: new Map(), paths: new Map(), generation: 0, assets: null, chartName: '', assetRevision: null, shaderRevision: null });
  }
  setAssets(assets, chartName = '', revision = 0, shaderRevision = 0) {
    if (this.assets === assets && this.chartName === chartName && this.assetRevision === revision && this.shaderRevision === shaderRevision) return;
    this.assets = assets; this.chartName = chartName; this.assetRevision = revision; this.shaderRevision = shaderRevision;
    this.generation++; this.chart = null; this.loading.clear(); this.errors.clear(); this.paths.clear();
    for (const [key, bytes] of this.sourceBytes) if (assets?.get(key.slice(5)) !== bytes) { this.sources.delete(key); this.sourceBytes.delete(key); }
  }
  path(reference) { if (!this.paths.has(reference)) this.paths.set(reference, shaderAssetPath(this.assets, reference, this.chartName)); return this.paths.get(reference); }
  key(name, reference = '') {
    const path = this.path(reference);
    return path ? 'file:' + path : builtinShaderReference(reference || name) ? name + (legacyShaderSource(name, reference) ? ':legacy' : '') : 'missing:' + reference;
  }
  compile(chart, tempo) {
    if (this.chart === chart && this.tempo === tempo) return;
    this.chart = chart; this.tempo = tempo; this.effects = chartEffects(chart);
    const used = new Set();
    for (const effect of this.effects) { used.add(this.key(effect.shader, effect.sourceName)); this.load(effect.shader, effect.sourceName); }
    for (const key of this.sourceBytes.keys()) if (!used.has(key)) { this.sources.delete(key); this.sourceBytes.delete(key); }
  }
  async load(name, sourceName = '') {
    const key = this.key(name, sourceName), generation = this.generation;
    if (this.sources.has(key) || this.loading.has(key) || this.errors.has(key)) return;
    const path = this.path(sourceName);
    this.loading.add(key);
    try {
      let source;
      if (path) { const bytes = this.assets.get(path); source = shaderText(bytes); this.sourceBytes.set(key, bytes); }
      else {
        if (!SHADER_NAMES.includes(name) || !builtinShaderReference(sourceName || name)) throw Error(t('shader-editor.missing', { path: sourceName }));
        const response = await fetch(assetUrl('rpe/shaders/' + name + '.glsl'));
        if (!response.ok) throw Error(t('shader-editor.missing', { path: sourceName }));
        source = builtinShaderSource(await response.text(), legacyShaderSource(name, sourceName));
      }
      if (generation !== this.generation) return;
      this.sources.set(key, source);
    } catch (error) {
      if (generation === this.generation) { this.errors.set(key, error.message); this.report(error.message); }
    } finally {
      if (generation === this.generation) { this.loading.delete(key); this.invalidate(); }
    }
  }
  active(seconds) {
    const active = this.effects.flatMap(effect => {
      const factor = this.chart?.judgeLineList?.[effect.line]?.bpmfactor ?? 1;
      const beat = this.tempo?.beat(seconds, factor) ?? seconds;
      if (beat < effect.startBeat || beat >= effect.endBeat) return [];
      return [{ ...effect, values: Object.fromEntries(Object.entries(effect.vars).map(([name, events]) => [name, sampleValue(events, seconds, this.tempo, factor, events[0]?.start)]).filter(([, value]) => value !== undefined)) }];
    });
    return active;
  }
  source(name, sourceName = '') { return this.sources.get(this.key(name, sourceName)) ?? ''; }
}

export function defaultShaderUniform(name, resolution = [1350, 900]) {
  const defaults = {
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
