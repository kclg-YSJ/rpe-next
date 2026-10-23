import {formatBeat,parseBeat} from '../core/beat.mjs';
import {selectedEvents,transformEvents} from '../application/event-commands.mjs';
import {beatInputControl} from './beat-input.mjs';
import {numericWheel} from './numeric-wheel.mjs';
import {createEasingPicker,EASING_NAMES} from './easing-picker.mjs';
import { t } from '../i18n.mjs';
const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text)element.textContent=text;return element;};

/** Independent property page: never mounts the global event catalogue. */
export class GlobalEventInspector {
  constructor(host,editor){this.host=host;this.editor=editor;this.document=editor.document;this.timeline=editor.timeline;}
  safely(action){return this.editor.safely(action);}
  report(error){this.editor.report(error);}
  remove(){this.editor.remove();}
  dispose(){this.inspectorDispose?.();this.inspectorDispose=null;}
  render(){
    const entries=selectedEvents(this.document.editor);
    if(entries.length!==1){this.dispose();this.host.replaceChildren();return;}
    const selection=[...this.document.editor.eventSelection].join('|');
    if(this.editing?.input===document.activeElement&&this.editing.input.isConnected&&this.editing.selection===selection)return;
    if(this.renderedSelection===selection&&this.host.contains(document.activeElement)&&document.activeElement.closest('.global-event-custom'))return;
    this.editing=null;this.dispose();const scroll=this.host.scrollTop;this.host.replaceChildren();
    this.renderedSelection=selection;
    this.host.append(node('div','panel-title',t('global-event-inspector.s6c6b826')));
    const back=node('button','wide-button',t('global-event-inspector.s32f6871'));back.type='button';back.onclick=()=>this.editor.activate('global-events');this.host.append(back);
    const form=node('form','global-event-properties');form.id='global-event-properties';form.onsubmit=event=>{event.preventDefault();document.activeElement?.blur();};this.host.append(form);
    this.renderFields(form,entries);
    this.host.append(this.editor.closeButton());
    this.host.scrollTop=scroll;
  }
  renderFields(form, entries) {
    const { event, type: key } = entries[0], columnEntry = this.document.columns.find(column => column.key === key), { type, column } = columnEntry;
    form.append(node('h3', '', t('global-event-inspector.sc927adf', { p0: type.name, p1: type.columns.length > 1 ? ' · ' + column.name : '', p2: entries.length })));
    if (type.readonly) { form.append(node('p', 'hint', t('global-event-inspector.secab397'))); return; }
    const update = (change, label = t('global-event-inspector.sabe7f42')) => {
      const entries = selectedEvents(this.document.editor); if(entries.length!==1)return;
      const current = entries[0], next = change(structuredClone(current.event), this.document.columns.find(column => column.key === current.type));
      if(JSON.stringify(next)===JSON.stringify(current.event))return;
      transformEvents(this.document.editor, label, () => next);
    };
    const field = (name, key, kind, value, apply) => {
      const label = node('label', 'field'); label.append(name);
      const input = node(kind === 'json' ? 'textarea' : 'input'); input.dataset.rpenField = key; input.setAttribute('aria-label', t('global-event-inspector.s895a20e') + name);
      if (kind !== 'json') input.type = kind === 'number' ? 'number' : kind === 'boolean' ? 'checkbox' : kind === 'color' ? 'color' : 'text';
      if (kind === 'number') { input.step = column.step ?? 'any'; if (column.min !== undefined && ['start', 'end'].includes(key)) input.min = column.min; if (column.max !== undefined && ['start', 'end'].includes(key)) input.max = column.max; numericWheel(input, column.step ?? 1); }
      if (kind === 'boolean') input.checked = Boolean(value);
      else input.value = kind === 'beat' ? formatBeat(value) : kind === 'json' ? JSON.stringify(value, null, 2) : kind === 'color' ? '#' + value.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('') : value ?? '';
      const applyInput = (quiet=false) => { try {
        if(document.activeElement===input)this.editing={input,selection:[...this.document.editor.eventSelection].join('|')};
        const value = kind === 'beat' ? parseBeat(input.value) : kind === 'number' ? input.value.trim() ? Number(input.value) : NaN : kind === 'boolean' ? input.checked : kind === 'color' ? [1, 3, 5].map(index => Number.parseInt(input.value.slice(index, index + 2), 16)) : kind === 'json' ? JSON.parse(input.value) : input.value;
        if (kind === 'number' && !Number.isFinite(value)) throw Error(t('global-event-inspector.s0ffe620'));
        apply(value);input.removeAttribute('aria-invalid');
      } catch(error) { if(!quiet){input.setAttribute('aria-invalid','true');this.report(error);} } };
      input.onfocus=()=>{this.editing={input,selection:[...this.document.editor.eventSelection].join('|')};};
      input.onblur=()=>{if(this.editing?.input===input)this.editing=null;queueMicrotask(()=>{if(!this.editing&&!this.host.closest('[data-panel]').hidden)this.render();});};
      input.oninput=event=>{if(!event.isComposing)applyInput(true);};
      input.oncompositionend=()=>applyInput(true);
      input.onchange=()=>applyInput();
      label.append(kind === 'beat' ? beatInputControl(input, () => this.timeline.division, error => this.report(error)) : input); form.append(label);
    };
    for (const [key, name] of [['startTime', t('global-event-inspector.s087c451')], ['endTime', t('global-event-inspector.sc4d3fa4')]]) field(name, key, 'beat', event[key], value => update(current => ({ ...current, [key]: value })));
    for (const [key, name] of [['start', t('global-event-inspector.s532cd47')], ['end', t('global-event-inspector.s00005a6')]]) field(name, key, column.valueType, event[key], value => update(current => ({ ...current, [key]: value, ...(current.inst ? { start: value, end: structuredClone(value) } : {}) })));
    field(t('global-event-inspector.s7787450'), 'inst', 'boolean', event.inst, value => update(current => ({ ...current, inst: value ? 1 : 0, ...(value ? { end: structuredClone(current.start) } : {}) })));
    for (const [key, name, fallback] of [['easingLeft', t('global-event-inspector.s2fbff0e'), 0], ['easingRight', t('global-event-inspector.sb38574e'), 1], ['linkgroup', t('global-event-inspector.s50136f9'), 0]]) field(name, key, 'number', event[key] ?? fallback, value => {
      if (key === 'linkgroup' ? !Number.isInteger(value) || value < 0 : value < 0 || value > 1) throw Error(key === 'linkgroup' ? t('global-event-inspector.sbf11766') : t('global-event-inspector.s773fbe4'));
      update(current => ({ ...current, [key]: value }));
    });
    const easing = node('select'); easing.setAttribute('aria-label', t('global-event-inspector.sa593f21')); EASING_NAMES.forEach((name, index) => easing.append(new Option(`${index + 1} · ${name}`, index + 1))); easing.value = event.easingType ?? 1;
    easing.onchange = () => this.safely(() => update(current => ({ ...current, easingType: Number(easing.value), bezier: 0 })));
    const label = node('label', 'field', t('global-event-inspector.s727b7cd')); label.append(easing); form.append(label);
    form.append(createEasingPicker(event.easingType ?? 1, value => this.safely(() => update(current => ({ ...current, easingType: value, bezier: 0 }))), this.easingState ??= { open: false }).element);
    field(t('global-event-inspector.s3493008'), 'bezier', 'boolean', event.bezier, value => update(current => ({ ...current, bezier: value ? 1 : 0, bezierPoints: current.bezierPoints ?? [0, 0, 1, 1] })));
    if (event.bezier) field(t('global-event-inspector.sb1f6d6a'), 'bezierPoints', 'json', event.bezierPoints, value => update(current => ({ ...current, bezierPoints: value })));
    const custom = column.inspector ?? type.inspector;
    if (custom) {
      const container = node('div', 'global-event-custom'); form.append(container);
      this.inspectorDispose = this.safely(() => custom({ container, event: structuredClone(event), entries: structuredClone(entries), type, column, update, editor: this.editor, document: this.document }));
      if (typeof this.inspectorDispose !== 'function') this.inspectorDispose = null;
    }
    const advanced = node('details'); advanced.append(node('summary', '', t('global-event-inspector.seb138e2'))); const raw = node('textarea'); raw.value = JSON.stringify(event, null, 2); raw.setAttribute('aria-label', t('global-event-inspector.sff1591b'));
    const apply = node('button', '', t('global-event-inspector.see52d34')); apply.type = 'button'; apply.onclick = () => this.safely(() => { const value = JSON.parse(raw.value); update(() => value, t('global-event-inspector.sa8da182')); }); advanced.append(raw, apply); form.append(advanced);
    const remove = node('button', 'wide-button', t('global-event-inspector.s813d321')); remove.type = 'button'; remove.onclick = () => this.safely(() => this.remove()); form.append(remove);
  }
}
