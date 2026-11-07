import { currentLocale, translate as t } from '@rpen/core/i18n-core.mjs';
import { EASING_NAMES } from '@rpen/ui/easing-picker.mjs';
import { NodeOwnership } from './ownership.mjs';

const tr=(zh,en)=>currentLocale().locale.startsWith('zh')?zh:en;
const curves=EASING_NAMES.map((name,i)=>{const [family,direction]=name.split(' ');return{number:i+1,family,direction:direction==='InOut'?'IO':direction??'In'};});

export function installBatchPanels(api,state) {
  const editor=api.editor,root=document.querySelector('#multi-editor'),panel=root.closest('[data-panel]');
  let owner=new NodeOwnership(),decorations=[],queued=false,closed=false;
  const records=new Set();
  const reset=()=>{
    for(const record of records)record.dispose();
    owner.restore();owner=new NodeOwnership();
    for(const node of decorations)node.remove();decorations=[];records.clear();
    delete panel.dataset.rcProperty;delete panel.dataset.rcBatch;delete state.batchHeader;
  };
  const fieldText=field=>[...field.childNodes].find(n=>n.nodeType===3);
  const easingControl=native=>{
    if(native.closest('.rc-batch-easing'))return;
    const controls=document.createElement('span');controls.className='rc-easing-controls rc-batch-easing';native.before(controls);owner.move(native,controls);owner.attribute(native,'hidden','');
    const number=document.createElement('input');number.type='text';number.inputMode='numeric';number.className='rc-batch-easing-number';number.setAttribute('aria-label',tr('缓动编号','Easing number'));
    const direction=document.createElement('select');direction.className='rc-batch-easing-direction';direction.setAttribute('aria-label',tr('缓动方向','Easing direction'));
    const family=document.createElement('select');family.className='rc-batch-easing-family';family.setAttribute('aria-label',tr('缓动类型','Easing family'));
    for(const value of ['In','Out','IO'])direction.add(new Option(value,value));
    for(const value of new Set(curves.map(c=>c.family)))family.add(new Option(value,value));
    controls.append(number,direction,family);decorations.push(controls);
    const reflect=()=>{
      const curve=curves[Number(native.value)-1];if(!curve)return;
      if(document.activeElement!==number)number.value=String(curve.number);
      family.value=curve.family;direction.value=curve.direction;direction.disabled=curve.family==='Linear';
      for(const option of direction.options)option.disabled=!curves.some(c=>c.family===curve.family&&c.direction===option.value);
    };
    const apply=value=>{if(native.value!==String(value)){native.value=String(value);native.dispatchEvent(new Event('input',{bubbles:true}));}reflect();};
    number.oninput=event=>{
      event.stopPropagation();if(event.isComposing)return;
      const text=number.value.trim(),value=Number(text);
      if(!/^\d+$/.test(text)||!Number.isInteger(value)||value<1||value>curves.length){number.setAttribute('aria-invalid','true');return;}
      number.removeAttribute('aria-invalid');apply(value);
    };
    number.onblur=()=>{number.removeAttribute('aria-invalid');number.value=native.value;};
    for(const node of [direction,family])node.oninput=event=>{
      event.stopPropagation();const curve=curves.find(c=>c.family===family.value&&c.direction===direction.value)??curves.find(c=>c.family===family.value&&c.direction==='In')??curves.find(c=>c.family===family.value);apply(curve.number);
    };
    native.addEventListener('input',reflect);records.add({controls,reflect,dispose:()=>native.removeEventListener('input',reflect)});reflect();
  };
  const sync=()=>{
    if(closed)return;
    if(!state.active){if(decorations.length||panel.hasAttribute('data-rc-batch'))restore();return;}
    // Host open() replaces the root when changing note/event mode. Reclaim only
    // disconnected metadata, leaving active inputs, drafts and handlers alone.
    if(decorations.some(n=>!n.isConnected)){for(const record of records)record.dispose();owner=new NodeOwnership();decorations=[];records.clear();}
    if(!root.firstElementChild)return;
    if(panel.dataset.rcProperty!=='batch')panel.dataset.rcProperty='batch';
    const kind=editor.multiEdit.kind??'notes';
    if(panel.dataset.rcBatch!==kind)panel.dataset.rcBatch=kind;
    state.batchHeader=kind==='events'?tr('多事件编辑','Multiple events'):tr('多音符编辑','Multiple notes');
    for(const field of root.querySelectorAll('.field')){
      const node=fieldText(field);if(!node)continue;
      // A per-channel heading already names the channel; repeat only the field.
      const source=node.textContent,short=source===t('multi-edit.s60316f0')?tr('目标线号','Target lines'):source===t('multi-edit.s5e5824d')?tr('时间增量','Time offset'):source.replace(/^.+? · (?=数值下界|数值上界|缓动类型|周期数列|扰动)/,'');
      if(source!==short&&!field.hasAttribute('data-rc-short')){
        owner.attribute(field,'data-rc-short',source);node.textContent=short;
      }
    }
    for(const native of root.querySelectorAll('select'))if(native.options.length===EASING_NAMES.length&&native.options[0]?.value==='1')easingControl(native);
    for(const record of records)record.reflect();
    // Preserve the full built-in hint text in an optional disclosure, avoiding
    // long permanent paragraphs between the primary editing rows.
    for(const hint of root.querySelectorAll('p.hint')){
      if(hint.hasAttribute('role')||hint.closest('details')||hint.closest('.rc-batch-hints'))continue;
      let details=[...hint.parentNode.children].find(n=>n.classList.contains('rc-batch-hints'));
      if(!details){details=document.createElement('details');details.className='rc-batch-hints';const summary=document.createElement('summary');summary.textContent=tr('说明','Help');details.append(summary);hint.before(details);decorations.push(details);}
      owner.move(hint,details);
    }
    const preview=root.querySelector('.batch-preview-toggle');
    if(preview){
      const node=fieldText(preview);if(node&&node.textContent!==tr('结果预览','Result preview')){
        owner.attribute(preview,'data-rc-preview-text',node.textContent);node.textContent=tr('结果预览','Result preview');
      }
    }
  };
  const restore=()=>{
    for(const field of root.querySelectorAll('[data-rc-short]')){const node=fieldText(field);if(node)node.textContent=field.dataset.rcShort;}
    const preview=root.querySelector('[data-rc-preview-text]');if(preview){const node=fieldText(preview);if(node)node.textContent=preview.dataset.rcPreviewText;}
    reset();
  };
  const request=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});};
  const observer=new MutationObserver(request);observer.observe(root,{childList:true,subtree:true});
  api.on('editor:state',request);api.listen(document,'rpen-editor-skin-changed',request);
  api.patch(editor.multiEdit,'open',previous=>function(...args){const result=previous.apply(this,args);sync();return result;});
  api.dispose(()=>{closed=true;observer.disconnect();restore();});
  return {sync,restore};
}
