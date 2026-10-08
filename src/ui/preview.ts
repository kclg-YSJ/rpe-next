import { SceneRuntime } from '../core/scene.ts';
import { prepareCanvas, NOTE_COLORS } from './timeline.ts';
import { DEFAULT_LINE_WIDTH, DEFAULT_LINE_HEIGHT, HIT_DURATION, hitFrame } from '../core/visual-constants.ts';
import { previewViewport, simultaneousNotes, hitParticles } from '../core/editor-display.ts';
import { renderPasses } from '../core/game-ui.ts';
import { drawGameUi } from './game-ui.ts';
import { recentHits } from '../core/hit-effects.ts';
import { lineGuides, mergeGuides, pickGuide, formatLineNumbers } from '../core/preview-guides.ts';
import { ShaderRuntime } from '../core/shader.ts';
import { ShaderPipeline } from './shader-pipeline.ts';
import { PreviewBackground, textureInViewport } from './preview-background.ts';
import type { Chart, Color, Note, NoteType } from '../core/types.ts';
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

/**
 * One note's clickable capsule in canvas pixels.
 *
 * `x1,y1` is the head and `x2,y2` the tail, so a hold note's whole length is hittable; `radius` is
 * widened for long notes by the caller. `lineIndex` is what a hit reports back.
 */
export interface NoteHitArea {
  lineIndex: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number;
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
  declare highlight: boolean;
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
  viewport?: PreviewViewport;
  selectedLine?: number;
  simultaneous?: Set<Note>;
  completionTimes?: number[];
  passes?: RenderPass[];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas; this.scene = new SceneRuntime(); this.shaderRuntime = new ShaderRuntime(() => this.invalidate?.()); this.shaderPipeline = new ShaderPipeline(() => this.invalidate?.());
    this.backgroundFrame = new PreviewBackground();
    this.allLines = true; this.visible = false; this.noteSize = 175; this.lineScale = 1.5; this.backgroundAlpha = 0.35; this.backgroundBlur = 10.5; this.effectsSince = Infinity; this.applyShaders = true; this.opacity = 1; this.showHitEffects = true;
    this.noteHitAreas = [];
    if (typeof document === 'undefined') { this.overlayCanvas = null; this.shaderCanvas = null; return; }
    this.overlayCanvas = document.createElement('canvas'); this.shaderCanvas = document.createElement('canvas');
    for (const [layer, canvasLayer] of [['shader', this.shaderCanvas], ['overlay', this.overlayCanvas]] as const) {
      canvasLayer.className = `preview-${layer}-layer`; canvasLayer.setAttribute('aria-hidden', 'true'); canvasLayer.style.position = 'absolute'; canvasLayer.style.inset = '0'; canvasLayer.style.width = '100%'; canvasLayer.style.height = '100%'; canvasLayer.style.pointerEvents = 'none'; canvasLayer.style.visibility = 'hidden'; canvasLayer.style.zIndex = layer === 'shader' ? '1' : '2';
      canvas.parentElement?.insertBefore(canvasLayer, canvas.nextSibling);
    }
  }

  draw(chart: Chart, tempo: TempoMap, seconds: number, selectedLine: number): void {
    if (!this.visible) return;
    this.chart = chart;
    if (this.scene.chart !== chart || this.scene.tempo !== tempo) {
      this.scene.compile(chart, tempo); this.simultaneous = simultaneousNotes(chart, tempo);
      this.completionTimes = this.scene.lines.flatMap(runtime => runtime.notes.filter(entry => !entry.note.isFake).map(entry => entry.note.type === 2 ? entry.end : entry.start)).sort((left, right) => left - right);
      this.passes = renderPasses(chart.judgeLineList, this.scene.order);
      this.shaderRuntime.compile(chart, tempo);
    }
    const { context, width, height } = prepareCanvas(this.canvas);
    const viewport = previewViewport(width, height, this.aspectRatio ?? 1.5);
    const divisor = this.viewDivisor ?? 1;
    const scale = viewport.scale / divisor;
    context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
    if (this.applyShaders) { context.fillStyle = '#111'; context.fillRect(viewport.left, viewport.top, viewport.width, viewport.height); }
    // The image store reports a decoded record or `null`; the fallback keeps the previous one, which
    // is what makes this a `PreviewImage` rather than the store's own `DecodedImage`. `images` is a
    // fully optional dependency here: the tests install a bare `{ background }` literal before a
    // project exists, so both the store and its `texture` method stay behind their own guards and
    // the second `this.images` read is the one that resolves the type.
    let background: PreviewImage | null | undefined = this.images?.background;
    if (background && this.images?.texture && this.images) {
      const store = this.images;
      const measured = background as SizedImage;
      const loaded = store.texture(store.backgroundName ?? '', Math.max(1350 / measured.naturalWidth, 900 / measured.naturalHeight) * scale * (devicePixelRatio || 1));
      background = loaded ?? background;
    }
    if (background) {
      const sized = background as SizedImage;
      context.globalAlpha = this.backgroundAlpha;
      this.backgroundFrame.draw(context, sized, width, height, scale, this.backgroundBlur, devicePixelRatio || 1, this.images?.backgroundAnimated ?? false);
      context.globalAlpha = 1;
    } else this.backgroundFrame.clear();
    const states = this.scene.sample(seconds);
    const order = this.allLines ? this.scene.order : [selectedLine];
    this.viewport = viewport; this.selectedLine = selectedLine;
    this.guides = lineGuides(states as GuideState[], chart.judgeLineList, order, width, height, scale);
    // `visibleNotes` reports hit entries, whose `note` is what the loop below reads. `sample` leaves
    // an out-of-range index `undefined`, which the call already tolerates: `radius` is only read
    // from `states` at that index, and the `undefined` state itself is passed straight through.
    const visibleNotes = new Map<number, HitEntry[]>(order.map(index => [index, this.scene.lines[index]?.visibleNotes(seconds, states[index] as ScreenState, 1600 * divisor + Math.hypot(states[index]?.x ?? 0, states[index]?.y ?? 0)) ?? []]));
    // The hit areas describe the frame about to be drawn, so they are rebuilt from scratch here
    // rather than accumulated across frames.
    this.noteHitAreas = [];
    for (const pass of this.passes ?? []) for (const index of pass.kind === 'line' ? [pass.index ?? 0] : order) {
      if (pass.kind === 'line' && ((!this.allLines && index !== selectedLine) || chart.judgeLineList[index].attachUI || (states[index]?.alpha ?? 0) <= 0 || states[index]?.scaleX === 0 || states[index]?.scaleY === 0)) continue;
      const runtime = this.scene.lines[index];
      const state = states[index];
      if (!runtime || !state) continue;
      if (pass.kind === 'line' && !(runtime.line.extended?.textEvents as LineTextEventSource[] | undefined)?.length) {
        // The three sources are the texture record the store reports, the decoded image it cached,
        // and the literal standing in for the built-in `line.png`. `naturalWidth`/`naturalHeight`
        // stay optional on the record — it is built by spreading a PNG header probe that yields `{}`
        // for a damaged asset — while the literal and the decoded image always carry both sizes, so
        // the looser shape is what the union has to be collected into.
        const descriptor: PreviewImage | undefined = this.images?.describe?.(runtime.line.Texture);
        const texture: PreviewImage | undefined = runtime.line.Texture && runtime.line.Texture !== 'line.png'
          ? descriptor ?? this.images?.images.get(runtime.line.Texture)
          : { naturalWidth: DEFAULT_LINE_WIDTH, naturalHeight: DEFAULT_LINE_HEIGHT * this.lineScale };
        if (!texture || texture.naturalWidth && !textureInViewport(texture as SizedImage, runtime.line, state, width, height, scale, viewport)) continue;
      }
      context.save();
      context.translate(width / 2 + state.x * scale, height / 2 - state.y * scale);
      context.rotate(state.rotation * Math.PI / 180);
      if (pass.kind === 'line') {
        const lineState: TintedLineState = this.lineTint && index === selectedLine ? { ...state, color: [0, 200, 0] } : state;
        this.drawLine(context, runtime.line, lineState, scale);
      } else for (const entry of visibleNotes.get(index) ?? []) {
        const note = entry.note;
        if ((note.type === 2) !== (pass.kind === 'hold')) continue;
        const position = runtime.noteState(entry, state, seconds);
        if (position.alpha <= 0 || position.size === 0) continue;
        const noteWidth = this.noteSize * scale * position.size;
        const horizontal = position.x * scale;
        // The note is placed in the line's rotated frame, so the hit capsule has to be rotated the
        // same way: `worldX`/`worldY` mirror the transform the draw calls below apply.
        const rotation = state.rotation * Math.PI / 180;
        const worldX = state.x + position.x * Math.cos(rotation) + position.y * Math.sin(rotation);
        const worldY = -state.y + position.x * Math.sin(rotation) - position.y * Math.cos(rotation);
        const screenX = width / 2 + worldX * scale;
        const screenY = height / 2 + worldY * scale;
        const tail = Number.isFinite(position.tail) ? position.tail : position.y;
        const tailWorldX = state.x + position.x * Math.cos(rotation) + tail * Math.sin(rotation);
        const tailWorldY = -state.y + position.x * Math.sin(rotation) - tail * Math.cos(rotation);
        this.noteHitAreas.push({ lineIndex: index, x1: screenX, y1: screenY, x2: width / 2 + tailWorldX * scale, y2: height / 2 + tailWorldY * scale, radius: Math.max(12, noteWidth * 0.65) });
        context.save();
        context.globalAlpha = clamp(position.alpha);
        // `Note` indexes unknown keys, so a chart-supplied per-note tint has no declared type. The
        // runtime form is an RGB triple, which is what the two uses below need; the authoring field
        // is typed so the shared `Color` cannot be attached here yet.
        const tint = (note.tint ?? note.color) as RgbColor | undefined;
        context.fillStyle = Array.isArray(tint) ? `rgb(${tint.join(',')})` : NOTE_COLORS[note.type];
        let drawnHold = false;
        const highlight = this.highlight !== false && this.simultaneous?.has(note) === true;
        if (note.type === 2) drawnHold = this.skin?.hold(context, horizontal, -position.y * scale, -position.tail * scale, noteWidth, highlight, position.showHead, tint) ?? false;
        if (note.type === 2 && !drawnHold) {
          context.globalAlpha *= 0.55;
          context.fillRect(horizontal - noteWidth / 2, -position.tail * scale, noteWidth, (position.tail - position.y) * scale);
          context.globalAlpha = clamp(position.alpha);
        }
        if (position.showHead && !drawnHold) {
          context.translate(horizontal, -position.y * scale);
          context.transform(1, 0, Math.tan(position.skew * Math.PI / 180), 1, 0, 0);
          if (!this.skin?.head(context, note.type as NoteType, 0, 0, noteWidth, highlight, tint)) context.fillRect(-noteWidth / 2, -2, noteWidth, 4);
        }
        context.restore();
      }
      context.restore();
    }
    if (this.showHitEffects) {
      // `sampler` resolves one line at a time and is reused for every hit at the same instant; the
      // states themselves stay `undefined`-able, which the guards below cover.
      const hitStates = new Map<number, SceneSampler>();
      for (const index of order) {
        const runtime = this.scene.lines[index];
        if (!runtime) continue;
        for (const hit of recentHits(runtime, seconds, this.effectsSince, Math.max(HIT_DURATION, 2 / 3))) {
          const { entry, time, seed } = hit;
          const frame = hitFrame(seconds - time);
          // The hit tint is an authoring field `Note` indexes as unknown; its runtime form is an RGB
          // triple, and the fallback is the same literal the original wrote out twice.
          const hitTint = (entry.note.tintHitEffects ?? [255, 236, 160]) as RgbColor;
          const picture = frame === null ? null : this.skin?.tinted(`img-${frame}`, hitTint);
          if (!hitStates.has(time)) hitStates.set(time, this.scene.sampler(time));
          const state = hitStates.get(time)?.(index);
          if (!state) continue;
          const position = runtime.noteState(entry, state, time);
          const angle = state.rotation * Math.PI / 180;
          const horizontal = width / 2 + (state.x + position.x * Math.cos(angle) + position.y * Math.sin(angle)) * scale;
          const vertical = height / 2 + (-state.y + position.x * Math.sin(angle) - position.y * Math.cos(angle)) * scale;
          const size = this.noteSize * 1.4 * scale;
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
    const shaderEffects = this.applyShaders ? this.shaderRuntime.active(seconds) : [];
    const globalShader = shaderEffects.some(effect => effect.global);
    if (!shaderEffects.length && this.showGameUI) drawGameUi(context, chart, states, this.completionTimes ?? [], seconds, selectedLine, viewport, scale, this.skin ?? null, this.duration ?? 600);
    if (!shaderEffects.length) this.drawGuides(context, scale, selectedLine);
    if (globalShader) {
      if (this.showGameUI) drawGameUi(context, chart, states, this.completionTimes ?? [], seconds, selectedLine, viewport, scale, this.skin ?? null, this.duration ?? 600);
      this.drawGuides(context, scale, selectedLine);
    }
    context.restore();
    let shaderRendered = false;
    if (shaderEffects.length) {
      // `active` reports each effect's shader name and the source it was authored under; both are
      // read here, so the callback is bound to the effect record rather than the pipeline's
      // narrower `ShaderPass` view. The shader canvas is only null before the first layout, and
      // `render` re-checks the target through `ensure`, so the original passed it straight through;
      // the assertion is erased at runtime.
      const shaderEffect = (effect: typeof shaderEffects[number]): string => this.shaderRuntime.source(effect.shader, effect.sourceName);
      shaderRendered = this.shaderPipeline.render(this.canvas, this.shaderCanvas as HTMLCanvasElement, shaderEffects, seconds, shaderEffect, viewport);
      if (this.shaderCanvas) this.shaderCanvas.style.visibility = shaderRendered ? 'visible' : 'hidden';
    } else if (this.shaderCanvas) this.shaderCanvas.style.visibility = 'hidden';
    if (this.canvas.style) this.canvas.style.opacity = shaderRendered ? '0' : String(clamp(this.opacity));
    for (const layer of [this.shaderCanvas, this.overlayCanvas]) if (layer) layer.style.opacity = String(clamp(this.opacity));
    if (!shaderRendered && shaderEffects.length && !globalShader) {
      context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
      if (this.showGameUI) drawGameUi(context, chart, states, this.completionTimes ?? [], seconds, selectedLine, viewport, scale, this.skin ?? null, this.duration ?? 600);
      this.drawGuides(context, scale, selectedLine); context.restore();
    }
    if (shaderRendered && !globalShader && this.overlayCanvas) {
      const overlay = prepareCanvas(this.overlayCanvas); const overlayContext = overlay.context; overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      if (this.showGameUI) drawGameUi(overlayContext, chart, states, this.completionTimes ?? [], seconds, selectedLine, viewport, scale, this.skin ?? null, this.duration ?? 600);
      this.drawGuides(overlayContext, scale, selectedLine);
      this.overlayCanvas.style.visibility = 'visible';
    } else if (this.overlayCanvas) this.overlayCanvas.style.visibility = 'hidden';
    this.images?.trim?.();
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
   * Maps a click to the judge line of the note under it, or `null` for empty space.
   *
   * The areas are tested newest-first, so the note drawn on top wins, and the distance is measured to
   * the head-to-tail segment rather than to the head alone, which is what makes a hold note's length
   * clickable.
   */
  pickNote(clientX: number, clientY: number): number | null {
    if (!this.visible || !this.noteHitAreas?.length) return null;
    const rectangle = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rectangle.left, y: clientY - rectangle.top };
    const distanceToSegment = (area: NoteHitArea): number => {
      const dx = area.x2 - area.x1; const dy = area.y2 - area.y1;
      const length = dx * dx + dy * dy;
      const amount = length ? Math.max(0, Math.min(1, ((point.x - area.x1) * dx + (point.y - area.y1) * dy) / length)) : 0;
      return Math.hypot(point.x - (area.x1 + amount * dx), point.y - (area.y1 + amount * dy));
    };
    return this.noteHitAreas.slice().reverse().find(area => distanceToSegment(area) <= area.radius)?.lineIndex ?? null;
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
    context.save();
    context.scale(state.scaleX, state.scaleY);
    context.globalAlpha = clamp(state.alpha / 255);
    context.fillStyle = `rgb(${state.color.map(value => Math.round(Math.max(0, Math.min(255, value)))).join(',')})`;
    if ((line.extended?.textEvents as LineTextEventSource[] | undefined)?.length) {
      context.font = `${52 * scale}px RPE, sans-serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(state.text, 0, 0);
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
        if (texture) context.drawImage(texture as CanvasImageSource, -DEFAULT_LINE_WIDTH * scale / 2, -height / 2, DEFAULT_LINE_WIDTH * scale, height);
        else context.fillRect(-DEFAULT_LINE_WIDTH * scale / 2, -height / 2, DEFAULT_LINE_WIDTH * scale, height);
      } else if (texture && rawTexture) {
        const anchor = line.anchor ?? [0.5, 0.5];
        // `naturalWidth`/`naturalHeight` are optional on a texture record and `width`/`height` are
        // read off the same picture, so the union of the two has no guaranteed member; the binding
        // is typed as the number the original passed to `drawImage` in every case. A record missing
        // both keeps producing `undefined` here, which `drawImage` treats as it always did.
        const width = (rawTexture.naturalWidth ?? rawTexture.width) as number;
        const height = (rawTexture.naturalHeight ?? rawTexture.height) as number;
        context.drawImage(texture as CanvasImageSource, -width * anchor[0] * scale, -height * (1 - anchor[1]) * scale, width * scale, height * scale);
      }
    }
    context.restore();
  }
}
