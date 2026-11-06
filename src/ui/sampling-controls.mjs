import { samplingPreferences, saveSamplingPreferences } from '../platform/sampling-preferences.mjs';
import { t } from '../i18n.mjs';
import { evaluateNumericExpression } from '../core/numeric-expression.mjs';
import { displayNumber } from './spatial-display.mjs';
export class SamplingControls {
  constructor(host, { change = () => {}, apply, cancel } = {}) {
    this.root = document.createElement('div'); this.root.className = 'sampling-controls tool-settings'; host.append(this.root);
    this.readout = document.createElement('output'); this.readout.className = 'sampling-readout'; this.root.append(this.readout);
    this.valuesHost=document.createElement('div');this.valuesHost.className='sampling-values';this.root.append(this.valuesHost);this.values=new Map();
    this.details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = t('sampling.options'); this.details.append(summary); this.root.append(this.details);
    this.fields = new Map();
    for (const [key, kind, min, max, step] of [['grid','checkbox'],['gridSnap','checkbox'],['objectSnap','checkbox'],['stepX','number',.01,100000,.1],['stepY','number',.01,100000,.1],['angleStep','number',.1,180,.1],['distance','range',2,32,1],['strength','range',.05,.8,.01]]) {
      const label = document.createElement('label'); label.className = 'field tool-field'; const title = document.createElement('span'); title.textContent = t(`sampling.${key}`); const input = document.createElement('input'); input.type = kind; input.dataset.sampling = key;
      if (kind !== 'checkbox') { input.min = min; input.max = max; input.step = step; } const value = samplingPreferences()[key]; input[kind === 'checkbox' ? 'checked' : 'value'] = value;
      input.oninput = () => { const value = kind === 'checkbox' ? input.checked : input.valueAsNumber; if (typeof value === 'number' && !Number.isFinite(value)) return; saveSamplingPreferences({ [key]: value }); change(); };
      label.append(title, input); this.details.append(label); this.fields.set(key, { label, input });
    }
    const label = document.createElement('label'); label.className = 'field tool-field'; const name = document.createElement('span'); name.textContent = t('sampling.coordinates'); this.coordinates = document.createElement('select');
    for (const key of ['world','local','delta']) this.coordinates.append(new Option(t(`sampling.${key}`),key)); this.coordinates.value = samplingPreferences().coordinates;
    this.coordinates.onchange = () => { saveSamplingPreferences({ coordinates: this.coordinates.value }); change(); }; label.append(name,this.coordinates); this.details.append(label);
    if (apply || cancel) { const actions = document.createElement('div'); actions.className = 'sampling-actions'; for (const [key, fn] of [['apply',apply],['cancel',cancel]]) if (fn) { const button = document.createElement('button'); button.type = 'button'; button.textContent = t(`sampling.${key}`); button.onclick = () => {if(key==='apply'){for(const input of this.values.values())if(!input.checkValidity()){input.reportValidity();return;}}fn();}; actions.append(button); } this.root.append(actions); }
  }
  sync(rotation, text) {
    if (this.readout.textContent !== text) this.readout.textContent = text; this.readout.hidden = !text;
    for (const key of ['stepX','stepY']) this.fields.get(key).label.hidden = rotation;
    this.fields.get('angleStep').label.hidden = !rotation;
  }
  configure(entries=[]) {
    this.valuesHost.replaceChildren();this.values.clear();
    for(const entry of entries){const label=document.createElement('label');label.className='field';const title=document.createElement('span');title.textContent=entry.label;const input=document.createElement('input');input.type='text';input.value=displayNumber(entry.value);input.dataset.exactValue=String(entry.value);input.dataset.sampleValue=entry.key;
      input.onfocus=()=>{input.value=input.dataset.exactValue;};
      input.onblur=()=>{if(input.checkValidity())input.value=displayNumber(Number(input.dataset.exactValue));};
      input.oninput=()=>{try{const value=evaluateNumericExpression(input.value);entry.change(value);input.dataset.exactValue=String(value);input.setCustomValidity('');}catch(error){input.setCustomValidity(error.message);}};
      label.append(title,input);this.valuesHost.append(label);this.values.set(entry.key,input);
    }
  }
  updateValues(values) {for(const[key,input]of this.values)if(document.activeElement!==input&&Number.isFinite(values[key])){input.dataset.exactValue=String(values[key]);input.value=displayNumber(values[key]);}}
  remove() { this.root.remove(); }
}
