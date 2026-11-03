import { beatValue } from './beat.mjs';
import { eventEasing, eventEndpoints } from './event-easing.mjs';
import { assetUrl } from './asset-url.mjs';

export const SHADER_NAMES = [
  'chromatic', 'circle_blur', 'fisheye', 'glitch', 'grayscale', 'noise', 'pixel', 'radial_blur', 'shockwave', 'vignette',
  'chromatic_2', 'circle_blur_2', 'fisheye_2', 'glitch_2', 'grayscale_2', 'noise_2', 'pixel_2', 'radial_blur_2', 'shockwave_2', 'vignette_2',
  'liquid', 'flowing', 'image_noise', 'snow', 'glow_effect', 'flip', 'night_vision', 'scanline', 'rain', 'rainbow',
  'flare', 'underwater', 'fog', 'kaleidoscope', 'emboss', 'sobel', 'oil_painting', 'distortion', 'hologram', 'burn',
  'camera', 'lightning', 'old_tv', 'bokeh', 'neon', 'heat_distortion', 'rays', 'color_shift', 'wave', 'two_tone',
];

const aliases = new Map([
  ['radialblur', 'radial_blur'], ['circleblur', 'circle_blur'], ['grayscale', 'grayscale'],
  ['oldtv', 'old_tv'], ['oilpainting', 'oil_painting'], ['heateffect', 'heat_distortion'],
]);

export function canonicalShaderName(value) {
  if (Number.isInteger(value)) return SHADER_NAMES[value] ?? null;
  let name = String(value ?? '').trim().replace(/^[/\\]+/, '').split('/').at(-1).replace(/\.(glsl|frag)$/i, '').replace(/_pr$/i, '');
  name = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replaceAll('-', '_');
  name = aliases.get(name.replaceAll('_', '')) ?? name;
  return SHADER_NAMES.includes(name) ? name : null;
}

export function shaderIdentity(event) {
  const name = canonicalShaderName(event.shader ?? event.shaderType ?? event.name) ?? 'chromatic';
  return event.clone && SHADER_NAMES.indexOf(name) < 10 ? `${name}_2` : name;
}

export function shaderLine(event, chart) {
  const count = chart.judgeLineList?.length ?? 0;
  const index = Number.isInteger(event.line) ? event.line : Math.max(0, SHADER_NAMES.indexOf(shaderIdentity(event)));
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

function sampleValue(events, seconds, tempo, factor, fallback) {
  if (!events?.length) return cloneValue(fallback);
  const beat = tempo?.beat(seconds, factor) ?? seconds;
  const ordered = [...events].sort((left, right) => beatNumber(left.startTime, left.start ?? 0) - beatNumber(right.startTime, right.start ?? 0));
  if (beat < beatNumber(ordered[0].startTime)) return undefined;
  let selected = ordered[0];
  for (const event of ordered) {
    if (beat >= beatNumber(event.startTime, event.start ?? 0)) selected = event;
    else break;
  }
  const startBeat = beatNumber(selected.startTime, selected.start ?? 0);
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
    return [name, isTrack ? value : [{ startTime: [0, 0, 1], endTime: [999999, 0, 1], start: value, end: value, easingType: 1 }]];
  }));
}

function normaliseEffect(effect, lineIndex = -1) {
  if (!effect || typeof effect !== 'object') return null;
  let shader = canonicalShaderName(effect.shader ?? effect.shaderType ?? effect.name);
  if (!shader) return null;
  if (effect.clone && SHADER_NAMES.indexOf(shader) < 10) shader += '_2';
  const start = effect.startTime ?? effect.start ?? effect.time1 ?? [0, 0, 1];
  const end = effect.endTime ?? effect.end ?? effect.time2 ?? start;
  return {
    shader, line: Number.isInteger(effect.line) ? effect.line : lineIndex,
    startBeat: beatNumber(start), endBeat: beatNumber(end, beatNumber(start)),
    global: Boolean(effect.global), order: Number(effect.order ?? 0),
    vars: normaliseVars(effect.vars), sourceName: String(effect.shader ?? ''),
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

export class ShaderRuntime {
  constructor(invalidate = () => {}) { this.invalidate = invalidate; this.chart = null; this.tempo = null; this.effects = []; this.sources = new Map(); this.loading = new Set(); }

  compile(chart, tempo) {
    if (this.chart === chart && this.tempo === tempo) return;
    this.chart = chart; this.tempo = tempo; this.effects = chartEffects(chart);
    for (const effect of this.effects) this.load(effect.shader, effect.sourceName);
  }

  async load(name, sourceName = '') {
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

  active(seconds) {
    const active = this.effects.flatMap(effect => {
      const factor = this.chart?.judgeLineList?.[effect.line]?.bpmfactor ?? 1;
      const beat = this.tempo?.beat(seconds, factor) ?? seconds;
      if (beat < effect.startBeat || beat >= effect.endBeat) return [];
      return [{ ...effect, values: Object.fromEntries(Object.entries(effect.vars).map(([name, events]) => [name, sampleValue(events, seconds, this.tempo, factor, events[0]?.start)]).filter(([, value]) => value !== undefined)) }];
    });
    return active.sort((left, right) => left.order - right.order || left.startBeat - right.startBeat);
  }

  source(name, sourceName = '') { return this.sources.get(/(?:_pr\.glsl|\/pr\/)/i.test(sourceName) ? `${name}:pr` : name) ?? ''; }
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
