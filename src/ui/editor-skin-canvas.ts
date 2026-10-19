import { EDITOR_SKIN_CANVASES } from '../core/editor-skin.ts';
import type { EditorSkinCanvasConfig } from '../core/editor-skin.ts';

/** The canvas configuration a resolved skin carries for one target. */
type CanvasConfig = Omit<EditorSkinCanvasConfig, 'targets'> & { resolvedFont?: string };

/** The palette a canvas maps source colours through, keyed by lower-case `#rrggbb`. */
type CanvasPalette = Record<string, string>;

/** The resolved canvas settings installed for the active skin. */
interface CanvasSettings {
  palette: CanvasPalette;
  targets: Record<string, CanvasConfig>;
  resolvedFont?: string;
}

/** The skin document fields the canvas layer reads. */
/** A resolved skin document, or a canvas config passed on its own. */
type CanvasSkin = EditorSkinCanvasConfig & { canvas?: EditorSkinCanvasConfig };

/** The per-context proxy cache, keyed by the role it was built for. */
const contexts = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasRenderingContext2D>>();

let settings: CanvasSettings | null = null;
let revision = 0;

const palette = (value: Record<string, string> | undefined): CanvasPalette => Object.fromEntries(Object.entries(value ?? {}).map(([key, color]) => [key.toLowerCase(), color]));

/**
 * Installs the active skin's canvas configuration, or clears it for the default editor.
 *
 * `fonts` maps an asset id to the family name the runtime registered, so a target that references
 * a skin font resolves to the family that is actually available on the page.
 */
export function setEditorCanvasSkin(skin: CanvasSkin | null | undefined, font = '', fonts: Map<string, string> = new Map()): void {
  // A resolved skin carries its settings on the document itself, while a variant's settings may still
  // sit under `canvas`; both shapes are accepted so callers never have to unwrap a variant.
  const document = skin as (EditorSkinCanvasConfig & { canvas?: EditorSkinCanvasConfig | null }) | null | undefined;
  const config = (document?.canvas ?? document) as EditorSkinCanvasConfig | null | undefined;
  settings = config ? {
    ...config,
    palette: palette(config.palette as Record<string, string> | undefined),
    targets: Object.fromEntries(Object.entries(config.targets ?? {}).map(([role, target]) => [role, { ...target, palette: palette(target.palette), resolvedFont: fonts.get(target.font ?? '') ?? font }])),
    resolvedFont: font,
  } : null;
  revision++;
}

export function editorCanvasRevision(): number { return revision; }

function canvasRole(canvas: HTMLCanvasElement | undefined): string | null {
  if (!canvas || ['preview', 'realtime-preview'].includes(canvas.id)) return null;
  const declared = (canvas as { dataset?: { skinCanvas?: string } }).dataset?.skinCanvas;
  if (declared) return declared;
  const matches = (canvas as { matches?: (selector: string) => boolean }).matches;
  return Object.entries(EDITOR_SKIN_CANVASES).find(([, selector]) => Boolean(selector) && (selector === '#' + canvas.id || Boolean(matches?.call(canvas, selector))))?.[0] ?? null;
}

/**
 * Wraps a 2D context so the active skin's palette, font and line settings apply.
 *
 * The wrapper is cached per context and role, so draw code can call it inside a frame loop without
 * allocating a new proxy. An unstyled context, or one the skin does not target, is returned as is.
 */
export function editorSkinContext(context: CanvasRenderingContext2D, requestedRole?: string): CanvasRenderingContext2D {
  const canvas = (context as { canvas?: HTMLCanvasElement } | null | undefined)?.canvas;
  const role = requestedRole ?? canvasRole(canvas);
  // The preview canvases render the chart itself, so a skin never restyles them.
  if (!context || !settings || !role || !Object.hasOwn(EDITOR_SKIN_CANVASES, role) || ['preview', 'realtime-preview'].includes(canvas?.id ?? '')) return context;
  let roles = contexts.get(context); if (!roles) { roles = new Map(); contexts.set(context, roles); }
  const cached = roles.get(role); if (cached) return cached;
  const bound = new Map<string, (...args: never[]) => unknown>(); const colors = new Map<string, string>();
  let generation = -1; let config: CanvasConfig | undefined;
  const update = (): void => {
    if (generation !== revision) {
      colors.clear(); generation = revision;
      const local = settings?.targets[role as string];
      config = settings ? { ...settings, ...local, palette: { ...settings.palette, ...local?.palette } } : undefined;
    }
  };
  const color = (value: unknown): unknown => { update(); if (!config || typeof value !== 'string') return value; if (!colors.has(value)) colors.set(value, recolor(value, config.palette ?? {})); return colors.get(value); };
  const proxy = new Proxy(context, {
    get(target, key) {
      update();
      // Methods must run against the raw context: `this` inside a native method would otherwise be the
      // proxy and read back the style already translated into the target's palette.
      if (key === 'canvas') return target.canvas;
      if (typeof key === 'string' && ['createLinearGradient', 'createRadialGradient', 'createConicGradient'].includes(key)) return (...args: never[]) => {
        const gradient = (target[key as 'createLinearGradient'] as (...values: never[]) => CanvasGradient)(...args);
        const add = gradient.addColorStop.bind(gradient);
        gradient.addColorStop = (offset: number, value: string) => add(offset, color(value) as string);
        return gradient;
      };
      if (key === 'setLineDash') return (values: number[]) => target.setLineDash(values.length && config?.lineDash ? config.lineDash : values);
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const name = key as string;
      if (!bound.has(name)) bound.set(name, ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage'].includes(name) ? (...args: never[]) => {
        update(); const alpha = target.globalAlpha; const width = target.lineWidth;
        if (config?.opacity !== undefined) target.globalAlpha = alpha * config.opacity;
        if (config?.lineWidthScale !== undefined) target.lineWidth = width * config.lineWidthScale;
        try { return (value as (...values: never[]) => unknown).apply(target, args); } finally { target.globalAlpha = alpha; target.lineWidth = width; }
      } : (value as (...values: never[]) => unknown).bind(target));
      return bound.get(name);
    },
    set(target, key, value: unknown) {
      update();
      // The narrowing is captured up front: property keys on this proxy may arrive as symbols too.
      const property = typeof key === 'string' ? key : '';
      if (typeof value === 'string' && ['fillStyle', 'strokeStyle', 'shadowColor'].includes(property)) value = color(value);
      else if (config && property === 'font' && typeof value === 'string') {
        let text = value;
        if (config.fontScale) text = text.replace(/([\d.]+)px/, (match, size: string) => `${Number(size) * (config?.fontScale ?? 1)}px`);
        if (config.resolvedFont) text = text.replace(/RPE(?:Game)?(?=[, ]|$)/g, `"${config.resolvedFont}"`);
        value = text;
      }
      return Reflect.set(target, key, value, target);
    },
  });
  roles.set(role, proxy); return proxy;
}

function recolor(value: string, paletteMap: CanvasPalette): string {
  let rgb: string; let alpha = 1;
  if (/^#[\da-f]{3,8}$/i.test(value)) {
    let hex = value.slice(1); if ([3, 4].includes(hex.length)) hex = [...hex].map(char => char + char).join('');
    if (![6, 8].includes(hex.length)) return value;
    rgb = hex.slice(0, 6).toLowerCase(); if (hex.length === 8) alpha = parseInt(hex.slice(6), 16) / 255;
  } else {
    const match = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
    if (!match) return value;
    rgb = match.slice(1, 4).map(number => Math.round(Number(number)).toString(16).padStart(2, '0')).join(''); if (match[4] !== undefined) alpha = Number(match[4]);
  }
  const next = paletteMap['#' + rgb]; if (!next) return value;
  if (alpha === 1) return next;
  const [red, green, blue] = [1, 3, 5].map(offset => parseInt(next.slice(offset, offset + 2), 16));
  return `rgba(${red},${green},${blue},${alpha})`;
}
