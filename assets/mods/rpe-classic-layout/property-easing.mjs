import { EASING_NAMES } from '@rpen/ui/easing-picker.mjs';
import { renderEventInspector } from '@rpen/ui/event-inspector.mjs';
import { selectedEventEntries } from '@rpen/application/event-commands.mjs';
import { currentLocale } from '@rpen/core/i18n-core.mjs';
import { NodeOwnership } from './ownership.mjs';
import { installEasingDraft } from './easing-draft.mjs';

const tr=(zh,en)=>currentLocale().locale.startsWith('zh')?zh:en;
// Derive the 29-number mapping from the host rather than assuming that each
// family has three consecutive entries (Quint/Expo have no IO in this format).
const curves=EASING_NAMES.map((name,index)=>{
  const [family,direction]=name.split(' ');
  return {number:index+1,family,direction:direction==='InOut'?'IO':direction??'In'};
});
const families=[...new Set(curves.map(curve=>curve.family))];
const positionFamily=family=>{const rect=family.getBoundingClientRect();family.style.setProperty('--rc-picker-left',rect.left+'px');family.style.setProperty('--rc-picker-top',rect.bottom+'px');family.style.setProperty('--rc-picker-width',rect.width+'px');};

export function installPropertyEasing(api) {
  const records=new Set(),editor=api.editor,draft=installEasingDraft(api);
  api.hook('input:before',({event})=>{
    const family=event.target.closest?.('.rc-easing-family');
    if(family&&['keydown','keyup'].includes(event.type)){
      if(!family.matches(':open'))positionFamily(family);
      event.stopImmediatePropagation();
    }
  });
  const restore=()=>{
    for(const record of records){record.dispose();record.owner.restore();record.controls.remove();record.boundaries?.remove();}
    records.clear();
  };
  const sync=form=>{
    for(const record of records)if(!record.controls.isConnected){record.dispose();records.delete(record);}
    const native=[...form.querySelectorAll(':scope > .field > select')].find(node=>node.options.length===EASING_NAMES.length&&node.options[0]?.value==='1');
    if(!native)return;
    const owner=new NodeOwnership(),row=native.parentNode,controls=document.createElement('span');controls.className='rc-easing-controls';
    native.before(controls);owner.move(native,controls);owner.attribute(native,'hidden','');owner.attribute(native,'data-rc-native-easing','');
    const number=document.createElement('input');number.type='text';number.inputMode='numeric';number.className='rc-easing-number';number.setAttribute('aria-label',tr('缓动编号','Easing number'));number.autocomplete='off';
    const direction=document.createElement('select');direction.className='rc-easing-direction';direction.setAttribute('aria-label',tr('缓动方向','Easing direction'));
    const family=document.createElement('select');family.className='rc-easing-family';family.setAttribute('aria-label',tr('缓动类型','Easing family'));
    for(const value of ['In','Out','IO'])direction.add(new Option(value,value));
    for(const value of families)family.add(new Option(value,value));
    family.addEventListener('pointerdown',()=>positionFamily(family));
    controls.append(number,direction,family);
    const reflect=(id,preserveNumber=false)=>{
      const curve=curves[id-1];if(!curve)return;
      if(!preserveNumber)number.value=String(id);
      family.value=curve.family;direction.value=curve.direction;
      direction.disabled=curve.family==='Linear';
      for(const option of direction.options)option.disabled=!curves.some(c=>c.family===curve.family&&c.direction===option.value);
      for(const button of form.querySelectorAll('.easing-gallery [data-easing]')){
        const active=Number(button.dataset.easing)===id;
        button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      }
    };
    const apply=(id,preserveNumber=false)=>{
      reflect(id,preserveNumber);
      if(Number(native.value)===id)return;
      const commit=()=>{native.value=String(id);native.dispatchEvent(new Event('change',{bubbles:true}));};
      if(preserveNumber)draft.update(commit);else{draft.finish(true);commit();}
    };
    const applyNumber=event=>{
      if(event?.isComposing)return;
      const text=number.value.trim(),id=Number(text),valid=/^\d+$/.test(text)&&Number.isInteger(id)&&id>=1&&id<=curves.length;
      if(!valid){number.setAttribute('aria-invalid','true');return;}
      number.removeAttribute('aria-invalid');apply(id,true);
    };
    const finishNumber=()=>{
      const valid=!number.hasAttribute('aria-invalid');draft.finish(valid);
      if(!valid){const entry=selectedEventEntries(editor.session)[0];native.value=String(entry?.event.easingType??1);reflect(Number(native.value),true);}
    };
    number.oninput=applyNumber;number.onchange=()=>{applyNumber();finishNumber();};
    number.onkeydown=event=>{
      if(event.key!=='Enter'&&event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();
      if(event.key==='Enter'){applyNumber();finishNumber();if(number.hasAttribute('aria-invalid'))return;}else{draft.finish(false);const entry=selectedEventEntries(editor.session)[0];native.value=String(entry?.event.easingType??1);reflect(Number(native.value));number.removeAttribute('aria-invalid');}
      number.blur();
    };
    const choose=()=>{
      const matching=curves.find(c=>c.family===family.value&&c.direction===direction.value)??curves.find(c=>c.family===family.value&&c.direction==='In')??curves.find(c=>c.family===family.value);
      apply(matching.number);document.activeElement?.blur();
    };
    direction.onchange=choose;family.onchange=choose;
    // Keep focus and typed text while the real select's native transaction runs.
    // Rebuild through the host only after focus leaves this three-control group.
    let disposed=false;
    controls.addEventListener('focusin',()=>{editor.session.liveEventEdit=true;});
    controls.addEventListener('focusout',()=>requestAnimationFrame(()=>{
      if(disposed||family.matches(':open')||controls.contains(document.activeElement)||!controls.isConnected)return;
      finishNumber();
      editor.session.liveEventEdit=false;
      renderEventInspector(editor.session,editor.tempo,editor.currentBeat,error=>api.notify(error.message,'error'),(message,severity)=>api.notify(message,severity),editor.eventSampler);
    }));
    reflect(Number(native.value)||1);
    const hook=form.querySelector(':scope > .field:has(> input[type=checkbox])');
    if(hook)owner.move(hook,form,row.nextSibling);
    const binding=form.querySelector(':scope > .field[data-rpen-field=linkgroup]');
    if(binding)owner.move(binding,form,(hook??row).nextSibling);
    const group=form.querySelector(':scope > button.wide-button');
    if(group&&binding)owner.move(group,form,binding.nextSibling);
    const templates=form.querySelector(':scope > .custom-easing-group'),movement=form.querySelector(':scope > .movement-vector-panel');
    if(templates&&movement)owner.move(movement,form,templates.nextSibling);
    const left=form.querySelector(':scope > .field[data-rpen-field=easingLeft]'),right=form.querySelector(':scope > .field[data-rpen-field=easingRight]');
    let boundaries;
    if(left&&right){
      boundaries=document.createElement('div');boundaries.className='field rc-easing-boundaries';
      const title=document.createElement('span');title.textContent=tr('缓动边界','Easing bounds');
      const pair=document.createElement('span');pair.className='rc-easing-boundary-pair';boundaries.append(title,pair);left.before(boundaries);
      owner.move(left,pair);owner.move(right,pair);
    }
    const boundSession=editor.session;
    records.add({owner,controls,boundaries,dispose(){disposed=true;finishNumber();if(controls.contains(document.activeElement)||!controls.isConnected)boundSession.liveEventEdit=false;}});
  };
  return {sync,restore};
}
