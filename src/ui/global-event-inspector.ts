import {formatBeat,parseBeat} from '../core/beat.ts';
import {selectedEvents,transformEvents} from '../application/event-commands.ts';
import {beatInputControl} from './beat-input.ts';
import {numericWheel} from './numeric-wheel.ts';
import {createEasingPicker,EASING_NAMES} from './easing-picker.ts';
import type { ChartEvent } from '../core/types.ts';
import type { EventSelectionEntry } from '../application/event-commands.ts';
import type { EasingPickerState } from './easing-picker.ts';
import type { Timeline } from './timeline.ts';
import type { GlobalColumnEntry, GlobalEventDocumentLike, GlobalEventsEditor } from './global-events.ts';

const node=<K extends keyof HTMLElementTagNameMap>(tag:K,className?:string,text?:string):HTMLElementTagNameMap[K]=>{const element=document.createElement(tag);if(className)element.className=className;if(text)element.textContent=text;return element;};

/** Independent property page: never mounts the global event catalogue. */
export class GlobalEventInspector {
  host: HTMLElement;
  editor: GlobalEventsEditor;
  document: GlobalEventDocumentLike;
  timeline: Timeline;
  inspectorDispose: (() => void) | null;
  editing: { input: HTMLElement; selection: string } | null;
  renderedSelection?: string;
  easingState?: EasingPickerState;

  constructor(host: HTMLElement, editor: GlobalEventsEditor) { this.host = host; this.editor = editor; this.document = editor.document; this.timeline = editor.timeline; this.inspectorDispose = null; this.editing = null; }
  safely<T>(action: () => T): T | undefined { return this.editor.safely(action); }
  report(error: unknown): void { this.editor.report(error); }
  remove(): void { this.editor.remove(); }
  dispose(): void { this.inspectorDispose?.(); this.inspectorDispose = null; }
  render(): void {
    const entries=selectedEvents(this.document.editor);
    if(entries.length!==1){this.dispose();this.host.replaceChildren();return;}
    const selection=[...this.document.editor.eventSelection].join('|');
    if(this.editing?.input===document.activeElement&&this.editing.input.isConnected&&this.editing.selection===selection)return;
    if(this.renderedSelection===selection&&this.host.contains(document.activeElement)&&document.activeElement!.closest('.global-event-custom'))return;
    this.editing=null;this.dispose();const scroll=this.host.scrollTop;this.host.replaceChildren();
    this.renderedSelection=selection;
    this.host.append(node('div','panel-title','全局事件编辑'));
    const back=node('button','wide-button','返回全局事件总览');back.type='button';back.onclick=()=>this.editor.activate('global-events');this.host.append(back);
    const form=node('form','global-event-properties');form.id='global-event-properties';form.onsubmit=event=>{event.preventDefault();(document.activeElement as HTMLElement | null)?.blur();};this.host.append(form);
    this.renderFields(form,entries);
    this.host.append(this.editor.closeButton());
    this.host.scrollTop=scroll;
  }
  renderFields(form: HTMLFormElement, entries: EventSelectionEntry[]): void {
    const { event, type: key } = entries[0], columnEntry = this.document.columns.find(column => column.key === key), { type, column } = columnEntry!;
    form.append(node('h3', '', `${type.name}${type.columns.length > 1 ? ' · ' + column.name : ''} · ${entries.length} 已选`));
    if (type.readonly) { form.append(node('p', 'hint', '未加载提供此事件的模组。当前只读，保存时完整保留数据。')); return; }
    const update = (change: (event: ChartEvent, entry: GlobalColumnEntry | undefined) => ChartEvent, label = '修改全局事件'): void => {
      const entries = selectedEvents(this.document.editor); if(entries.length!==1)return;
      const current = entries[0], next = change(structuredClone(current.event), this.document.columns.find(column => column.key === current.type));
      if(JSON.stringify(next)===JSON.stringify(current.event))return;
      transformEvents(this.document.editor, label, () => next);
    };
    const field = (name: string, key: string, kind: string | undefined, value: unknown, apply: (value: unknown) => void): void => {
      const label = node('label', 'field'); label.append(name);
      const input = node(kind === 'json' ? 'textarea' : 'input'); input.dataset.rpenField = key; input.setAttribute('aria-label', '全局事件' + name);
      if (kind !== 'json' && input instanceof HTMLInputElement) input.type = kind === 'number' ? 'number' : kind === 'boolean' ? 'checkbox' : kind === 'color' ? 'color' : 'text';
      if (kind === 'number' && input instanceof HTMLInputElement) { input.step = column.step === undefined ? 'any' : String(column.step); if (column.min !== undefined && ['start', 'end'].includes(key)) input.min = String(column.min); if (column.max !== undefined && ['start', 'end'].includes(key)) input.max = String(column.max); numericWheel(input, column.step ?? 1); }
      if (kind === 'boolean' && input instanceof HTMLInputElement) input.checked = Boolean(value);
      else input.value = kind === 'beat' ? formatBeat(value as [number, number, number]) : kind === 'json' ? JSON.stringify(value, null, 2) : kind === 'color' ? '#' + (value as number[]).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('') : String(value ?? '');
      const applyInput = (quiet=false): void => { try {
        if(document.activeElement===input)this.editing={input,selection:[...this.document.editor.eventSelection].join('|')};
        const value: unknown = kind === 'beat' ? parseBeat(input.value) : kind === 'number' ? input.value.trim() ? Number(input.value) : NaN : kind === 'boolean' ? (input as HTMLInputElement).checked : kind === 'color' ? [1, 3, 5].map(index => Number.parseInt(input.value.slice(index, index + 2), 16)) : kind === 'json' ? JSON.parse(input.value) : input.value;
        if (kind === 'number' && !Number.isFinite(value as number)) throw Error('请输入有效数值');
        apply(value);input.removeAttribute('aria-invalid');
      } catch(error) { if(!quiet){input.setAttribute('aria-invalid','true');this.report(error);} } };
      input.onfocus=()=>{this.editing={input,selection:[...this.document.editor.eventSelection].join('|')};};
      input.onblur=()=>{if(this.editing?.input===input)this.editing=null;queueMicrotask(()=>{if(!this.editing&&!this.host.closest<HTMLElement>('[data-panel]')!.hidden)this.render();});};
      input.oninput=event=>{if(!(event as InputEvent).isComposing)applyInput(true);};
      input.addEventListener('compositionend',()=>applyInput(true));
      input.onchange=()=>applyInput();
      label.append(kind === 'beat' && input instanceof HTMLInputElement ? beatInputControl(input, () => this.timeline.division, error => this.report(error)) : input); form.append(label);
    };
    for (const [key, name] of [['startTime', '开始拍'], ['endTime', '结束拍']]) field(name, key, 'beat', event[key], value => update(current => ({ ...current, [key]: value })));
    for (const [key, name] of [['start', '起始值'], ['end', '结束值']]) field(name, key, column.valueType, event[key], value => update(current => ({ ...current, [key]: value, ...(current.inst ? { start: value, end: structuredClone(value) } : {}) } as ChartEvent)));
    field('钩定（首尾同步）', 'inst', 'boolean', event.inst, value => update(current => ({ ...current, inst: value ? 1 : 0, ...(value ? { end: structuredClone(current.start) } : {}) })));
    for (const [key, name, fallback] of [['easingLeft', '缓动左边界', 0], ['easingRight', '缓动右边界', 1], ['linkgroup', '绑定组编号', 0]] as const) field(name, key, 'number', event[key] ?? fallback, value => {
      const number = Number(value);
      if (key === 'linkgroup' ? !Number.isInteger(number) || number < 0 : number < 0 || number > 1) throw Error(key === 'linkgroup' ? '绑定组编号需要为非负整数' : '缓动边界应在 0–1 之间');
      update(current => ({ ...current, [key]: value }));
    });
    const easing = node('select'); easing.setAttribute('aria-label', '全局事件缓动'); EASING_NAMES.forEach((name, index) => easing.append(new Option(`${index + 1} · ${name}`, String(index + 1)))); easing.value = String(event.easingType ?? 1);
    easing.onchange = () => this.safely(() => update(current => ({ ...current, easingType: Number(easing.value), bezier: 0 })));
    const label = node('label', 'field', '缓动'); label.append(easing); form.append(label);
    form.append(createEasingPicker(event.easingType ?? 1, value => this.safely(() => update(current => ({ ...current, easingType: value, bezier: 0 }))), this.easingState ??= { open: false }).element);
    field('使用 Bezier', 'bezier', 'boolean', event.bezier, value => update(current => ({ ...current, bezier: value ? 1 : 0, bezierPoints: current.bezierPoints ?? [0, 0, 1, 1] } as ChartEvent)));
    if (event.bezier) field('Bezier 控制点', 'bezierPoints', 'json', event.bezierPoints, value => update(current => ({ ...current, bezierPoints: value } as ChartEvent)));
    const custom = column.inspector ?? type.inspector;
    if (custom) {
      const container = node('div', 'global-event-custom'); form.append(container);
      const dispose = this.safely(() => custom({ container, event: structuredClone(event), entries: structuredClone(entries), type, column, update, editor: this.editor, document: this.document }));
      this.inspectorDispose = typeof dispose === 'function' ? dispose : null;
    }
    const advanced = node('details'); advanced.append(node('summary', '', '完整事件数据')); const raw = node('textarea'); raw.value = JSON.stringify(event, null, 2); raw.setAttribute('aria-label', '全局事件 JSON');
    const apply = node('button', '', '应用 JSON'); apply.type = 'button'; apply.onclick = () => this.safely(() => { const value: unknown = JSON.parse(raw.value); update(() => value as ChartEvent, '修改全局事件 JSON'); }); advanced.append(raw, apply); form.append(advanced);
    const remove = node('button', 'wide-button', '删除选中的全局事件'); remove.type = 'button'; remove.onclick = () => this.safely(() => this.remove()); form.append(remove);
  }
}
