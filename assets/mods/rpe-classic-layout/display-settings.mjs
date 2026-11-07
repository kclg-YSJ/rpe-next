import { currentLocale } from '@rpen/core/i18n-core.mjs';

export function installDisplaySettings(api,state) {
  const editor=api.editor,dialog=document.querySelector('#settings-modal'),anchor=dialog.querySelector('#event-curve-threshold').closest('.field');
  const label=document.createElement('label');label.className='field';label.dataset.rpenField='rpe-classic-event-curve-width';
  const input=document.createElement('input');input.type='range';input.id='rpe-classic-event-curve-width';input.min='.5';input.max='12';input.step='.25';
  const title=currentLocale().locale.startsWith('zh')?'事件曲线宽度':'Event curve width';label.append(title,input);input.setAttribute('aria-label',title);anchor.after(label);
  let dirty=false,saved=api.settings.get('event-curve-width');
  const sync=()=>{if(!dirty){saved=api.settings.get('event-curve-width');state.eventCurveWidth=saved;input.value=String(saved);}label.hidden=!state.active;editor.invalidate();};
  const flush=()=>{if(!dirty)return;dirty=false;const value=state.eventCurveWidth;if(value===saved)return;saved=value;api.settings.set('event-curve-width',value).catch(error=>api.notify(error.message,'error'));};
  const preview=value=>{state.eventCurveWidth=value;input.value=String(value);dirty=true;editor.invalidate();};
  api.listen(input,'input',()=>preview(input.valueAsNumber));api.listen(input,'change',flush);api.listen(input,'blur',flush);api.listen(dialog,'close',flush);api.listen(window,'pagehide',flush);
  const reset=anchor.closest('.settings-group').querySelector('.settings-reset');let resetting=false,restored=false;
  api.listen(reset,'click',()=>{resetting=true;restored=false;},{capture:true});
  api.listen(anchor.querySelector('input'),'input',()=>{if(resetting)restored=true;});
  api.listen(reset,'click',()=>{const accepted=resetting&&restored;resetting=false;if(accepted){preview(api.manifestSource.settings['event-curve-width'].default);flush();}});
  api.settings.onChange(({key,value})=>{if(key==='event-curve-width'){dirty=false;saved=value;state.eventCurveWidth=value;}sync();});api.dispose(()=>{flush();label.remove();});sync();return()=>{if(!state.active)flush();sync();};
}
