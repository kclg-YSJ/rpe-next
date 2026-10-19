import { SceneRuntime } from '../core/scene.ts';
import { prepareCanvas, NOTE_COLORS } from './timeline.ts';
import { DEFAULT_LINE_WIDTH, DEFAULT_LINE_HEIGHT, HIT_DURATION, hitFrame } from '../core/visual-constants.ts';
import { previewViewport, previewPositionScale, previewNotePosition, simultaneousNotes, hitParticles } from '../core/editor-display.ts';
import type { PositionScale } from '../core/editor-display.ts';
import { renderPasses } from '../core/game-ui.ts';
import { drawGameUi } from './game-ui.ts';
import { recentHits } from '../core/hit-effects.ts';
import { lineGuides, mergeGuides, pickGuide, formatLineNumbers } from '../core/preview-guides.ts';
import { ShaderRuntime } from '../core/shader.ts';
import { ShaderPipeline } from './shader-pipeline.ts';
import { PreviewBackground, textureInViewport } from './preview-background.ts';
// 0.10.2 draws the chart's noise areas into the preview through this renderer, alongside the
// background and the guides this file already drew.
import { NoisePreview } from './noise-preview.ts';
import { noiseLayers } from '../core/noise-skin.ts';
import type { Chart, Color, Note, NoiseLayer, NoteType } from '../core/types.ts';
import type { HitEntry } from '../core/hit-effects.ts';
import type { LineState, SceneSampler } from '../core/scene.ts';
import type { RenderPass } from '../core/game-ui.ts';
import type { LineGuide } from '../core/preview-guides.ts';
import type { PreviewViewport } from '../core/editor-display.ts';
import type { ShaderEffectRecord } from '../core/shader.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { ProjectImages } from '../platform/images.ts';
import type { RpeSkin } from './skin.ts';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * A picture as the renderer receives it from the skin, the image store or the default fallbacks.
 *
 * The callers hand in more than one kind of picture: a decoded `<img>`, an `ImageBitmap` behind the
 * `{ source, naturalWidth, naturalHeight }` record `platform/images.ts` builds, a tinted canvas from
 * `skin.ts`, the texture record `describe` reports, and the bare `{ naturalWidth, naturalHeight }`
 * literal standing in for the built-in `line.png`. `source` is `unknown` for the same reason it is in
 * `preview-background.ts`: a decoded record's bitmap is handed straight to `drawImage` and never read
 * structurally, and narrowing it to `CanvasImageSource` would reject those records.
 *
 * Both sizes stay optional here where `preview-background.ts` requires them, because a texture
 * record is built by spreading a PNG-header probe that yields `{}` for a truncated asset, and that
 * record reaches the viewport test. That test only divides by the sizes, so `undefined` already
 * produces the `NaN` comparison the original relied on; the required-size shape is attached there,
 * on the one binding that needs it.
 */
interface PreviewImage {
  naturalWidth?: number;
  naturalHeight?: number;
  readonly width?: number;
  readonly height?: number;
  source?: unknown;
}

/**
 * A picture whose pixel size is known, as `textureInViewport` and `backgroundFrame.draw` require.
 *
 * Only ever written as the assertion on a binding that has just been confirmed to carry both sizes.
 */
type SizedImage = PreviewImage & { naturalWidth: number; naturalHeight: number };

/**
 * The RGB triple the renderer reads off a line state, a note tint or a hit tint.
 *
 * Declared locally rather than taken from the shared `Color` in `core/types.ts`: the resolved chart
 * notes are still typed by an untyped authoring module, so that module's three-element tuple cannot
 * be attached to a per-note tint yet, and the three read sites (`state.color.map`, `rgb(...)`,
 * `tinted`) only need three finite channel values.
 */
type RgbColor = [red: number, green: number, blue: number];

/** A judge line's sampled state, plus the colour the line tint overrides it with. */
type TintedLineState = ScreenState & { color: RgbColor };

/**
 * What {@link Preview.drawLine} reads off a judge line: its texture identity, its anchor and whether
 * it carries a text track.
 *
 * The drawing code was factored out of `draw` so the tests can call it directly, and it never takes
 * a value from `this.scene`, so it does not require the full compiled-line shape. Both callers — the
 * render loop and `test/preview-compat.test.ts` — pass a real judge line, which satisfies this.
 */
interface JudgeLineSource {
  Texture: string;
  anchor?: number[];
  extended?: { textEvents?: unknown };
}

/**
 * A picture handed straight to `drawImage` by the skin.
 *
 * `skin.ts` declares its own picture type with every member optional, because the same helpers serve
 * `<img>` elements, `ImageBitmap`s and the bare canvas stand-ins the tests substitute; no size is
 * ever read off a tinted picture here, so requiring one would be a stricter contract than the code
 * has. `CanvasImageSource` is a union of the platform classes rather than an interface they share,
 * so a `{ width, height }` record cannot be *declared* as one, which is why each of these four
 * `drawImage` calls narrows on its own binding instead of the type carrying it.
 */
interface TintDrawable {
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of a sampled line state the renderer reads.
 *
 * `core/scene.ts` declares the full `LineState`; this names only the members the renderer touches,
 * so the `drawLine` tests can call it with a hand-built stand-in and the render loop can pass the
 * compiled state unchanged. `color` is the RGB triple the line tint and the line texture read.
 */
interface ScreenState {
  x: number;
  y: number;
  rotation: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  color: RgbColor;
  text: string;
  incline: number;
  floor: number;
}

/**
 * A sampled line state as `preview-guides.ts` consumes it: the screen-space members it reads, or
 * nothing at all for a line index outside the compiled scene.
 */
type GuideState = ScreenState | undefined;

/**
 * The part of a chart event the renderer reads when it tests a line's text track.
 *
 * `JudgeLine.extended` is an event layer, whose `textEvents` is a `ChartEvent[]`; this module only
 * ever asks for its length, and the authoring module that builds it is still untyped.
 */
interface LineTextEventSource {
  textEvents?: unknown;
}

/**
 * The subset of a chart effect the shader pipeline reads back.
 *
 * `ShaderRuntime.active` reports effects whose `shader` and `sourceName` are both declared, but the
 * pipeline's callback signature is still inferred from `ShaderPipeline`, so the parameter is bound
 * explicitly here rather than inferred through it. `core/shader.ts` declares its own effect record,
 * which already carries both members as `unknown`, so this narrows rather than replaces it.
 */
type ShaderPass = Omit<ShaderEffectRecord, 'shader'> & { shader: string; sourceName: string };

/** One text-track layout: its wrapped lines and the metrics used to place them. */
interface LineTextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
  ascent: number;
}

/**
 * One note's clickable capsule in canvas pixels.
 *
 * `x1,y1` is the head and `x2,y2` the tail, so a hold note's whole length is hittable; `radius` is
 * widened for long notes by the caller. `lineIndex` is what a hit reports back.
 */
export interface NoteHitArea {
  lineIndex: number;
  /** The note's position in that line's `notes` array, so a click can name the exact note. */
  noteIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
  /** Extra collision geometry supplied to mods (3D camera picking). */
  type?: number;
  collisionWidth?: number;
  collisionHeight?: number;
  rotation?: number;
  polygon?: { x: number; y: number }[] | null;
}

export class Preview {
  /**
   * Every field is declared explicitly rather than inferred from the constructor's assignments: the
   * canvases start as `null` on the server path, the caches start empty or `null`, and the settings
   * are written from `app.ts` after construction. Inference from the constructor alone would narrow
   * each one to the type of its first assignment — `null` for the canvases — and every later write
   * from another module would fail. The renderer also drives `app.ts`, which reads and writes most
   * of these directly, so the types here are the contract for that file too.
   */
  canvas: HTMLCanvasElement;
  scene: SceneRuntime;
  shaderRuntime: ShaderRuntime;
  shaderPipeline: ShaderPipeline;
  backgroundFrame: PreviewBackground;
  /**
   * The noise-area renderer 0.10.2 added, built with the preview and driven from `draw`.
   *
   * Required rather than optional: `app.ts` writes `noisePreview.seamless` from the saved
   * preferences and `pickNoiseArea` queries its hit list, and the constructor always assigns it.
   */
  noisePreview: NoisePreview;
  overlayCanvas: HTMLCanvasElement | null;
  shaderCanvas: HTMLCanvasElement | null;
  /** Assigned by `app.ts` after construction; the guard in `draw` tolerates its absence. */
  invalidate?: () => void;
  /** Draw every judge line rather than the selected one; bound to the preview-mode control. */
  allLines: boolean;
  visible: boolean;
  noteSize: number;
  lineScale: number;
  backgroundAlpha: number;
  backgroundBlur: number;
  effectsSince: number;
  applyShaders: boolean;
  opacity: number;
  showHitEffects: boolean;
  /**
   * The screen-space capsules the notes drawn this frame occupy.
   *
   * Rebuilt on every frame so `pickNote` can map a click back to a judge line. Each entry is the note
   * head's screen point and its tail's, plus the radius the hit test allows.
   */
  noteHitAreas: NoteHitArea[];
  /** Text-track layouts cached by their text, cleared when a font finishes loading. */
  lineTextLayouts: Map<string, LineTextLayout>;
  /** The scratch context used to measure text, created lazily from the fallback context. */
  lineTextMeasure?: CanvasRenderingContext2D | null;
  /** The scale the last frame was drawn with; read by projection mods. */
  viewScale?: number;
  /** Enables the extra collision geometry mods read from `noteHitAreas`. */
  collisionGeometry?: boolean;
  /** World-capture camera offset installed by the 3D camera mod. */
  cameraX?: number;
  /**
   * The display toggles. The constructor never assigns any of them — they are installed from the
   * saved editor preferences by `app.ts` before the first frame, and `view-controls.ts` augmentates
   * this class for `showGameUI`. `declare` states the type without emitting an initializer the
   * original never wrote, so a preview that has never been configured still reads `undefined` for
   * each of these and every guard below keeps behaving exactly as before.
   */
  declare showGameUI: boolean;
  declare lineNumbers: boolean;
  declare lineArrows: boolean;
  declare lineTint: boolean;
  declare mergeLineNumbers: boolean;
  declare pickPreviewLines: boolean;
  /**
   * The noise-area click toggle 0.10.2 added, written from the saved preferences by `app.ts`.
   *
   * Declared like its neighbours so the constructor emits no initializer: `pickNoiseArea` tests
   * `=== false`, so a preview that was never configured still picks, exactly as before.
   */
  declare pickPreviewNoiseAreas: boolean;
  declare highlight: boolean;
  /**
   * Draw every judge line fully opaque, ignoring its own fade animation.
   *
   * Set by the noise-tracking sampler around a frame it is capturing, so the line being traced is
   * never hidden by an alpha animation. Unset means normal opacity.
   */
  forceLineOpacity?: boolean | undefined;
  /**
   * The view settings `view-controls.ts` and `app.ts` push in. `draw` guards each read with `??`, so
   * they start unset and are declared optional rather than assigned a default the old code did not
   * have — a default stored here would be indistinguishable from a value the editor chose.
   */
  aspectRatio?: number | undefined;
  duration?: number | undefined;
  /**
   * The zoom divisor `view-controls.ts` and `app.ts` push in.
   *
   * Declared as a required `number` to match the `Preview` augmentation in `view-controls.ts`, which
   * also declares `showGameUI`; the two declarations must be identical, so this one carries no
   * optionality and no initializer. `declare` is what lets the type be stated without emitting an
   * assignment the original constructor never made — the field genuinely starts `undefined` at
   * runtime, which is what `draw`'s `?? 1` fallback has always covered.
   */
  declare viewDivisor: number;
  /**
   * The texture store and the skin, both installed by `app.ts` once the project is loaded.
   *
   * Optional because `draw` runs before a project is open — the tests construct a bare preview and
   * call it immediately — and every read already goes through `?.`.
   */
  images?: ProjectImages;
  skin?: RpeSkin;
  /** The chart, the compiled scene and everything the last frame computed, for `pick` and `drawGuides`. */
  chart?: Chart;
  guides?: LineGuide[];
  viewport?: PreviewViewport | null;
  selectedLine?: number;
  /**
   * The noise area `noise-area.ts` has focused, or `-1` for none.
   *
   * Written by `app.ts` on every editor tick and read by `draw` / `drawGuides`; `-1` is the
   * "nothing selected" value the noise editor itself uses, so the field stays a plain number.
   */
  selectedNoiseArea?: number;
  simultaneous?: Set<Note>;
  completionTimes?: number[];
  passes?: RenderPass[];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas; this.scene = new SceneRuntime(); this.shaderRuntime = new ShaderRuntime(() => this.invalidate?.()); this.shaderPipeline = new ShaderPipeline(() => this.invalidate?.());
    this.backgroundFrame = new PreviewBackground();
    this.noisePreview = new NoisePreview();
    this.allLines = true; this.visible = false; this.noteSize = 175; this.lineScale = 1.5; this.backgroundAlpha = 0.35; this.backgroundBlur = 10.5; this.effectsSince = Infinity; this.applyShaders = true; this.opacity = 1; this.showHitEffects = true;
    this.noteHitAreas = [];
    this.lineTextLayouts = new Map();
    if (typeof document !== 'undefined') document.fonts?.addEventListener('loadingdone', () => { this.lineTextLayouts.clear(); this.invalidate?.(); });
    if (typeof document === 'undefined') { this.overlayCanvas = null; this.shaderCanvas = null; return; }
    this.overlayCanvas = document.createElement('canvas'); this.shaderCanvas = document.createElement('canvas');
    for (const [layer, canvasLayer] of [['shader', this.shaderCanvas], ['overlay', this.overlayCanvas]] as const) {
      canvasLayer.className = `preview-${layer}-layer`; canvasLayer.setAttribute('aria-hidden', 'true'); canvasLayer.style.position = 'absolute'; canvasLayer.style.inset = '0'; canvasLayer.style.width = '100%'; canvasLayer.style.height = '100%'; canvasLayer.style.pointerEvents = 'none'; canvasLayer.style.visibility = 'hidden'; canvasLayer.style.zIndex = layer === 'shader' ? '1' : '2';
      canvas.parentElement?.insertBefore(canvasLayer, canvas.nextSibling);
    }
  }

  draw(chart: Chart, tempo: TempoMap, seconds: number, selectedLine: number): void {
    if (!this.visible) return;
    const rectangle = this.canvas.getBoundingClientRect();
    if (!(rectangle.width > 0 && rectangle.height > 0)) {
      // A live preview may be temporarily stashed or hidden by a mod. Keep its backing
      // store intact and avoid feeding zero-size surfaces into background/shader passes.
      this.noteHitAreas = []; this.guides = []; this.viewport = null;
      this.noisePreview.guides = []; this.noisePreview.hitEntries = [];
      for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer) layer.style.visibility = 'hidden';
      return;
    }
    // Auxiliary surfaces belong to the preview even when its live canvas is relocated.
    for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer && layer.parentElement !== this.canvas.parentElement) this.canvas.after(layer);
    this.chart = chart;
    if (this.scene.chart !== chart || this.scene.tempo !== tempo) {
      this.scene.compile(chart, tempo); this.simultaneous = simultaneousNotes(chart, tempo);
      this.completionTimes = this.scene.lines.flatMap(runtime => runtime.notes.filter(entry => !entry.note.isFake).map(entry => entry.note.type === 2 ? entry.end : entry.start)).sort((left, right) => left - right);
      this.passes = renderPasses(chart.judgeLineList, this.scene.order);
      this.shaderRuntime.compile(chart, tempo);
    }
    const { context, width, height } = prepareCanvas(this.canvas, rectangle);
    const viewport = previewViewport(width, height, this.aspectRatio ?? 1.5);
    const divisor = this.viewDivisor ?? 1;
    const scale = viewport.scale / divisor;
    context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
    const skinScene = (noiseLayers(chart) as NoiseLayer[]).some(layer => this.noisePreview.usesSkin(layer));
    if (this.applyShaders || skinScene) { context.fillStyle = '#111'; context.fillRect(viewport.left, viewport.top, viewport.width, viewport.height); }
    this.drawBackground(context, chart, tempo, seconds, selectedLine, { width, height, viewport, scale, divisor });
    const positionScale = previewPositionScale(this.aspectRatio ?? 1.5);
    const states = this.scene.sample(seconds, positionScale);
    this.viewScale = scale; this.viewport = viewport; this.selectedLine = selectedLine;
    this.drawScene(context, chart, tempo, seconds, selectedLine, { width, height, viewport, scale, divisor, states: states as LineState[], positionScale });
    const shaderEffects = this.applyShaders ? this.shaderRuntime.active(seconds) : [];
    const localEffects = shaderEffects.filter(effect => !effect.global);
    const globalEffects = shaderEffects.filter(effect => effect.global);
    const shaderEffect = (effect: typeof shaderEffects[number]): string => this.shaderRuntime.source(effect.shader, effect.sourceName);
    const renderShaders = (effects: typeof shaderEffects): boolean => effects.length > 0 && this.shaderPipeline.render(this.canvas, this.shaderCanvas as HTMLCanvasElement, effects, seconds, shaderEffect, viewport);
    if (renderShaders(localEffects)) {
      context.clearRect(viewport.left, viewport.top, viewport.width, viewport.height);
      context.drawImage(this.shaderCanvas as HTMLCanvasElement, 0, 0, width, height);
    }
    if (this.showGameUI) this.drawUi(context, chart, tempo, seconds, selectedLine, { viewport, scale, states: states as LineState[] });
    this.drawGuides(context, scale, selectedLine);
    this.noisePreview.draw(context, chart, tempo, seconds, width, height, scale, this.selectedNoiseArea, viewport);
    this.noisePreview.drawGuides(context, scale, this.selectedNoiseArea, this.lineNumbers);
    context.restore();
    const shaderRendered = renderShaders(globalEffects);
    if (this.shaderCanvas) this.shaderCanvas.style.visibility = shaderRendered ? 'visible' : 'hidden';
    if (this.overlayCanvas) this.overlayCanvas.style.visibility = 'hidden';
    if (this.canvas.style) this.canvas.style.opacity = shaderRendered ? '0' : String(clamp(this.opacity));
    for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer) layer.style.opacity = String(clamp(this.opacity));
    this.images?.trim?.();
  }

  drawBackground(context: CanvasRenderingContext2D, chart: Chart, tempo: TempoMap, seconds: number, selectedLine: number, { width, height, scale, center }: { width: number; height: number; viewport?: PreviewViewport; scale: number; divisor?: number; center?: { x: number; y: number } }): void {
    void chart; void tempo; void seconds; void selectedLine;
    let background: PreviewImage | null | undefined = this.images?.background;
    if (background && this.images?.texture && this.images) {
      const store = this.images;
      const measured = background as SizedImage;
      const loaded = store.texture(store.backgroundName ?? '', Math.max(1350 / measured.naturalWidth, 900 / measured.naturalHeight) * scale * (devicePixelRatio || 1));
      background = loaded ?? background;
    }
    if (!background) { this.backgroundFrame.clear(); return; }
    context.save();
    if (center) context.translate(-center.x * scale, center.y * scale);
    context.globalAlpha = this.backgroundAlpha;
    this.backgroundFrame.draw(context, background as SizedImage, width, height, scale, this.backgroundBlur, devicePixelRatio || 1, Boolean(center) || this.images?.backgroundAnimated === true);
    context.restore();
  }

  drawUi(context: CanvasRenderingContext2D, chart: Chart, tempo: TempoMap, seconds: number, selectedLine: number, { viewport, scale, states }: { viewport: PreviewViewport; scale: number; states: LineState[] }): void {
    void tempo;
    drawGameUi(context, chart, states, this.completionTimes ?? [], seconds, selectedLine, viewport, scale, this.skin ?? null, this.duration ?? 600);
  }

  // Independent world pass, allowing optional modules to project it before screen effects and UI.
  drawScene(context: CanvasRenderingContext2D, chart: Chart, tempo: TempoMap, seconds: number, selectedLine: number, { width, height, viewport, scale, divisor, states, center, cullNotes = false, positionScale = previewPositionScale(this.aspectRatio ?? 1.5) }: { width: number; height: number; viewport: PreviewViewport; scale: number; divisor: number; states: LineState[]; center?: { x: number; y: number }; cullNotes?: boolean; positionScale?: PositionScale }): void {
    void tempo;
    const originX = width / 2 - (center?.x ?? 0) * scale, originY = height / 2 + (center?.y ?? 0) * scale;
    const order = this.allLines ? this.scene.order : [selectedLine];
    this.guides = lineGuides(this.forceLineOpacity ? states.map(state => ({ ...(state ?? {}), alpha: 255 })) as GuideState[] : states as GuideState[], chart.judgeLineList, order, width, height, scale);
    if (center) for (const guide of this.guides) { guide.x -= center.x * scale; guide.y += center.y * scale; }
    const visibleNotes = new Map<number, HitEntry[]>(order.map(index => [index, this.scene.lines[index]?.visibleNotes(seconds, states[index] as ScreenState, (1600 * divisor + Math.hypot((states[index]?.x ?? 0) - (center?.x ?? 0), (states[index]?.y ?? 0) - (center?.y ?? 0))) / positionScale.y) ?? []]));
    const noteAspects = new Map<number, number>();
    this.noteHitAreas = [];
    for (const pass of this.passes ?? []) for (const index of pass.kind === 'line' ? [pass.index ?? 0] : order) {
      if (pass.kind === 'line' && ((!this.allLines && index !== selectedLine) || !this.forceLineOpacity && (chart.judgeLineList[index].attachUI || (states[index]?.alpha ?? 0) <= 0) || states[index]?.scaleX === 0 || states[index]?.scaleY === 0)) continue;
      const runtime = this.scene.lines[index];
      const state = states[index];
      if (!runtime || !state) continue;
      if (pass.kind === 'line' && !(runtime.line.extended?.textEvents as LineTextEventSource[] | undefined)?.length) {
        const descriptor: PreviewImage | undefined = this.images?.describe?.(runtime.line.Texture);
        const texture: PreviewImage | undefined = runtime.line.Texture && runtime.line.Texture !== 'line.png'
          ? descriptor ?? this.images?.images.get(runtime.line.Texture)
          : { naturalWidth: DEFAULT_LINE_WIDTH, naturalHeight: DEFAULT_LINE_HEIGHT * this.lineScale };
        if (!texture || texture.naturalWidth && !textureInViewport(texture as SizedImage, runtime.line, center ? { ...state, x: state.x - center.x, y: state.y - center.y } : state, width, height, scale, viewport)) continue;
      }
      context.save();
      context.translate(originX + state.x * scale, originY - state.y * scale);
      context.rotate(state.rotation * Math.PI / 180);
      if (pass.kind === 'line') {
        const packColor = this.skin?.resourcePack?.perfectColor;
        const usePackColor = packColor && (!runtime.line.Texture || runtime.line.Texture === 'line.png') && !runtime.line.attachUI && !runtime.line.extended?.textEvents?.length && !runtime.line.extended?.colorEvents?.length;
        const lineState: TintedLineState = { ...state, ...(usePackColor ? { color: packColor.rgb, alpha: state.alpha * packColor.alpha } : {}), ...(this.forceLineOpacity ? { alpha: 255 } : {}), ...(this.lineTint && index === selectedLine ? { color: [0, 200, 0] } : {}) };
        this.drawLine(context, runtime.line, lineState, scale);
      } else for (const entry of visibleNotes.get(index) ?? []) {
        const note = entry.note;
        if ((note.type === 2) !== (pass.kind === 'hold')) continue;
        const position = previewNotePosition(runtime.noteState(entry, state, seconds), runtime.line, positionScale);
        if (position.alpha <= 0 || position.size === 0) continue;
        const highlight = this.highlight !== false && this.simultaneous?.has(note) === true;
        const textureScale = this.skin?.noteScale?.(highlight) ?? 1;
        const baseNoteWidth = this.noteSize * scale * position.size, baseHeightWidth = this.noteSize * scale * ((position as typeof position & { sizeY?: number }).sizeY ?? 1);
        const noteWidth = baseNoteWidth * textureScale, heightWidth = baseHeightWidth * textureScale;
        const horizontal = position.x * scale;
        const rotation = state.rotation * Math.PI / 180;
        const worldX = state.x + position.x * Math.cos(rotation) + position.y * Math.sin(rotation);
        const worldY = -state.y + position.x * Math.sin(rotation) - position.y * Math.cos(rotation);
        const screenX = originX + worldX * scale;
        const screenY = originY + worldY * scale;
        const tail = note.type === 2 && Number.isFinite(position.tail) ? position.tail : position.y;
        const tailWorldX = state.x + position.x * Math.cos(rotation) + tail * Math.sin(rotation);
        const tailWorldY = -state.y + position.x * Math.sin(rotation) - tail * Math.cos(rotation);
        const tailX = originX + tailWorldX * scale, tailY = originY + tailWorldY * scale;
        if (cullNotes) {
          const aspectKey = note.type * 2 + Number(highlight);
          let aspect = noteAspects.get(aspectKey);
          if (aspect === undefined) { const image = this.skin?.noteImage?.(note.type, Boolean(aspectKey % 2)); aspect = image ? ((image.naturalHeight ?? image.height ?? 0) / (image.naturalWidth ?? image.width ?? 1)) : note.type === 2 ? 1 : 0.12; noteAspects.set(aspectKey, aspect); }
          const padding = Math.max(12, Math.abs(noteWidth) + Math.abs(heightWidth) * aspect * (1 + Math.abs(Math.tan(position.skew * Math.PI / 180))));
          if (Math.max(screenX, tailX) + padding < viewport.left || Math.min(screenX, tailX) - padding > viewport.left + viewport.width ||
              Math.max(screenY, tailY) + padding < viewport.top || Math.min(screenY, tailY) - padding > viewport.top + viewport.height) continue;
        }
        const hitArea: NoteHitArea = { lineIndex: index, noteIndex: entry.index, type: note.type, x1: screenX, y1: screenY, x2: tailX, y2: tailY, radius: Math.max(12, noteWidth * 0.65) };
        if (this.collisionGeometry) {
          const outline = this.skin?.noteImage?.(note.type, highlight);
          const aspect = outline ? (outline.naturalHeight ?? outline.height ?? 0) / (outline.naturalWidth ?? outline.width ?? 1) : 0.12;
          const halfHeight = Math.max(this.skin?.resourcePack ? 0 : 2.5, Math.abs(heightWidth) * aspect / 2);
          const cosine = Math.cos(rotation), sine = Math.sin(rotation), skew = Math.tan(position.skew * Math.PI / 180);
          hitArea.collisionWidth = Math.abs(noteWidth); hitArea.collisionHeight = halfHeight * 2; hitArea.rotation = rotation;
          hitArea.polygon = note.type === 2 ? null : [[-noteWidth / 2, -halfHeight], [noteWidth / 2, -halfHeight], [noteWidth / 2, halfHeight], [-noteWidth / 2, halfHeight]].map(([dx, dy]) => ({ x: screenX + ((dx ?? 0) + (dy ?? 0) * skew) * cosine - (dy ?? 0) * sine, y: screenY + ((dx ?? 0) + (dy ?? 0) * skew) * sine + (dy ?? 0) * cosine }));
        }
        this.noteHitAreas.push(hitArea);
        context.save();
        context.globalAlpha = clamp(position.alpha);
        const tint = (note.tint ?? note.color) as RgbColor | undefined;
        context.fillStyle = Array.isArray(tint) ? `rgb(${tint.join(',')})` : NOTE_COLORS[note.type];
        let drawnHold = false;
        if (note.type === 2) drawnHold = this.skin?.hold(context, horizontal, -position.y * scale, -position.tail * scale, baseNoteWidth, highlight, position.showHead, tint, baseHeightWidth) ?? false;
        if (note.type === 2 && !drawnHold) {
          context.globalAlpha *= 0.55;
          context.fillRect(horizontal - noteWidth / 2, -position.tail * scale, noteWidth, (position.tail - position.y) * scale);
          context.globalAlpha = clamp(position.alpha);
        }
        if (position.showHead && !drawnHold) {
          context.translate(horizontal, -position.y * scale);
          context.transform(1, 0, Math.tan(position.skew * Math.PI / 180), 1, 0, 0);
          if (!this.skin?.head(context, note.type as NoteType, 0, 0, baseNoteWidth, highlight, tint, 5, baseHeightWidth)) context.fillRect(-noteWidth / 2, -2, noteWidth, 4);
        }
        context.restore();
      }
      context.restore();
    }
    if (this.showHitEffects) {
      const hitStates = new Map<number, SceneSampler>();
      for (const index of order) {
        const runtime = this.scene.lines[index];
        if (!runtime) continue;
        for (const hit of recentHits(runtime, seconds, this.effectsSince, this.skin?.hitLifetime ?? Math.max(HIT_DURATION, 2 / 3))) {
          const { entry, time, seed } = hit;
          const hitTint = (entry.note.tintHitEffects ?? [255, 236, 160]) as RgbColor;
          if (!hitStates.has(time)) hitStates.set(time, this.scene.sampler(time, positionScale));
          const hitState = hitStates.get(time)?.(index);
          if (!hitState) continue;
          const position = previewNotePosition(runtime.noteState(entry, hitState, time), runtime.line, positionScale);
          const angle = hitState.rotation * Math.PI / 180;
          const horizontal = originX + (hitState.x + position.x * Math.cos(angle) + position.y * Math.sin(angle)) * scale;
          const vertical = originY + (-hitState.y + position.x * Math.sin(angle) - position.y * Math.cos(angle)) * scale;
          const size = this.noteSize * 1.4 * scale;
          if (cullNotes && (horizontal + size * 2 < viewport.left || horizontal - size * 2 > viewport.left + viewport.width || vertical + size * 2 < viewport.top || vertical - size * 2 > viewport.top + viewport.height)) continue;
          if (this.skin?.drawHit?.(context, { age: seconds - time, x: horizontal, y: vertical, size, rotation: angle, color: hitTint, seed: index * 65537 + seed })) continue;
          const frame = hitFrame(seconds - time);
          const picture = frame === null ? null : this.skin?.tinted(`img-${frame}`, hitTint);
          if (picture) context.drawImage(picture as CanvasImageSource, horizontal - size / 2, vertical - size / 2, size, size);
          context.fillStyle = `rgb(${hitTint.join(',')})`;
          for (const particle of hitParticles(seconds - time, index * 65537 + seed, this.noteSize * scale)) {
            context.globalAlpha = particle.alpha;
            context.fillRect(horizontal + particle.x - particle.radius, vertical + particle.y - particle.radius, particle.radius * 2, particle.radius * 2);
          }
          context.globalAlpha = 1;
        }
      }
    }
  }

  pick(clientX: number, clientY: number): number | null {
    if (!this.visible || !this.pickPreviewLines || !this.viewport) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const view = this.viewport;
    if (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height) return null;
    return pickGuide(this.guides ?? [], point, this.selectedLine ?? -1);
  }

  /**
   * Maps a click to the noise area under it, or `null` for empty space.
   *
   * 0.10.2's addition. The same viewport test as `pick` guards it, and `pickPreviewNoiseAreas`
   * keeps the same `=== false` reading: unset (a preview that was never configured) still picks.
   * `noisePreview.pick` is the only place the drawn areas are queried, so a preview with no noise
   * areas has an empty hit list and returns `null` without this method needing a guard.
   */
  pickNoiseArea(clientX: number, clientY: number): number | null {
    if (!this.visible || this.pickPreviewNoiseAreas === false || !this.viewport) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const view = this.viewport;
    if (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height) return null;
    return this.noisePreview.pick(point.x, point.y);
  }

  /**
   * Maps a click to the judge line of the note under it, or `null` for empty space.
   *
   * The areas are tested newest-first, so the note drawn on top wins, and the distance is measured to
   * the head-to-tail segment rather than to the head alone, which is what makes a hold note's length
   * clickable.
   */
  pickNote(clientX: number, clientY: number): number | null {
    return this.pickNoteTarget(clientX, clientY)?.lineIndex ?? null;
  }

  /**
   * Maps a click to the note under it, reporting both its line and its index within that line.
   *
   * The areas are tested newest-first, so the note drawn on top wins, and the distance is measured to
   * the head-to-tail segment rather than to the head alone, which is what makes a hold note's length
   * clickable.
   */
  pickNoteTarget(clientX: number, clientY: number): { lineIndex: number; noteIndex: number } | null {
    if (!this.visible || !this.noteHitAreas?.length) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const distanceToSegment = (area: NoteHitArea): number => {
      const dx = area.x2 - area.x1; const dy = area.y2 - area.y1;
      const length = dx * dx + dy * dy;
      const amount = length ? Math.max(0, Math.min(1, ((point.x - area.x1) * dx + (point.y - area.y1) * dy) / length)) : 0;
      return Math.hypot(point.x - (area.x1 + amount * dx), point.y - (area.y1 + amount * dy));
    };
    // The preview viewport is the only region notes are drawn into, so a click outside it is empty
    // space even when a stale hit area happens to sit under the pointer.
    const view = this.viewport;
    if (view && (point.x < view.left || point.x > view.left + view.width || point.y < view.top || point.y > view.top + view.height)) return null;
    const area = this.noteHitAreas.slice().reverse().find(entry => distanceToSegment(entry) <= entry.radius);
    return area ? { lineIndex: area.lineIndex, noteIndex: area.noteIndex } : null;
  }

  drawGuides(context: CanvasRenderingContext2D, scale: number, selectedLine: number): void {
    if (!this.lineNumbers && !this.lineArrows) return;
    for (const group of mergeGuides(this.guides ?? [], scale, this.mergeLineNumbers)) {
      context.save(); context.translate(group.x, group.y); context.rotate(group.rotation * Math.PI / 180);
      const selected = group.indices.includes(selectedLine);
      context.fillStyle = selected ? '#00c800' : '#fff';
      if (this.lineNumbers) {
        context.font = `${30 * scale}px RPEGame, sans-serif`; context.textAlign = 'center'; context.textBaseline = 'top';
        const text = formatLineNumbers(group.indices, this.chart?.judgeLineList ?? null);
        context.fillText(text, 0, 4 * scale);
      }
      if (this.lineArrows && selected) {
        const arrow = this.skin?.images.get('Arrow2');
        if (arrow) {
          context.save(); context.rotate(Math.PI); context.drawImage(arrow as CanvasImageSource, -25 * scale, -25 * scale, 50 * scale, 50 * scale); context.restore();
        } else {
          context.beginPath(); context.moveTo(0, -24 * scale); context.lineTo(-12 * scale, -8 * scale); context.lineTo(12 * scale, -8 * scale); context.closePath(); context.fill();
        }
      }
      context.restore();
    }
  }

  drawLine(context: CanvasRenderingContext2D, line: JudgeLineSource, state: TintedLineState, scale: number): void {
    const anchor = line.anchor ?? [0.5, 0.5];
    context.save();
    context.scale(state.scaleX, state.scaleY);
    context.globalAlpha = clamp(state.alpha / 255);
    context.fillStyle = `rgb(${state.color.map(value => Math.round(Math.max(0, Math.min(255, value)))).join(',')})`;
    if ((line.extended?.textEvents as LineTextEventSource[] | undefined)?.length) {
      context.font = `${52 * scale}px RPE, sans-serif`;
      context.textAlign = 'left'; context.textBaseline = 'alphabetic';
      const layout = this.lineTextLayout(state.text, context);
      context.font = `${52 * scale}px RPE, sans-serif`;
      const left = -layout.width * (anchor[0] ?? 0) * scale, top = -layout.height * (1 - (anchor[1] ?? 0)) * scale;
      layout.lines.forEach((text, index) => context.fillText(text, left, top + (layout.ascent + index * layout.lineHeight) * scale));
    } else {
      const defaultLine = !line.Texture || line.Texture === 'line.png';
      const descriptor = !defaultLine ? this.images?.describe?.(line.Texture) : null;
      const stateScale = scale * Math.max(Math.abs(state.scaleX), Math.abs(state.scaleY)) * (devicePixelRatio || 1);
      const maxViewportScale = descriptor?.naturalWidth && descriptor?.naturalHeight
        ? Math.min(2700 / descriptor.naturalWidth, 1800 / descriptor.naturalHeight)
        : Infinity;
      const decodeCap = Number.isFinite(maxViewportScale) && maxViewportScale < 1
        ? 2 ** Math.floor(Math.log2(Math.max(1 / 64, maxViewportScale)))
        : 1;
      const viewportScale = Math.min(stateScale, decodeCap);
      // `skin.ts` reports a tinted picture, a decoded record, or nothing; the picture it reports
      // declares no size, and no size is read off it here — every use below is a `drawImage`.
      const rawTexture: PreviewImage | null | undefined = defaultLine ? null : this.images?.texture ? this.images.texture(line.Texture, viewportScale) : this.images?.images.get(line.Texture);
      const source = (rawTexture?.source ?? rawTexture) as TintDrawable | undefined;
      const texture = (defaultLine ? this.skin?.tinted('line', state.color) : this.skin?.tintedSource(`line:${line.Texture}`, source, state.color)) as TintDrawable | null | undefined;
      if (defaultLine) {
        const height = DEFAULT_LINE_HEIGHT * this.lineScale * scale;
        const left = -DEFAULT_LINE_WIDTH * scale * (anchor[0] ?? 0), top = -height * (1 - (anchor[1] ?? 0));
        if (texture) context.drawImage(texture as CanvasImageSource, left, top, DEFAULT_LINE_WIDTH * scale, height);
        else context.fillRect(left, top, DEFAULT_LINE_WIDTH * scale, height);
      } else if (texture && rawTexture) {
        // `naturalWidth`/`naturalHeight` are optional on a texture record and `width`/`height` are
        // read off the same picture, so the union of the two has no guaranteed member; the binding
        // is typed as the number the original passed to `drawImage` in every case. A record missing
        // both keeps producing `undefined` here, which `drawImage` treats as it always did.
        const width = (rawTexture.naturalWidth ?? rawTexture.width) as number;
        const height = (rawTexture.naturalHeight ?? rawTexture.height) as number;
        context.drawImage(texture as CanvasImageSource, -width * (anchor[0] ?? 0) * scale, -height * (1 - (anchor[1] ?? 0)) * scale, width * scale, height * scale);
      }
    }
    context.restore();
  }

  lineTextLayout(value: unknown, fallbackContext: CanvasRenderingContext2D): LineTextLayout {
    const text = String(value ?? '');
    const cached = this.lineTextLayouts.get(text);
    if (cached) return cached;
    this.lineTextMeasure ??= typeof document === 'undefined' ? fallbackContext : document.createElement('canvas').getContext('2d');
    const context = this.lineTextMeasure!;
    context.font = '52px RPE, sans-serif'; context.textAlign = 'left'; context.textBaseline = 'alphabetic';
    const lines = text.split(/\r?\n/), metrics = lines.map(line => context.measureText(line));
    const ascent = metrics.reduce((maximum, metric) => Math.max(maximum, metric.fontBoundingBoxAscent ?? metric.actualBoundingBoxAscent ?? 41.6), 0);
    const descent = metrics.reduce((maximum, metric) => Math.max(maximum, metric.fontBoundingBoxDescent ?? metric.actualBoundingBoxDescent ?? 10.4), 0);
    const lineHeight = Math.max(1, ascent + descent);
    if (this.lineTextLayouts.size >= 128) this.lineTextLayouts.delete(this.lineTextLayouts.keys().next().value!);
    const layout: LineTextLayout = { lines, width: metrics.reduce((maximum, metric) => Math.max(maximum, metric.width), 0), height: lineHeight * lines.length, lineHeight, ascent };
    this.lineTextLayouts.set(text, layout);
    return layout;
  }
}
