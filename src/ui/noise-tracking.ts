import { formatBeat, fromNumber, parseBeat } from '../core/beat.ts';
import { lineDisplayLabel } from '../core/line-groups.ts';
import { noiseLayers } from '../core/noise-skin.ts';
import { trackedNoiseArea, noiseTrackingChart } from '../core/noise-tracking.ts';
import type { NoiseTrackingTarget } from '../core/noise-tracking.ts';
import { beatInputControl } from './beat-input.ts';
import type { EditorSession } from '../application/session.ts';
import type { TempoMap } from '../core/tempo.ts';
import type { Timeline } from './timeline.ts';
import type { Beat, Chart, NoiseArea, NoiseLayer, Note } from '../core/types.ts';

/** The preview state the tracking panel reads and temporarily overrides while sampling. */
export interface TrackingPreview {
  visible: boolean;
  pickPreviewLines?: boolean;
  pick(clientX: number, clientY: number): number | null;
  pickNoteTarget(clientX: number, clientY: number): { lineIndex: number; noteIndex: number } | null;
}

/** The editor state the tracking panel reads. */
export interface NoiseTrackingContext {
  session: EditorSession;
  tempo: TempoMap;
  timeline: Timeline;
  preview: TrackingPreview;
  realtimePreview: TrackingPreview;
  previewVisible: boolean;
  seconds(): number;
  wheel(event: WheelEvent): void;
}

/** The collaborators the panel is wired to. */
export interface NoiseTrackingPanelOptions {
  activate(pane: string): void;
  invalidate(): void;
  notify(message: string, level?: 'success' | 'warning' | 'error'): void;
  pause(): void;
}

/** The panel's live option bag. Beats stay as editable strings until `rebuild()` parses them. */
interface TrackingOptions {
  mode: 'line' | 'note';
  lineIndex: number;
  start: string;
  end: string;
  width: number;
  height: number;
  active: boolean;
  invert: boolean;
  layerId: string;
  sampleRate: number;
  show: boolean;
}

/** The `field` control's options. */
interface FieldOptions {
  choices?: [number | string, string][];
  checkbox?: boolean;
  beat?: boolean;
  min?: number;
  max?: number;
}

/** One note selection, held by reference so it survives edits elsewhere in the chart. */
type NoteTarget = Extract<NoiseTrackingTarget, { mode: 'note' }>;

const button = (text: string, action: () => void): HTMLButtonElement => { const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.onclick = action; return node; };
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class NoiseTrackingPanel {
  host: HTMLElement;
  stage: HTMLElement;
  getContext: () => NoiseTrackingContext;
  activate: (pane: string) => void;
  invalidate: () => void;
  notify: (message: string, level?: 'success' | 'warning' | 'error') => void;
  pause: () => void;
  options: TrackingOptions;
  sampler: HTMLDivElement;
  sampleBar: HTMLDivElement;
  sampleHint: HTMLParagraphElement;
  scroll: HTMLElement;
  controls: Map<string, HTMLInputElement | HTMLSelectElement>;
  targetLabel: HTMLParagraphElement;
  sampleButton: HTMLButtonElement;
  playButton: HTMLButtonElement;
  progress: HTMLInputElement;
  previewTime: HTMLOutputElement;
  message: HTMLParagraphElement;
  generate: HTMLButtonElement;
  active: boolean;
  initialized: boolean;
  owner: EditorSession | null;
  sampling: boolean;
  animating: boolean;
  animationEpoch: number | null;
  previewSeconds: number;
  previewChart: Chart | null;
  baseChart: Chart | null;
  baseTempo: TempoMap | null;
  range: { start: number; end: number } | null;
  area: NoiseArea | null;
  appliedArea: NoiseArea | null;
  noteTarget: NoteTarget | null;
  noteReference: Note | null;

  constructor(host: HTMLElement, stage: HTMLElement, getContext: () => NoiseTrackingContext, { activate, invalidate, notify, pause }: NoiseTrackingPanelOptions) {
    this.host = host; this.stage = stage; this.getContext = getContext;
    this.activate = activate; this.invalidate = invalidate; this.notify = notify; this.pause = pause;
    this.options = { mode: 'line', lineIndex: 0, start: '0:0/1', end: '4:0/1', width: 500, height: 100, active: true, invert: false, layerId: 'default', sampleRate: 120, show: true };
    this.active = false; this.initialized = false; this.owner = null; this.sampling = false; this.animating = false; this.animationEpoch = null;
    this.previewSeconds = 0; this.previewChart = null; this.baseChart = null; this.baseTempo = null; this.range = null; this.area = null; this.appliedArea = null;
    this.noteTarget = null; this.noteReference = null;
    this.sampler = document.createElement('div'); this.sampler.className = 'noise-tracking-sampler'; this.sampler.hidden = true;
    this.sampler.setAttribute('aria-label', '点击预览中的追踪对象'); stage.append(this.sampler);
    this.sampler.onclick = event => this.pick(event);
    stage.addEventListener('wheel', event => {
      if (!this.previewing) return;
      event.preventDefault(); event.stopPropagation(); this.wheel(event);
    }, { passive: false, capture: true });
    this.sampleBar = document.createElement('div'); this.sampleBar.className = 'noise-sample-bar noise-tracking-sample-bar'; this.sampleBar.hidden = true;
    this.sampleHint = document.createElement('p'); this.sampleHint.className = 'hint';
    this.sampleBar.append(this.sampleHint, button('取消取样', () => this.endSample())); stage.append(this.sampleBar);
    window.addEventListener('keydown', event => {
      if (this.sampling && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.endSample(); }
    }, true);
    this.scroll = document.createElement('div'); this.controls = new Map(); this.targetLabel = document.createElement('p');
    this.sampleButton = document.createElement('button'); this.playButton = document.createElement('button'); this.progress = document.createElement('input');
    this.previewTime = document.createElement('output'); this.message = document.createElement('p'); this.generate = document.createElement('button');
    this.render();
  }
  get context(): NoiseTrackingContext { return this.getContext(); }
  get target(): NoiseTrackingTarget { return this.options.mode === 'note' && this.noteTarget ? this.noteTarget : { mode: 'line', lineIndex: Number(this.options.lineIndex) }; }
  get previewing(): boolean { return Boolean(this.active && (this.sampling || this.options.show && this.previewChart)); }
  editorRoot(): HTMLElement { return this.stage.closest('.editor') as HTMLElement; }
  control(key: string): HTMLInputElement | HTMLSelectElement | undefined { return this.controls.get(key); }
  open(): void {
    this.pause(); const { session, tempo, seconds } = this.context;
    if (!this.initialized || this.owner !== session) {
      const beat = tempo.beat(seconds()); this.options.start = formatBeat(fromNumber(beat)); this.options.end = formatBeat(fromNumber(beat + 4));
      this.options.lineIndex = session.lineIndex; this.previewSeconds = tempo.seconds(beat); this.initialized = true;
    }
    this.owner = session; this.active = true; this.baseChart = null; this.activate('noise-tracking'); this.render(); this.sync();
  }
  hide(): void { this.active = false; this.animating = false; this.endSample(); this.previewChart = null; this.editorRoot().classList.remove('noise-tracking-preview'); this.invalidate(); }
  reset(): void { this.hide(); this.owner = null; this.initialized = false; this.noteTarget = null; this.noteReference = null; this.appliedArea = null; }
  field(key: keyof TrackingOptions, text: string, { choices, checkbox = false, beat = false, min, max }: FieldOptions = {}): HTMLInputElement | HTMLSelectElement {
    const label = document.createElement('label'); label.className = 'field'; label.append(text);
    const control = choices ? document.createElement('select') : document.createElement('input');
    control.dataset.key = key; control.setAttribute('aria-label', text);
    if (choices) control.replaceChildren(...choices.map(([value, name]) => new Option(name, String(value))));
    else {
      const element = control as HTMLInputElement;
      element.type = checkbox ? 'checkbox' : beat ? 'text' : 'number';
      if (!checkbox && !beat) { element.step = 'any'; if (min !== undefined) element.min = String(min); if (max !== undefined) element.max = String(max); }
    }
    if (checkbox) (control as HTMLInputElement).checked = Boolean(this.options[key]); else control.value = String(this.options[key]);
    const update = (): void => {
      const element = control as HTMLInputElement;
      const value = checkbox ? element.checked : beat || choices ? element.value : element.value.trim() ? Number(element.value) : NaN;
      (this.options as unknown as Record<string, unknown>)[key] = value;
      if (key !== 'show') this.appliedArea = null;
      if (key === 'mode') { this.endSample(); this.updateVisibility(); }
      if (key === 'show') { this.updateChrome(); this.invalidate(); } else this.rebuild();
    };
    control.oninput = update;
    if (beat) {
      const element = control as HTMLInputElement;
      label.append(beatInputControl(element, () => this.context.timeline.division, error => this.fail(messageOf(error))));
      element.addEventListener('change', () => {
        try { element.value = formatBeat(parseBeat(element.value)); element.removeAttribute('aria-invalid'); update(); }
        catch (error) { element.setAttribute('aria-invalid', 'true'); this.fail(messageOf(error)); }
      });
    } else label.append(control);
    this.scroll.append(label); this.controls.set(key, control); return control;
  }
  render(): void {
    this.host.replaceChildren(); this.controls = new Map(); this.scroll = document.createElement('div'); this.scroll.className = 'noise-tracking-scroll'; this.host.append(this.scroll);
    const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = '噪域追踪'; this.scroll.append(title);
    this.field('mode', '追踪模式', { choices: [['line', '判定线'], ['note', '音符']] });
    this.field('lineIndex', '判定线', { choices: this.context.session.chart.judgeLineList.map((line, index) => [index, lineDisplayLabel(this.context.session.chart, index)]) });
    this.targetLabel = document.createElement('p'); this.targetLabel.className = 'hint noise-tracking-target'; this.scroll.append(this.targetLabel);
    this.sampleButton = button('在预览中取样', () => this.beginSample()); this.sampleButton.className = 'wide-button'; this.scroll.append(this.sampleButton);
    this.field('start', '开始拍', { beat: true }); this.field('end', '结束拍', { beat: true });
    this.field('width', '宽度', { min: 0.001, max: 100000 }); this.field('height', '高度', { min: 0.001, max: 100000 });
    this.field('layerId', '目标噪域层', { choices: noiseLayers(this.context.session.chart).map(layer => [layer.id, layer.name]) });
    this.field('invert', '反转噪域', { checkbox: true }); this.field('active', '整个区间激活', { checkbox: true });
    this.field('sampleRate', '采样精度', { choices: [[60, '标准 · 60 Hz'], [120, '精细 · 120 Hz'], [240, '高精度 · 240 Hz']] });
    this.field('show', '显示实时预览', { checkbox: true });
    const playback = document.createElement('div'); playback.className = 'noise-tracking-playback';
    this.playButton = button('▶ 演示追踪', () => { this.animating = !this.animating; this.animationEpoch = null; this.playButton.textContent = this.animating ? 'Ⅱ 暂停演示' : '▶ 演示追踪'; this.invalidate(); });
    this.progress = document.createElement('input'); this.progress.type = 'range'; this.progress.min = '0'; this.progress.max = '1'; this.progress.step = '0.001'; this.progress.value = '0'; this.progress.setAttribute('aria-label', '噪域追踪预览进度');
    this.progress.oninput = () => { this.animating = false; this.playButton.textContent = '▶ 演示追踪'; if (this.range) this.previewSeconds = this.range.start + Number(this.progress.value) * (this.range.end - this.range.start); this.invalidate(); };
    this.previewTime = document.createElement('output'); playback.append(this.playButton, this.progress, this.previewTime); this.scroll.append(playback);
    const help = document.createElement('p'); help.className = 'hint'; help.textContent = '预览中点击取样，Hold 身体也可选中；追踪位置按头部计算。宽高关于中心对称，角度跟随判定线（顺时针）。生成的是普通事件，之后修改目标不会自动更新；需要重新生成。采样点会按坐标 0.2、角度 0.02° 的误差合并，瞬移单独保留。'; this.scroll.append(help);
    const footer = document.createElement('div'); footer.className = 'noise-tracking-footer'; this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status');
    this.generate = button('生成噪域', () => this.apply()); this.generate.className = 'primary'; this.generate.disabled = true;
    footer.append(this.message, button('返回谱面工具', () => this.activate('chart')), this.generate); this.host.append(footer); this.updateVisibility();
  }
  updateVisibility(): void {
    (this.control('lineIndex')?.closest('.field') as HTMLElement | null)!.hidden = this.options.mode !== 'line';
    this.targetLabel.textContent = this.options.mode === 'line' ? '可用下拉列表或在预览中选择；取样时所有判定线临时显示为不透明。' : this.noteTarget ? `${lineDisplayLabel(this.context.session.chart, this.noteTarget.lineIndex)} · 音符 ${this.noteTarget.noteIndex}` : '尚未选择音符，请在预览中取样。';
  }
  fail(message: string): void { this.area = null; this.previewChart = null; this.generate.disabled = true; this.message.textContent = message; this.message.classList.add('error'); this.updateChrome(); this.invalidate(); }
  rebuild(): void {
    if (!this.active) return;
    const { session, tempo } = this.context; this.baseChart = session.chart; this.baseTempo = tempo;
    try {
      const start = parseBeat(this.options.start); const end = parseBeat(this.options.end);
      this.range = { start: tempo.seconds(start), end: tempo.seconds(end) };
      this.area = trackedNoiseArea(session.chart, tempo, { ...this.options, start, end, target: this.target, sampleRate: Number(this.options.sampleRate) });
      this.previewChart = this.appliedArea && session.chart.blockAreaList?.includes(this.appliedArea) ? session.chart : noiseTrackingChart(session.chart, this.area);
      this.previewSeconds = Math.max(this.range.start, Math.min(this.range.end - 1e-7, this.previewSeconds));
      this.generate.disabled = false; this.message.classList.remove('error');
      this.message.textContent = `将生成 1 个噪域 · ${this.area.moveXEvents.length} 组移动 / 旋转事件`;
    } catch (error) { this.fail(messageOf(error)); return; }
    this.updateChrome(); this.invalidate();
  }
  sync(): void {
    if (!this.active) return;
    if (this.owner !== this.context.session) { this.reset(); return; }
    if (this.baseChart !== this.context.session.chart || this.baseTempo !== this.context.tempo) {
      if (this.noteTarget) {
        const lines = this.context.session.chart.judgeLineList;
        const lineIndex = lines.findIndex(line => this.noteReference !== null && line.notes?.includes(this.noteReference));
        if (lineIndex < 0) { this.noteTarget = null; this.noteReference = null; }
        else this.noteTarget = { mode: 'note', lineIndex, noteIndex: lines[lineIndex]!.notes.indexOf(this.noteReference!) };
      }
      const select = this.control('lineIndex')!; const value = this.options.lineIndex;
      select.replaceChildren(...this.context.session.chart.judgeLineList.map((line, index) => new Option(lineDisplayLabel(this.context.session.chart, index), String(index)))); select.value = String(value);
      const layer = this.control('layerId')!; layer.replaceChildren(...noiseLayers(this.context.session.chart).map(entry => new Option(entry.name, entry.id))); layer.value = this.options.layerId;
      this.updateVisibility(); this.rebuild();
    }
  }
  updateChrome(): void {
    const show = Boolean(this.active && (this.sampling || this.options.show && this.previewChart));
    this.editorRoot().classList.toggle('noise-tracking-preview', show);
    this.sampler.hidden = !this.sampling; this.sampleBar.hidden = !this.sampling;
    if (this.generate) this.generate.disabled = Boolean(this.sampling || !this.area);
  }
  beginSample(): void {
    this.pause(); this.animating = false; this.playButton.textContent = '▶ 演示追踪'; this.sampling = true;
    this.sampleHint.textContent = this.options.mode === 'line' ? '点击判定线选择追踪对象 · 此时所有判定线临时不透明 · Esc 取消' : '点击音符的头部或 Hold 身体 · Esc 取消';
    this.updateChrome(); this.invalidate();
  }
  endSample(): void { this.sampling = false; this.updateChrome(); this.invalidate(); }
  wheel(event: WheelEvent): void {
    this.animating = false; this.animationEpoch = null; this.playButton.textContent = '▶ 演示追踪';
    this.context.wheel(event);
    this.previewSeconds = this.context.seconds(); this.invalidate();
  }
  pick(event: MouseEvent): void {
    if (!this.sampling) return; event.preventDefault(); event.stopPropagation();
    const renderer = this.context.previewVisible ? this.context.preview : this.context.realtimePreview;
    const visible = renderer.visible; const enabled = renderer.pickPreviewLines; renderer.visible = true; renderer.pickPreviewLines = true;
    try {
      if (this.options.mode === 'line') {
        const index = renderer.pick(event.clientX, event.clientY); if (index === null || !Number.isInteger(index)) return;
        this.options.lineIndex = index; const select = this.control('lineIndex'); if (select) select.value = String(index);
      } else {
        const target = renderer.pickNoteTarget(event.clientX, event.clientY); if (!target) return;
        this.noteTarget = { mode: 'note', ...target }; this.noteReference = this.context.session.chart.judgeLineList[target.lineIndex]!.notes[target.noteIndex] ?? null;
      }
      this.appliedArea = null; this.endSample(); this.updateVisibility(); this.rebuild();
    } finally { renderer.visible = visible; renderer.pickPreviewLines = enabled; }
  }
  tick(timestamp: number, seconds: number, playing: boolean): { chart: Chart; seconds: number; sampling?: boolean; forceLineOpacity?: boolean } | null {
    if (!this.active) return null; this.sync();
    if (this.sampling) return { chart: this.context.session.chart, seconds, sampling: true, forceLineOpacity: this.options.mode === 'line' };
    if (!this.options.show || !this.previewChart || !this.range) return null;
    if (playing) this.previewSeconds = Math.max(this.range.start, Math.min(this.range.end - 1e-7, seconds));
    else if (this.animating) {
      this.animationEpoch ??= timestamp;
      this.previewSeconds = this.range.start + ((timestamp - this.animationEpoch) / 1000 % (this.range.end - this.range.start));
    }
    this.progress.value = String(Math.max(0, Math.min(1, (this.previewSeconds - this.range.start) / (this.range.end - this.range.start))));
    this.previewTime.textContent = formatBeat(fromNumber(this.context.tempo.beat(this.previewSeconds))) + ' 拍';
    return { chart: this.previewChart, seconds: this.previewSeconds };
  }
  action(action: string): boolean {
    if (!this.active) return false;
    if (action === 'Esc') { if (this.sampling) this.endSample(); else this.activate('chart'); return true; }
    return ['SelectAll', 'Copy', 'Shear', 'Paste', 'PasteMirror', 'KeepTimePaste', 'KeepTimePasteMirror', 'ClipboardHistory', 'NumberMirror', 'NumberFill', 'Delete', 'QuickDelete', 'CurveBegin', 'CurveEnd', 'AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action) || action.startsWith('Page');
  }
  apply(): void {
    try {
      this.sync(); if (!this.area || this.sampling) throw new Error('请先选择追踪对象并填写有效参数');
      const { session } = this.context; const area = this.area; this.appliedArea = area;
      session.commit('噪域追踪', noiseTrackingChart(session.chart, area));
      this.rebuild(); this.message.textContent = '已生成 1 个噪域，可撤销 / 重做。修改目标后需重新生成。'; this.notify('噪域追踪已生成', 'success');
    } catch (error) { this.fail(messageOf(error)); this.notify(messageOf(error), 'error'); }
  }
}

export type { Beat, NoiseLayer };
