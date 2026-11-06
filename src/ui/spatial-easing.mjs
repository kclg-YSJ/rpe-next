import { createEasingPicker,EASING_NAMES } from './easing-picker.mjs';
import { createCustomEasingControls } from './custom-easing-controls.mjs';
import { eventListAt } from '../application/event-commands.mjs';
import { changeSpatialEasing } from '../application/spatial-edit.mjs';
import { previewCurveEvent } from '../application/animation-curve-preview.mjs';
import { withStandardEasing } from '../core/event-easing.mjs';
import { beatValue } from '../core/beat.mjs';
import { evaluateNumericExpression } from '../core/numeric-expression.mjs';
import { displayNumber } from './spatial-display.mjs';
import { t } from '../i18n.mjs';

const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
const sameSource=(a,b)=>a&&b&&['lineIndex','layer','type','index','field','axis'].every(key=>a[key]===b[key]);
export class SpatialEasingControls {
  constructor(host,panel){this.host=host;this.panel=panel;this.galleryState={open:false};this.advancedOpen=false;}
  sync(){
    const p=this.panel,session=p.context.session,source=p.source;
    this.host.hidden=!p.selected||!source;if(this.host.hidden)return;
    const event=eventListAt({chart:session.chart,eventLayer:source.layer},source.lineIndex,source.type)[source.index];
    if(!event)return;
    if(this.session===session&&this.event===event&&sameSource(this.source,source))return;
    this.session=session;this.source=source;this.event=event;this.host.replaceChildren();
    const location={...source},readSource=()=>{
      if(p.context.session!==session||!p.lineAllowed(location.lineIndex)||!sameSource(p.source??p.reselect?.source,location))throw Error(t('spatial.stale'));
      const current=eventListAt({chart:session.chart,eventLayer:location.layer},location.lineIndex,location.type)[location.index];
      if(!current)throw Error(t('spatial.stale'));return{...location,event:current};
    };
    const read=()=>{try{return readSource().event;}catch{return null;}},report=error=>p.fail(error);
    const change=transform=>p.editEasing(readSource(),transform);
    const safe=action=>{try{action();}catch(error){report(error);}};
    const factor=session.chart.judgeLineList[source.lineIndex].bpmfactor??1,tempo=p.context.tempo;
    const start=tempo.beat(tempo.seconds(event.startTime,factor)),end=tempo.beat(tempo.seconds(event.endTime,factor));
    this.host.append(element('small',t('spatial.easingRange',{start:displayNumber(start),end:displayNumber(end)}),'hint spatial-easing-range'));
    if(event.trajectory||beatValue(event.endTime)<=beatValue(event.startTime)){
      this.host.append(element('p',t(event.trajectory?'spatial.easingTrajectory':'spatial.easingDuration'),'hint'));return;
    }
    const label=element('label',null,'field tool-field');label.append(element('span',t('spatial.easing')));
    const select=element('select');select.dataset.spatial='easingType';select.setAttribute('aria-label',t('spatial.easing'));
    for(const[name,index]of EASING_NAMES.map((name,index)=>[name,index+1]))select.append(new Option(`${index} · ${name}`,String(index)));
    if(event.customEasing||event.bezier){const option=new Option(event.customEasing?(event.customEasing.curve.name||t('animation-curve.unnamed')):'Bézier','custom');option.disabled=true;select.append(option);select.value='custom';}else select.value=String(event.easingType??1);
    select.onchange=()=>safe(()=>change(current=>withStandardEasing(current,Number(select.value))));label.append(select);this.host.append(label);
    this.host.append(createEasingPicker(event.customEasing||event.bezier?0:event.easingType??1,value=>safe(()=>change(current=>withStandardEasing(current,value))),this.galleryState).element);
    this.host.append(createCustomEasingControls(event,change,{
      read,report,timing:{BPMList:session.chart.BPMList,factor},
      signature:()=>{const current=p.source??p.reselect?.source;return p.context.session===session&&sameSource(current,location)?JSON.stringify([location.lineIndex,location.layer,location.type,location.index,location.field,location.axis]):'';},
      preview:curve=>p.previewEasing(readSource(),current=>previewCurveEvent(current,curve)),
      cancelPreview:()=>p.cancelEasingPreview(),
      previewChart:curve=>({chart:changeSpatialEasing(session.chart,readSource(),current=>previewCurveEvent(current,curve)),lineIndex:source.lineIndex}),
    }));
    if(event.customEasing)return;
    const advanced=element('details',null,'spatial-easing-advanced');advanced.open=this.advancedOpen;
    advanced.append(element('summary',t('spatial.easingParameters')));advanced.ontoggle=()=>{if(advanced.isConnected)this.advancedOpen=advanced.open;};
    const inputField=(key,title,value,apply)=>{
      const label=element('label',null,'field tool-field'),input=element('input');input.type='text';input.value=value;input.dataset.spatial=key;
      label.append(element('span',title),input);input.onchange=()=>safe(()=>{apply(input.value);input.setCustomValidity('');});advanced.append(label);return input;
    };
    for(const[key,fallback]of[['easingLeft',0],['easingRight',1]])inputField(key,t('spatial.'+key),String(event[key]??fallback),value=>change(current=>({...current,[key]:evaluateNumericExpression(value)})));
    const bezierLabel=element('label',null,'field tool-field'),bezier=element('input');bezier.type='checkbox';bezier.checked=Boolean(event.bezier);bezier.dataset.spatial='bezier';bezierLabel.append(element('span','Bézier'),bezier);advanced.append(bezierLabel);
    bezier.onchange=()=>safe(()=>change(current=>({...current,bezier:Number(bezier.checked),bezierPoints:current.bezierPoints?.length===4?current.bezierPoints:[0,0,1,1]})));
    if(event.bezier)inputField('bezierPoints',t('spatial.easingHandles'),(event.bezierPoints??[0,0,1,1]).join(', '),value=>{const parts=value.split(/[,，]/);if(parts.length!==4||parts.some(p=>!p.trim()))throw Error(t('spatial.easingBezier'));const points=parts.map(evaluateNumericExpression);change(current=>({...current,bezierPoints:points}));});
    this.host.append(advanced);
  }
}
