import { samplingPreferences } from '../platform/sampling-preferences.mjs';
import { displayNumber } from './spatial-display.mjs';
export function drawSamplingGrid(context, view, { rotation = false, center = { x: 0, y: 0 }, angle = 0, positionScale = { x: 1, y: 1 }, basis } = {}) {
  const settings = samplingPreferences(); if (!settings.grid) return;
  const { width, height } = context.canvas.getBoundingClientRect();
  context.save(); context.strokeStyle = `rgba(160,181,205,${settings.strength})`; context.fillStyle = '#a5b7c9'; context.lineWidth = 1; context.font = '11px sans-serif';
  if (rotation) {
    const p = view.screen(center), radius = Math.max(50, Math.min(width,height)*.35);
    context.beginPath(); context.arc(p.x,p.y,radius,0,Math.PI*2); context.stroke();
    const step = Math.max(settings.angleStep, 2);
    for (let deg=0; deg<360; deg+=step) { const a=deg*Math.PI/180; context.beginPath(); context.moveTo(p.x,p.y); context.lineTo(p.x+Math.cos(a)*radius,p.y+Math.sin(a)*radius); context.stroke(); if (deg%45<1e-6) context.fillText(`${deg}°`,p.x+Math.cos(a)*(radius+12),p.y+Math.sin(a)*(radius+12)); }
    context.strokeStyle='#e5c77b'; context.beginPath(); context.moveTo(p.x,p.y); context.lineTo(p.x+Math.cos(angle)*radius,p.y+Math.sin(angle)*radius); context.stroke();
  } else {
    basis ??= { origin:{x:0,y:0}, x:{x:positionScale.x,y:0}, y:{x:0,y:positionScale.y} };
    const o=view.screen(basis.origin),px=view.screen({x:basis.origin.x+basis.x.x,y:basis.origin.y+basis.x.y}),py=view.screen({x:basis.origin.x+basis.y.x,y:basis.origin.y+basis.y.y});
    const vx={x:px.x-o.x,y:px.y-o.y},vy={x:py.x-o.x,y:py.y-o.y},det=vx.x*vy.y-vx.y*vy.x;
    if(Math.abs(det)>1e-10){const corners=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>{
      if(view.projective){const p=view.world({x,y}),d=basis.x.x*basis.y.y-basis.x.y*basis.y.x;if(!p||Math.abs(d)<1e-10)return{x:0,y:0};const dx=p.x-basis.origin.x,dy=p.y-basis.origin.y;return{x:(dx*basis.y.y-dy*basis.y.x)/d,y:(basis.x.x*dy-basis.x.y*dx)/d};}
      return{x:((x-o.x)*vy.y-(y-o.y)*vy.x)/det,y:(vx.x*(y-o.y)-vx.y*(x-o.x))/det};});
      const bounds={x:[Math.min(...corners.map(p=>p.x)),Math.max(...corners.map(p=>p.x))],y:[Math.min(...corners.map(p=>p.y)),Math.max(...corners.map(p=>p.y))]};
      const point=(x,y)=>view.projective?view.screen({x:basis.origin.x+basis.x.x*x+basis.y.x*y,y:basis.origin.y+basis.x.y*x+basis.y.y*y}):({x:o.x+vx.x*x+vy.x*y,y:o.y+vx.y*x+vy.y*y});
      for(const axis of ['x','y']){const unit=axis==='x'?settings.stepX:settings.stepY,v=axis==='x'?vx:vy,stride=Math.max(1,Math.ceil(14/Math.max(1e-8,unit*Math.hypot(v.x,v.y)))),step=unit*stride,[low,high]=bounds[axis];
        for(let i=Math.ceil(low/step),count=0;i<=Math.floor(high/step)&&count<500;i++,count++){const a=axis==='x'?point(i*step,bounds.y[0]):point(bounds.x[0],i*step),b=axis==='x'?point(i*step,bounds.y[1]):point(bounds.x[1],i*step);context.strokeStyle=i===0?'#a1bdd077':`rgba(160,181,205,${settings.strength})`;context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();if(i%5===0){const p=axis==='x'?point(i*step,bounds.y[0]):point(bounds.x[0],i*step);context.fillText(displayNumber(i*step),Math.max(3,Math.min(width-25,p.x+3)),Math.max(12,Math.min(height-6,p.y-3)));}}
      }
    }
  }
  context.restore();
}
export function drawSnapGuides(context, view, result) { if (!result?.guides?.length) return; const {width,height}=context.canvas.getBoundingClientRect(); context.save(); context.strokeStyle='#e5bf73';context.setLineDash([4,3]); for(const target of result.guides){const p=view.screen(result);context.beginPath();if(result.basis){const axis=target.axis==='x'?result.basis.y:result.basis.x,q=view.screen({x:result.x+axis.x,y:result.y+axis.y}),dx=q.x-p.x,dy=q.y-p.y,l=Math.hypot(dx,dy)||1,r=Math.hypot(width,height);context.moveTo(p.x-dx/l*r,p.y-dy/l*r);context.lineTo(p.x+dx/l*r,p.y+dy/l*r);}else if(target.axis==='x'){context.moveTo(p.x,0);context.lineTo(p.x,height);}else{context.moveTo(0,p.y);context.lineTo(width,p.y);}context.stroke();}context.restore(); }
