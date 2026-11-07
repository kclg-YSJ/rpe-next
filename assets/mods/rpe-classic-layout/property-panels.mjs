import { evaluateNumericExpression, evaluateEventNumber } from '@rpen/core/numeric-expression.mjs';
import { currentLocale, translate as t } from '@rpen/core/i18n-core.mjs';
import { selectedEventEntries } from '@rpen/application/event-commands.mjs';
import { installPropertyPointer } from './property-pointer.mjs';
import { installPropertyEasing } from './property-easing.mjs';

const tr=(zh,en)=>currentLocale().locale.startsWith('zh')?zh:en;

export function installPropertyPanels(api,state){
  const e=api.editor,controller=new AbortController(),wrappers=new Set(),labels=new Map(),forms=['#properties','#event-properties'].map(s=>document.querySelector(s));
  const resetPointer=installPropertyPointer(api,state),easing=installPropertyEasing(api);
  const styleNumbers=form=>{
    for(const wrapper of wrappers)if(!wrapper.isConnected)wrappers.delete(wrapper);
    for(const input of form.querySelectorAll('input[type=number],input.numeric-expression-number')){
      if(input.closest('.rc-property-number')||input.type==='range')continue;
      const wrapper=document.createElement('span');wrapper.className='rc-property-number';input.before(wrapper);wrapper.append(input);
      const spin=document.createElement('span');spin.className='rc-property-spin';wrapper.append(spin);wrappers.add(wrapper);
      for(const direction of [1,-1]){
        const button=document.createElement('button');button.type='button';button.textContent=direction>0?'▴':'▾';button.title=direction>0?tr('增加','Increase'):tr('减少','Decrease');button.setAttribute('aria-label',button.title);button.dataset.rcStep=String(direction);
        button.onpointerdown=event=>event.preventDefault();button.onclick=()=>{
          if(input.disabled||input.readOnly)return;
          let value;try{value=evaluateNumericExpression(input.value);}catch{
            if(form.id!=='event-properties')return;
            const key=[...e.session.eventSelection][0],split=key?.lastIndexOf(':')??-1,type=key?.slice(0,split),index=Number(key?.slice(split+1));
            const event=(e.timeline.extended?e.session.line?.extended:e.session.line?.eventLayers?.[e.session.eventLayer])?.[type]?.[index];
            try{value=evaluateEventNumber(input.value,{type,field:input.dataset.rpenField,event,tempo:e.tempo,factor:e.session.line?.bpmfactor??1});}catch{return;}
          }
          const step=input.step==='any'?1:Number(input.step)||1,next=Math.max(input.min===''?-Infinity:Number(input.min),Math.min(input.max===''?Infinity:Number(input.max),value+step*direction));
          input.value=String(Number(next.toPrecision(12)));input.dispatchEvent(new Event('change',{bubbles:true}));button.blur();
        };spin.append(button);
      }
    }
  };
  const restore=()=>{
    resetPointer();easing.restore();
    state.propertyHeaders={};
    for(const [node,original]of labels)if(node.isConnected)node.textContent=original;labels.clear();
    for(const form of forms){const panel=form.closest('[data-panel]');delete panel.dataset.rcProperty;delete panel.dataset.rcShader;}
    for(const wrapper of wrappers){const input=wrapper.querySelector('input');if(input&&wrapper.isConnected)wrapper.replaceWith(input);}wrappers.clear();
  };
  const sync=()=>{
    if(!state.active){if(wrappers.size)restore();return;}
    const headers={};
    for(const node of labels.keys())if(!node.isConnected)labels.delete(node);
    for(const form of forms){
      const kind=form.id==='properties'?'note':'event';
      const count=kind==='note'?e.session.multiLineActive?[...e.session.multiLineSelection.values()].reduce((sum,s)=>sum+s.size,0):e.session.selection.size:e.session.multiLineActive?[...e.session.multiEventSelection.values()].reduce((sum,s)=>sum+s.size,0):e.session.eventSelection.size;
      const panel=form.closest('[data-panel]');
      if(count===1){
        if(panel.dataset.rcProperty!==kind)panel.dataset.rcProperty=kind;styleNumbers(form);
        if(kind==='note'){
          const type=e.session.selectedNoteEntries()[0]?.note.type;
          headers.notes=([null,'Tap','Hold','Flick','Drag'][type]??'')+tr('音符编辑',' note editor');
        }else{
          easing.sync(form);
          const type=selectedEventEntries(e.session)[0]?.type;
          if(type==='paintEvents'){
            panel.dataset.rcShader='true';
            const short=new Map([
              [t('shader-inspector.se04a1db'),tr('全局','Global')],
              [t('shader-inspector.s92bc481'),tr('自动对齐','Auto-align')],
              [t('shader-inspector.s22d7b36'),tr('对齐拍','Align beat')],
              [t('shader-inspector.sc68a591'),tr('缓动','Easing')],
              ...['s087c451','sc4d3fa4','s532cd47','s00005a6'].map(key=>{
                const title=t('shader-inspector.'+key);
                return [t('shader-inspector.sa37c86d',{p0:title}),title];
              })
            ]);
            for(const field of form.querySelectorAll('.field')){
              const node=[...field.childNodes].find(n=>n.nodeType===3),text=node?.textContent;
              if(short.has(text)&&!labels.has(node)){labels.set(node,text);node.textContent=short.get(text);}
            }
          }else delete panel.dataset.rcShader;
          const names={moveXEvents:['移动X','Move X'],moveYEvents:['移动Y','Move Y'],rotateEvents:['旋转','Rotation'],alphaEvents:['透明度','Opacity'],speedEvents:['速度','Speed'],scaleXEvents:['缩放X','Scale X'],scaleYEvents:['缩放Y','Scale Y'],colorEvents:['颜色','Color'],textEvents:['文字','Text'],inclineEvents:['倾斜','Incline'],paintEvents:['着色器','Shader']};
          const name=names[type];headers.events=(name?tr(...name):e.timeline.eventLabels?.[e.timeline.eventTypes.indexOf(type)]??'')+tr('事件编辑',' event editor');
          for(const label of form.querySelectorAll(':scope > .field:has(> input[type=checkbox])')){
            const node=[...label.childNodes].find(n=>n.nodeType===3);
            if(node&&/首尾同步|sync.*(?:start|end)|start.*end.*sync/i.test(node.textContent)&&!labels.has(node)){
              labels.set(node,node.textContent);node.textContent=tr('钩定','Hook');
            }
          }
        }
      }
      else {delete panel.dataset.rcProperty;delete panel.dataset.rcShader;}
    }
    state.propertyHeaders=headers;
  };
  let queued=false;
  const request=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;sync();});};
  const observer=new MutationObserver(request);for(const form of forms)observer.observe(form,{childList:true,subtree:true});
  api.on('editor:state',request);api.listen(document,'rpen-editor-skin-changed',request);
  // Suppress the host's invisible internal spinner region; the external arrows
  // dispatch the original change handler and leave expression/text focus intact.
  window.addEventListener('pointerdown',event=>{
    const input=event.target;if(!state.active||event.button!==0||!input.matches?.('[data-rc-property] .rc-property-number > input'))return;
    if(event.clientX>=input.getBoundingClientRect().right-16)event.stopPropagation();
  },{capture:true,signal:controller.signal});
  api.dispose(()=>{controller.abort();observer.disconnect();restore();});
  sync();
  return {sync,restore};
}
