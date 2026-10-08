import { CURVE_PRESETS, TRAJECTORY_DEFAULTS, sampleCurveTrajectory, presetOptions, validateCurvePreset, editableTrajectoryOptions } from '../core/curve-trajectory.ts';
import { createTrajectoryEvent, trajectoryChart, splitTrajectoryChart } from '../application/trajectory-commands.ts';
import { parseBeat, formatBeat } from '../core/beat.ts';
import { SceneRuntime } from '../core/scene.ts';
import { previewViewport } from '../core/editor-display.ts';
import { download } from '../platform/files.ts';
import { prepareCanvas } from './timeline.ts';
import { trajectorySplitSettings } from '../core/trajectory-simplify.ts';
import { parseCurvePreset, saveCurvePreset, deleteCurvePreset, copyCurvePreset } from '../core/trajectory-presets.ts';
import type { Beat, Chart, ChartEvent, CurveTrajectoryOptions, TrajectorySplit } from '../core/types.ts';
import type { CurvePoint, CurvePreset } from '../core/curve-trajectory.ts';
import type { EditorSession } from '../application/session.ts';
import type { LineState } from '../core/scene.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { Timeline } from './timeline.ts';
import type { Preview } from './preview.ts';

const STORAGE_KEY = 'rpe-next-trajectory-presets-v1';

/**
 * One row of the shared control block every preset editor renders.
 *
 * Positional rather than an object because the table is dense: `[option key, label, type, min, max,
 * step]`, with the trailing three omitted for the `checkbox` row, which has no range.
 */
type CommonField = [key: keyof CurveTrajectoryOptions, title: string, type: string, minimum?: number, maximum?: number, step?: number];
const COMMON_FIELDS: CommonField[] = [
  ['trimStart', '截取起点（0–1）', 'number', 0, 1, 0.01], ['trimEnd', '截取终点（0–1）', 'number', 0, 1, 0.01],
  ['rotation', '整体旋转（度）', 'number', -3600, 3600, 1],
  ['scaleX', '横向倍率', 'number', -100, 100, 0.1], ['scaleY', '纵向倍率', 'number', -100, 100, 0.1],
  ['alignStart', '将截取后的起点对齐', 'checkbox'], ['startX', '实际起点 X', 'number', -100000, 100000, 1], ['startY', '实际起点 Y', 'number', -100000, 100000, 1],
  ['randomness', '随机化程度', 'range', 0, 1, 0.01], ['seed', '随机种子', 'number', 0, 100000, 1],
];

/** The controls {@link field} builds: an `<input>` for a scalar row, a `<select>` when it has choices. */
type FieldControl = HTMLInputElement | HTMLSelectElement;

/** One value a control reads back: the string `value` holds, the number a numeric row holds, or a checkbox's boolean. */
type FieldValue = string | number | boolean;

/** Every `[data-key]` control under a host, keyed by the name it was built with. */
type FieldValues = Record<string, FieldValue>;

/**
 * Looks up a node the panel needs outside its own host.
 *
 * The same idiom as `app.ts`'s `element<T>`: the selector names markup the page always ships before
 * the panel is constructed, and the original dereferenced the lookup unguarded.
 */
const element = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;

/**
 * The curve options the panel edits, viewed with the open-ended key space its controls live in.
 *
 * Most of the panel's access is through declared properties, but the `[data-key]` controls are built
 * from, written back to and read off the option bag by the name the DOM carries (see
 * {@link readFields}, the 正式填入轨迹参数 writer and the two keyed control loops), so the compiled
 * options are viewed as the record those keys address. Every entry is a value `CurveTrajectoryOptions`
 * declares; nothing else is ever written into it.
 */
type TrajectoryOptions = CurveTrajectoryOptions & Record<string, unknown>;

/**
 * Views a field bag as the options it was built from.
 *
 * {@link field} creates every control from a `CurveTrajectoryOptions` value, so the value the DOM
 * hands back for it is the kind that property declares — the DOM only widens the numbers to the
 * strings `value` carries, and the bag also carries the panel-level keys that never reach the
 * options. Every consumer re-validates what it gets (`compileTrajectory` rejects non-finite numbers
 * and easing codes outside 1–29, `JSON.parse` rebuilds the parameter dictionary, `parseBeat` the
 * beats), which is the same assumption the untyped original made when it spread the bag into
 * `this.options` unchanged.
 */
function optionsFromFields(values: object): TrajectoryOptions {
  const options: TrajectoryOptions = values as TrajectoryOptions;
  return options;
}

/**
 * The message of a caught failure.
 *
 * Every thrower reachable from this panel's handlers throws an `Error` subclass — `validateCurvePreset`,
 * `parseCurvePreset`, `parseBeat`, `JSON.parse`, `compileTrajectory` and `localStorage` — which is why
 * the original could read `.message` off the caught value; the fallback mirrors the rest of the
 * editor's typed panels.
 */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function field(host: HTMLElement, key: string, title: string, value: unknown, type = 'text', minimum?: number, maximum?: number, step?: number, choices?: [string, string][]): FieldControl {
  const label = document.createElement('label'); label.className = 'field'; label.append(title);
  // The `choices` branch builds a `<select>`; the properties written below are the input's, and the
  // original wrote them on that select as well — where they land as inert expando properties — so the
  // element is viewed as the input those properties belong to. Nothing else differs at runtime.
  const input = document.createElement(choices ? 'select' : 'input') as HTMLInputElement;
  input.dataset.key = key; input.setAttribute('aria-label', title);
  if (choices) input.replaceChildren(...choices.map(([value, text]) => new Option(text, value)));
  else input.type = type;
  if (minimum !== undefined) input.min = String(minimum);
  if (maximum !== undefined) input.max = String(maximum);
  input.step = String(step ?? 'any');
  if (type === 'checkbox') input.checked = Boolean(value); else input.value = String(value ?? '');
  if (key === 'seed') {
    const controls = document.createElement('span'); controls.className = 'trajectory-seed';
    const randomize = document.createElement('button'); randomize.type = 'button'; randomize.textContent = '⚄'; randomize.title = '随机种子'; randomize.setAttribute('aria-label', '生成随机种子');
    randomize.onclick = () => { const previous = Number(input.value); input.value = String((previous + 1 + crypto.getRandomValues(new Uint32Array(1))[0] % 100000) % 100001); input.dispatchEvent(new Event('input', { bubbles: true })); };
    controls.append(input, randomize); label.append(controls);
  } else label.append(input);
  host.append(label); return input;
}
const action = (title: string, run: () => void): HTMLButtonElement => { const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.onclick = run; return button; };

/**
 * Reads every `[data-key]` control under `host` back into a copy of `base`.
 *
 * The controls were all built by {@link field} from `base`'s own values, so each key it carries holds
 * the kind the base had; the DOM only widens the numbers to the strings `value` holds. The keys the
 * base does not declare are the panel-level ones the caller reads off the result by name.
 */
function readFields(host: HTMLElement, base: object): FieldValues {
  const result: FieldValues = { ...base } as FieldValues;
  for (const input of host.querySelectorAll<FieldControl>('[data-key]')) {
    const key = input.dataset.key;
    // The selector matches on `data-key`, so the attribute is always present and this guard is
    // unreachable; it only narrows the `string | undefined` the DOM hands back.
    if (key === undefined) continue;
    result[key] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input instanceof HTMLInputElement && ['number', 'range'].includes(input.type) ? (input.value.trim() ? Number(input.value) : NaN) : input.value;
  }
  return result;
}
function drawPath(canvas: HTMLCanvasElement, points: CurvePoint[] | null, progress = 0): void {
  // `getContext('2d')` answers null only for a context kind the canvas cannot provide, and every
  // canvas here is one this panel created as a 2D canvas; the original dereferenced it unguarded.
  const context = canvas.getContext('2d')!; const width = canvas.width; const height = canvas.height;
  context.clearRect(0, 0, width, height); context.fillStyle = '#242424'; context.fillRect(0, 0, width, height);
  if (!points?.length) return;
  const xs = points.map(point => point.x); const ys = points.map(point => point.y);
  const left = Math.min(...xs); const right = Math.max(...xs); const bottom = Math.min(...ys); const top = Math.max(...ys);
  const scale = Math.min((width - 24) / Math.max(1, right - left), (height - 24) / Math.max(1, top - bottom));
  const map = (point: CurvePoint): [number, number] => [width / 2 + (point.x - (left + right) / 2) * scale, height / 2 - (point.y - (top + bottom) / 2) * scale];
  context.lineWidth = 2; context.strokeStyle = '#edd38c'; context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(...map(point)) : context.moveTo(...map(point))); context.stroke();
  context.fillStyle = '#76efaf'; context.beginPath(); context.arc(...map(points[Math.min(points.length - 1, Math.floor(progress * (points.length - 1)))]), 4, 0, Math.PI * 2); context.fill();
}

/** What the panel reads out of the editor each time it renders or previews. */
interface TrajectoryContext {
  session: EditorSession;
  timeline: Timeline;
  tempo: TempoMap;
  previewVisible: boolean;
}

/** The callbacks the panel drives on the surrounding application. */
interface TrajectoryActions {
  invalidate: () => void;
  notify: (message: string, level?: string, duration?: number) => void;
  /** Switches the right-hand pane; the panel only ever asks for itself or the chart tools. */
  activate: (pane: 'trajectory' | 'chart') => void;
}

/** The preset editor's live draft: the options it built, the samples it drew and where it drew them. */
interface PresetDraft {
  options: TrajectoryOptions;
  points: CurvePoint[];
  canvas: HTMLCanvasElement;
  preset: CurvePreset;
}

/** What {@link TrajectoryPanel.tick} hands the render loop while the realtime preview shows a trajectory. */
export interface TrajectoryView {
  chart: Chart;
  seconds: number;
}

export class TrajectoryPanel {
  // Every field is declared explicitly: a member only assigned in the constructor would otherwise be
  // inferred from that single assignment, and the fields `render`, `renderCustom` and `refresh` fill
  // in later would not exist at all on the class type.
  host: HTMLElement;
  getContext: () => TrajectoryContext;
  invalidate: () => void;
  notify: (message: string, level?: string, duration?: number) => void;
  activate: (pane: 'trajectory' | 'chart') => void;
  options: TrajectoryOptions;
  segments: number;
  splitSettings: TrajectorySplit;
  startTime: Beat;
  endTime: Beat;
  enabled: boolean;
  animate: boolean;
  overlay: HTMLCanvasElement;
  custom: CurvePreset[];
  /** Set by {@link open} and cleared by {@link hide}; gates `refresh` and `tick`. */
  active!: boolean;
  editing!: ChartEvent | null;
  presetDraft!: PresetDraft | null;
  /** The judge line and base layer the panel edits; both are set by {@link open} before `render`. */
  lineIndex!: number;
  layerIndex!: number;
  content!: HTMLDivElement;
  fields!: HTMLDivElement;
  controls!: HTMLDivElement;
  canvas!: HTMLCanvasElement;
  message!: HTMLParagraphElement;
  applyButton!: HTMLButtonElement;
  splitButton!: HTMLButtonElement;
  gallery!: HTMLDivElement;
  customGroup!: HTMLDetailsElement;
  customInput!: HTMLTextAreaElement;
  customMessage!: HTMLParagraphElement;
  customCanvas!: HTMLCanvasElement;
  customSave!: HTMLButtonElement;
  customCopy!: HTMLButtonElement;
  customExport!: HTMLButtonElement;
  customEditingName!: string | null;
  customSource: string | undefined;
  replace!: boolean;
  points!: CurvePoint[] | null;
  worldPoints!: LineState[] | null;
  previewChart!: Chart | null;
  baseChart!: Chart | null;
  event!: ChartEvent | null;
  scene!: SceneRuntime | null;
  /** The beat window the preview samples, set by {@link refresh} before `tick` reads them. */
  beginSeconds!: number;
  endSeconds!: number;

  constructor(host: HTMLElement, getContext: () => TrajectoryContext, { invalidate, notify, activate }: TrajectoryActions) {
    this.host = host; this.getContext = getContext; this.invalidate = invalidate; this.notify = notify; this.activate = activate;
    this.options = optionsFromFields(structuredClone(TRAJECTORY_DEFAULTS)); this.segments = 128;
    this.splitSettings = trajectorySplitSettings();
    this.startTime = [1, 0, 1]; this.endTime = [5, 0, 1]; this.enabled = true; this.animate = true;
    this.overlay = document.createElement('canvas'); this.overlay.className = 'trajectory-overlay'; this.overlay.hidden = true;
    element('.stage').append(this.overlay);
    this.custom = [];
    // The stored presets are untrusted: whatever JSON is in local storage is read as `unknown` and
    // handed to `validateCurvePreset` one entry at a time. A payload that is not an array used to
    // throw on `.map` and land in the same `catch` this ternary answers with, so the two agree for
    // every input.
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      this.custom = Array.isArray(stored) ? stored.map(validateCurvePreset) : [];
    } catch { this.custom = []; }
  }

  open(event: ChartEvent | null = null, lineIndex?: number, layerIndex?: number): void {
    const { session, timeline } = this.getContext();
    this.active = true; this.editing = event; this.presetDraft = null;
    this.lineIndex = lineIndex ?? session.lineIndex; this.layerIndex = layerIndex ?? Math.min(3, timeline.layer);
    if (event) {
      // The panel is opened on an event that carries a trajectory (the timeline only offers 生成曲线
      // 轨迹 / 编辑 for those); the original read `event.trajectory.options` unguarded.
      this.options = optionsFromFields(editableTrajectoryOptions(event.trajectory!.options));
      this.startTime = [...event.startTime] as Beat; this.endTime = [...event.endTime] as Beat;
      this.segments = event.trajectory!.segments ?? 128; this.splitSettings = trajectorySplitSettings(event.trajectory!.split);
    }
    this.render(); this.activate('trajectory'); this.refresh();
  }

  hide(): void { this.active = false; this.overlay.hidden = true; this.previewChart = null; }

  render(): void {
    this.host.replaceChildren();
    this.content = document.createElement('div'); this.content.className = 'trajectory-scroll'; this.host.append(this.content);
    this.fields = document.createElement('div'); this.fields.className = 'trajectory-fields';
    field(this.fields, 'lineIndex', '目标线号', this.lineIndex, 'number', 0, this.getContext().session.chart.judgeLineList.length - 1, 1);
    field(this.fields, 'layerIndex', '基础层', this.layerIndex, 'number', 0, 3, 1);
    field(this.fields, 'startTime', '开始拍', formatBeat(this.startTime));
    field(this.fields, 'endTime', '结束拍', formatBeat(this.endTime));
    field(this.fields, 'mode', '方程类型', this.options.mode, 'text', undefined, undefined, undefined, [['parametric', '参数方程 x(t), y(t)'], ['polar', '极坐标 r(θ)']] as [string, string][]);
    for (const [key, title] of [['xExpression', 'x(t)'], ['yExpression', 'y(t)'], ['parameterStart', '参数 t 起点'], ['parameterEnd', '参数 t 终点'], ['radiusExpression', 'r(θ)'], ['angleStart', 'θ 起点（弧度）'], ['angleEnd', 'θ 终点（弧度）'], ['rotationExpression', '判定线角度（可空）']] as [keyof CurveTrajectoryOptions, string][]) field(this.fields, key, title, this.options[key]);
    field(this.fields, 'tangentRotation', '自动计算切线角度（顺时针为正）', this.options.tangentRotation, 'checkbox');
    for (const [key, title] of [['easingX', 'X / θ 参数缓动'], ['easingY', 'Y 参数缓动']] as [keyof CurveTrajectoryOptions, string][]) field(this.fields, key, title, this.options[key], 'number', 1, 29, 1);
    for (const [key, title, type, minimum, maximum, step] of COMMON_FIELDS) field(this.fields, key, title, this.options[key], type, minimum, maximum, step);
    const parameters = field(this.fields, 'parametersJson', '表达式参数（JSON）', JSON.stringify(this.options.parameters ?? {})); parameters.title = '例如 {"radius":200}，表达式可直接使用 radius';
    field(this.fields, 'segments', '拆分 / 兼容导出段数', this.segments, 'number', 4, 8192, 1);
    field(this.fields, 'simplify', '拆分时以较少缓动事件近似', this.splitSettings.simplify, 'checkbox');
    field(this.fields, 'tolerance', '拆分容忍度（坐标 / 度）', this.splitSettings.tolerance, 'number', 0.001, 10000, 0.1);
    field(this.fields, 'replace', '替换区间内已有事件', this.replace, 'checkbox');
    this.content.append(this.fields);
    this.fields.oninput = () => {
      try {
        const values = readFields(this.fields, this.options);
        // Each read states the kind of control it mirrors (`String` for the text rows, `Number` for
        // the numeric ones, `Boolean` for a checkbox); the DOM coerced those same values already.
        this.lineIndex = Number(values.lineIndex); this.layerIndex = Number(values.layerIndex);
        this.startTime = parseBeat(String(values.startTime)); this.endTime = parseBeat(String(values.endTime));
        this.segments = Number(values.segments); this.replace = Boolean(values.replace);
        this.splitSettings = trajectorySplitSettings({ simplify: Boolean(values.simplify), tolerance: Number(values.tolerance) });
        const options: FieldValues = { ...values, parameters: JSON.parse(String(values.parametersJson)) };
        for (const key of ['startTime', 'endTime', 'lineIndex', 'layerIndex', 'segments', 'replace', 'parametersJson', 'simplify', 'tolerance']) delete options[key];
        this.options = optionsFromFields(options);
        this.presetDraft = null; this.refresh();
      } catch (error) { this.error(error); }
    };
    const syntax = document.createElement('details'); syntax.className = 'trajectory-syntax';
    const summary = document.createElement('summary'); summary.textContent = '语法与坐标说明';
    const hint = document.createElement('p'); hint.className = 'hint';
    hint.textContent = '这里生成判定线的 X、Y 位移和可选旋转事件，不生成音符。t 在指定参数区间变化；θ / theta 使用弧度，pi / π 为圆周率；兼容原版 $t$、Pi。u 为轨迹进度 0–1。支持 + - * / ^、比较、条件 ? :，以及 sin cos tan sqrt abs min max floor round lerp clamp ease。坐标采用原 RPE 的中心原点、X 向右、Y 向上（1350×900），角度事件以度为单位。截取后仍覆盖完整起止拍；整体旋转不改变判定线自身角度。随机曲线同一种子始终一致。轨迹在 X 轨道显示为一个整体，拖动和拉伸同时作用于 X、Y 和角度；需要普通事件时再拆分。';
    hint.textContent += ' 自动切线角度在变换后的曲线上数值求导，采用 RPE 顺时针为正的角度并连续展开跨周角度；勾选后保留但暂不使用手填角度。拆分近似的容忍度相对于等分碎事件，限制每轴坐标或角度的最大偏差。';
    syntax.append(summary, hint); this.content.append(syntax);
    this.controls = document.createElement('div');
    field(this.controls, 'enabled', '在左侧预览轨迹', this.enabled, 'checkbox');
    field(this.controls, 'animate', '暂停时循环演示', this.animate, 'checkbox');
    this.controls.oninput = () => { Object.assign(this, readFields(this.controls, {})); this.invalidate(); };
    this.content.append(this.controls);
    this.canvas = document.createElement('canvas'); this.canvas.width = 500; this.canvas.height = 240; this.canvas.className = 'trajectory-preview'; this.canvas.setAttribute('aria-label', '轨迹动态预览'); this.content.append(this.canvas);
    this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status'); this.content.append(this.message);
    const actions = document.createElement('div'); actions.className = 'trajectory-footer';
    this.applyButton = action(this.editing ? '应用轨迹修改' : '生成整体轨迹事件', () => this.apply());
    this.splitButton = action('拆分为普通事件', () => this.split()); this.splitButton.hidden = !this.editing;
    this.applyButton.className = 'primary';
    actions.append(this.splitButton, action('返回谱面工具', () => this.activate('chart')), this.applyButton); this.host.append(actions);
    this.gallery = document.createElement('div'); this.gallery.className = 'trajectory-gallery'; this.content.append(this.gallery); this.renderPresets();
    this.renderCustom();
  }

  renderPresets(): void {
    const expanded = new Set([...this.gallery.querySelectorAll<HTMLDetailsElement>('details[open]')].map(group => group.dataset.category));
    this.gallery.replaceChildren();
    for (const category of ['基本图形', '进阶图形', '其他', '自定义']) {
      const group = document.createElement('details'); const title = document.createElement('summary'); title.textContent = category; group.append(title);
      group.dataset.category = category; group.open = expanded.has(category);
      const grid = document.createElement('div'); grid.className = 'trajectory-preset-grid'; group.append(grid);
      for (const preset of [...CURVE_PRESETS, ...this.custom].filter(entry => entry.category === category)) {
        const card = action(preset.name, () => this.expandPreset(preset, card, grid)); card.setAttribute('aria-expanded', 'false');
        const canvas = document.createElement('canvas'); canvas.width = 150; canvas.height = 90; canvas.setAttribute('aria-hidden', 'true');
        try { drawPath(canvas, sampleCurveTrajectory(presetOptions(preset), 129)); } catch {}
        card.prepend(canvas); grid.append(card);
      }
      this.gallery.append(group);
    }
  }

  expandPreset(preset: CurvePreset, card: HTMLButtonElement, grid: HTMLDivElement): void {
    const closing = card.getAttribute('aria-expanded') === 'true';
    this.gallery.querySelectorAll('.trajectory-preset-editor').forEach(element => element.remove());
    this.gallery.querySelectorAll('[aria-expanded]').forEach(element => element.setAttribute('aria-expanded', 'false'));
    this.presetDraft = null;
    if (closing) { this.refresh(); return; }
    card.setAttribute('aria-expanded', 'true');
    const panel = document.createElement('div'); panel.className = 'trajectory-preset-editor';
    grid.insertBefore(panel, card.nextSibling);
    const title = document.createElement('strong'); title.textContent = preset.name + ' · 调整后填入'; panel.append(title);
    if (this.custom.includes(preset)) {
      panel.append(action('编辑预设定义', () => this.loadCustom(preset, preset.name)), action('删除此预设', () => {
        try {
          const custom = deleteCurvePreset(this.custom, preset.name);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); this.custom = custom;
          if (this.customEditingName === preset.name) { this.customEditingName = null; this.validateCustom(); }
          this.presetDraft = null; this.renderPresets(); this.refresh(); this.notify('自定义预设已删除', 'success');
        } catch (error) { this.customError(error); }
      }));
    }
    const base = presetOptions(preset);
    const parameters = document.createElement('div'); panel.append(parameters);
    for (const entry of preset.parameters) field(parameters, entry.key, entry.label ?? entry.key, entry.value, 'number', entry.min, entry.max, entry.step ?? 1);
    const common = document.createElement('div'); panel.append(common);
    for (const [key, label, type, minimum, maximum, step] of COMMON_FIELDS) field(common, key, label, base[key], type, minimum, maximum, step);
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 220; canvas.className = 'trajectory-preview'; panel.append(canvas);
    const error = document.createElement('p'); error.className = 'hint'; panel.append(error);
    const update = (): void => {
      try {
        const options = optionsFromFields({ ...base, ...readFields(common, {}), parameters: { ...base.parameters, ...readFields(parameters, {}) } });
        const points = sampleCurveTrajectory(options, 257);
        this.presetDraft = { options, points, canvas, preset }; error.textContent = '当前仅预览预设草稿；正式填入后才更改上方参数。'; this.refresh();
      } catch (problem) { error.textContent = failureMessage(problem); this.presetDraft = null; this.error(problem); }
    };
    panel.oninput = update;
    panel.append(action('正式填入轨迹参数', () => {
      if (!this.presetDraft) return;
      this.options = structuredClone(this.presetDraft.options);
      for (const input of this.fields.querySelectorAll<FieldControl>('[data-key]')) {
        const key = input.dataset.key;
        // As in `readFields`, `[data-key]` is what the selector matched on, so the name is always
        // there and this guard is unreachable.
        if (key === undefined) continue;
        if (key === 'parametersJson') input.value = JSON.stringify(this.options.parameters);
        else if (Object.hasOwn(this.options, key)) { if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(this.options[key]); else input.value = String(this.options[key]); }
      }
      this.presetDraft = null; this.refresh(); error.textContent = '已填入上方轨迹参数，可生成或继续调整。';
    }));
    update();
  }

  renderCustom(): void {
    const group = document.createElement('details'); const title = document.createElement('summary'); title.textContent = '自定义预设编辑器'; group.append(title);
    this.customGroup = group;
    const source = document.createElement('textarea'); source.className = 'trajectory-preset-source'; source.setAttribute('aria-label', '自定义预设 JSON');
    this.customInput = source;
    source.value = this.customSource ?? JSON.stringify({ name: '我的轨迹', mode: 'parametric', xExpression: 'radius*cos(2*pi*t)', yExpression: 'radius*sin(2*pi*t)', parameters: [{ key: 'radius', label: '半径', value: 200, min: 1, max: 2000, step: 1 }] }, null, 2); group.append(source);
    const help = document.createElement('p'); help.className = 'hint'; help.textContent = '保存、另存和导出使用本框 JSON。保存修改会更新正在编辑的预设（name 改名也更新原项）；另存为新预设会立即添加，重名自动加副本编号。参数方程填写 xExpression、yExpression；极坐标填写 mode: "polar" 和 radiusExpression。parameters 声明 key、label、value 和可选 min/max/step。'; group.append(help);
    this.customMessage = document.createElement('p'); this.customMessage.className = 'hint'; this.customMessage.setAttribute('role', 'status'); group.append(this.customMessage);
    this.customCanvas = document.createElement('canvas'); this.customCanvas.width = 500; this.customCanvas.height = 180; this.customCanvas.className = 'trajectory-preview'; this.customCanvas.setAttribute('aria-label', '自定义预设预览'); group.append(this.customCanvas);
    const guarded = (callback: () => void): (() => void) => () => { try { callback(); } catch (error) { this.customError(error); } };
    const save = (preset: CurvePreset, originalName: string | null): void => {
      const custom = saveCurvePreset(this.custom, preset, originalName);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); this.custom = custom;
      this.customEditingName = preset.name; source.value = JSON.stringify(preset, null, 2);
      this.presetDraft = null; this.renderPresets(); this.refresh(); this.validateCustom();
      this.gallery.querySelector<HTMLDetailsElement>('[data-category="自定义"]')!.open = true;
      this.customMessage.textContent = `已保存：${preset.name}。可在“自定义”分类选用或继续编辑。`; this.notify('自定义轨迹预设已保存', 'success');
    };
    this.customSave = action('添加到自定义预设', guarded(() => save(parseCurvePreset(source.value), this.customEditingName ?? null)));
    this.customCopy = action('另存为新预设', guarded(() => save(copyCurvePreset(this.custom, parseCurvePreset(source.value)), null)));
    this.customExport = action('导出编写的预设', guarded(() => { const preset = parseCurvePreset(source.value); download(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }), preset.name + '.trajectory.json'); }));
    group.append(this.customSave, this.customCopy, this.customExport);
    // `name` is not a declared option (the panel only ever carries it while editing a preset), so it
    // is read off the open record as `unknown` and stringified back to the name the original passed.
    const load = action('用当前轨迹填充 JSON', guarded(() => this.loadCustom(copyCurvePreset(this.custom, validateCurvePreset({ ...this.options, name: String(this.options.name ?? '我的轨迹'), parameters: Object.entries(this.options.parameters ?? {}).map(([key, value]) => ({ key, label: key, value })) })))));
    load.title = '将上方轨迹参数复制到下面的编辑框；之后点击添加到自定义预设才会保存';
    group.insertBefore(load, source);
    source.oninput = () => this.validateCustom();
    const file = document.createElement('input'); file.type = 'file'; file.accept = '.json'; file.hidden = true;
    file.onchange = async () => { try { const selected = file.files?.[0]; if (!selected) return; if (selected.size > 65536) throw new Error('预设文件不能超过 64 KiB'); this.loadCustom(parseCurvePreset(await selected.text())); } catch (error) { this.customError(error); } finally { file.value = ''; } };
    group.append(action('导入单个预设', () => file.click()), file); this.content.append(group);
    this.validateCustom();
  }

  loadCustom(preset: CurvePreset, originalName: string | null = null): void {
    this.customEditingName = originalName; this.customInput.value = JSON.stringify(preset, null, 2);
    this.customGroup.open = true; this.validateCustom(); this.customGroup.scrollIntoView({ block: 'start' });
  }

  customError(error: unknown): void {
    this.customGroup.open = true; this.customMessage.textContent = failureMessage(error); this.customMessage.classList.add('error');
  }

  validateCustom(): void {
    this.customSource = this.customInput.value;
    this.customSave.textContent = this.customEditingName ? '保存修改（更新原预设）' : '添加到自定义预设';
    try {
      const source = this.customSource ?? '';
      const preset = parseCurvePreset(source);
      this.customCopy.hidden = !this.customEditingName && !this.custom.some(entry => entry.name === preset.name);
      drawPath(this.customCanvas, sampleCurveTrajectory(presetOptions(preset), 257));
      this.customMessage.textContent = this.customEditingName ? `正在编辑：${this.customEditingName}。保存修改更新此项；另存为新预设保留原项。` : '新预设草稿，尚未保存。点击“添加到自定义预设”保存到本机。';
      this.customMessage.classList.remove('error'); this.customSave.disabled = false; this.customCopy.disabled = false; this.customExport.disabled = false; this.customInput.removeAttribute('aria-invalid');
    } catch (error) {
      this.customError(error); drawPath(this.customCanvas, null);
      this.customSave.disabled = true; this.customCopy.disabled = true; this.customExport.disabled = true; this.customInput.setAttribute('aria-invalid', 'true');
    }
  }

  error(error: unknown): void { this.message.textContent = failureMessage(error); this.message.classList.add('error'); this.previewChart = null; this.points = null; this.worldPoints = null; this.applyButton.disabled = true; this.invalidate(); }

  refresh(): void {
    if (!this.active) return;
    try {
      const { session } = this.getContext();
      this.baseChart = session.chart;
      const options = this.presetDraft?.options ?? this.options;
      const event = createTrajectoryEvent(options, this.startTime, this.endTime, this.segments, this.splitSettings);
      this.event = event;
      const points = sampleCurveTrajectory(options, 257);
      this.points = points;
      this.previewChart = trajectoryChart(session.chart, this.lineIndex, this.layerIndex, event, this.editing, true);
      const scene = new SceneRuntime(); this.scene = scene; scene.compile(this.previewChart, this.getContext().tempo);
      const { tempo } = this.getContext(); const factor = session.chart.judgeLineList[this.lineIndex].bpmfactor ?? 1;
      this.beginSeconds = tempo.seconds(this.startTime, factor); this.endSeconds = tempo.seconds(this.endTime, factor);
      // `sample` answers `undefined` only for a line index the chart does not have, which `lineIndex`
      // bounds; the original dereferenced the sample unguarded.
      this.worldPoints = points.map((point, index) => scene.sample(this.beginSeconds + (this.endSeconds - this.beginSeconds) * index / (points.length - 1))[this.lineIndex]!);
      this.message.textContent = this.presetDraft ? '预设草稿预览中；生成前请先正式填入参数。' : 'X 轨道保存一个整体轨迹事件，包含 Y 和可选角度；拖动端点可整体改变时长。';
      this.message.classList.remove('error'); this.applyButton.disabled = Boolean(this.presetDraft);
      // The `[data-key]` controls are the text/number inputs `field` built, so the lookups below are
      // the elements themselves; the original dereferenced both them and their labels unguarded.
      for (const key of ['xExpression', 'yExpression', 'parameterStart', 'parameterEnd']) this.fields.querySelector<HTMLInputElement>('[data-key="' + key + '"]')!.closest('label')!.hidden = this.options.mode === 'polar';
      for (const key of ['radiusExpression', 'angleStart', 'angleEnd']) this.fields.querySelector<HTMLInputElement>('[data-key="' + key + '"]')!.closest('label')!.hidden = this.options.mode !== 'polar';
      this.fields.querySelector<HTMLInputElement>('[data-key="rotationExpression"]')!.disabled = Boolean(this.options.tangentRotation);
      this.fields.querySelector<HTMLInputElement>('[data-key="tolerance"]')!.disabled = !this.splitSettings.simplify;
      this.invalidate();
    } catch (error) { this.error(error); }
  }

  apply(): void {
    try {
      const { session } = this.getContext();
      if (this.presetDraft) throw new Error('请先正式填入预设参数');
      const event = createTrajectoryEvent(this.options, this.startTime, this.endTime, this.segments, this.splitSettings);
      const chart = trajectoryChart(session.chart, this.lineIndex, this.layerIndex, event, this.editing, this.replace);
      this.editing = event;
      session.focus = 'events'; session.eventLayer = this.layerIndex;
      session.selection.clear(); session.eventSelection = new Set<string>();
      session.commit('生成 / 更新曲线轨迹', chart);
      this.splitButton.hidden = false; this.applyButton.textContent = '应用轨迹修改';
      this.refresh(); this.notify('整体曲线轨迹已应用', 'success');
    } catch (error) { this.error(error); }
  }

  split(): void {
    try {
      const { session } = this.getContext();
      // 拆分 is only offered while a trajectory event is being edited — the state `split` is reached
      // in — and the original passed that event on unguarded.
      const settings = { ...this.splitSettings, segments: this.segments };
      const chart = splitTrajectoryChart(session.chart, this.lineIndex, this.layerIndex, this.editing!, settings);
      this.editing = null; session.eventSelection.clear(); session.multiEventSelection.clear(); session.commit('拆分曲线轨迹', chart);
      this.activate('chart'); this.notify('已拆分为普通 X、Y / 旋转事件，可一次撤销', 'success');
    } catch (error) { this.error(error); }
  }

  tick(timestamp: number, seconds: number, playing: boolean, renderer: Preview): TrajectoryView | null {
    if (!this.active) return null;
    if (this.baseChart !== this.getContext().session.chart) {
      const editing = this.editing;
      if (editing) {
        const selected = this.getContext().session.chart.judgeLineList.flatMap(line => (line.eventLayers ?? []).flatMap(layer => layer?.moveXEvents ?? [])).find(event => event.trajectory === editing.trajectory);
        if (selected) { this.editing = selected; this.startTime = selected.startTime; this.endTime = selected.endTime; for (const key of ['startTime', 'endTime'] as const) this.fields.querySelector<HTMLInputElement>('[data-key="' + key + '"]')!.value = formatBeat(this[key]); }
        else { this.editing = null; this.splitButton.hidden = true; this.applyButton.textContent = '生成整体轨迹事件'; }
      }
      this.refresh();
    }
    const progress = playing || !this.animate ? Math.max(0, Math.min(1, (seconds - this.beginSeconds) / (this.endSeconds - this.beginSeconds))) : timestamp / 2500 % 1;
    drawPath(this.canvas, this.points, progress);
    if (this.presetDraft) drawPath(this.presetDraft.canvas, this.presetDraft.points, progress);
    this.overlay.hidden = !this.enabled || !this.worldPoints || this.getContext().previewVisible;
    if (!this.overlay.hidden) {
      const { context, width, height } = prepareCanvas(this.overlay);
      const viewport = previewViewport(width, height, renderer.aspectRatio ?? 1.5); const scale = viewport.scale / (renderer.viewDivisor ?? 1);
      context.save(); context.beginPath(); context.rect(viewport.left, viewport.top, viewport.width, viewport.height); context.clip();
      context.strokeStyle = '#62e6ba'; context.lineWidth = 2; context.globalAlpha = 0.8; context.beginPath();
      const screen = (point: LineState): [number, number] => [width / 2 + point.x * scale, height / 2 - point.y * scale];
      // `overlay.hidden` is false only while `worldPoints` is set, which is the state the original
      // drew in; it dereferenced the samples unguarded.
      const worldPoints = this.worldPoints!;
      worldPoints.forEach((point, index) => index ? context.lineTo(...screen(point)) : context.moveTo(...screen(point))); context.stroke();
      const marker = worldPoints[Math.min(worldPoints.length - 1, Math.floor(progress * (worldPoints.length - 1)))];
      context.fillStyle = '#9cffcc'; context.beginPath(); context.arc(...screen(marker), 6, 0, Math.PI * 2); context.fill();
      context.font = '13px RPE, sans-serif'; context.fillText('轨迹预览 · L' + this.lineIndex, 18 + viewport.left, 24 + viewport.top); context.restore();
    }
    return this.enabled && this.previewChart ? { chart: this.previewChart, seconds: playing || !this.animate ? seconds : this.beginSeconds + (this.endSeconds - this.beginSeconds) * progress } : null;
  }
}
