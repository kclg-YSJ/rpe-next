import { drawEventCurve } from '@rpen/ui/event-curve.mjs';

export function createClassicCurveCache(){
  const paths=new Map(),limit=4096,budget=8*1024*1024;let bytes=0;
  const remember=(owner,record)=>{
    const previous=paths.get(owner);if(previous){bytes-=previous.bytes;paths.delete(owner);}
    if(record.bytes>budget)return;
    while(paths.size&&(paths.size>=limit||bytes+record.bytes>budget)){const oldest=paths.keys().next().value;bytes-=paths.get(oldest).bytes;paths.delete(oldest);}
    paths.set(owner,record);bytes+=record.bytes;
  };
  return {clear(){paths.clear();bytes=0;},get(event,range,width,delta,options){
    const old=paths.get(event);
    const points=event.bezierPoints?.join(','),padding=options.padding??6,steps=options.steps??36;
    if(old&&Math.abs(old.delta-delta)<1e-7&&old.minimum===range?.min&&old.maximum===range?.max&&old.width===width&&old.padding===padding&&old.steps===steps&&old.start===event.start&&old.end===event.end&&old.easingType===event.easingType&&old.easingLeft===event.easingLeft&&old.easingRight===event.easingRight&&old.bezier===event.bezier&&old.points===points&&old.custom===event.customEasing&&old.curve===event.customEasing?.curve&&old.constant===options.drawConstant)return old.path;
    const path=new Path2D(),drawn=drawEventCurve(path,event,range,{x:0,width},0,delta,{...options,append:true});
    remember(event,{bytes:256+(drawn?(steps+1)*24:0),minimum:range?.min,maximum:range?.max,width,padding,steps,start:event.start,end:event.end,easingType:event.easingType,easingLeft:event.easingLeft,easingRight:event.easingRight,bezier:event.bezier,points,custom:event.customEasing,curve:event.customEasing?.curve,constant:options.drawConstant,delta,path:drawn?path:null});return drawn?path:null;
  },batch(entries,width,options){
    const group=entries[0].range,old=paths.get(group),anchor=entries[0].startY,delta=entries.at(-1).endY-anchor,padding=options.padding??6,steps=options.steps??36;
    if(old?.events&&old.width===width&&old.padding===padding&&old.steps===steps&&old.minimum===group.min&&old.maximum===group.max&&old.constant===options.drawConstant&&Math.abs(old.delta-delta)<1e-7&&old.events.length===entries.length&&old.events.every((event,index)=>event===entries[index].event))return old.path;
    const path=new Path2D();for(const entry of entries)drawEventCurve(path,entry.event,entry.range,{x:0,width},entry.startY-anchor,entry.endY-anchor,{...options,append:true});
    remember(group,{bytes:256+entries.length*(steps+1)*24,events:entries.map(entry=>entry.event),width,padding,steps,minimum:group.min,maximum:group.max,constant:options.drawConstant,delta,path});return path;
  }};
}

function strokePath(context,path,x,y,options){
  const matrix=options.transform;
  if(matrix){
    const width=context.lineWidth;context.lineWidth=options.lineWidth??2;
    context.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e+x*matrix.a+y*matrix.c,matrix.f+x*matrix.b+y*matrix.d);
    try{context.stroke(path);}finally{context.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);context.lineWidth=width;}
  }else{context.save();context.lineWidth=options.lineWidth??2;context.translate(x,y);context.stroke(path);context.restore();}
}

// Keep the host's bounded shape caches and easing math. append skips its
// column rectangle clip; the canvas still provides the workbench boundary.
export function drawClassicEventCurve(context,event,range,rect,startY,endY,options={}) {
  if(options.cache){
    const path=options.cache.get(event,range,rect.width,endY-startY,options);if(!path)return false;
    strokePath(context,path,rect.x,startY,options);return true;
  }
  context.save();context.lineWidth=options.lineWidth??2;context.beginPath();
  const drawn=drawEventCurve(context,event,range,rect,startY,endY,{...options,append:true});
  if(drawn)context.stroke();context.restore();return drawn;
}
export function drawClassicEventCurveBatch(context,entries,rect,options={}) {
  if(!entries.length)return;
  if(options.cache){strokePath(context,options.cache.batch(entries,rect.width,options),rect.x,entries[0].startY,options);return;}
  context.save();context.lineWidth=options.lineWidth??2;context.beginPath();
  for(const {event,range,startY,endY}of entries)drawEventCurve(context,event,range,rect,startY,endY,{...options,append:true});
  context.stroke();context.restore();
}
