export const SAMPLING_DEFAULTS = Object.freeze({ grid: true, gridSnap: true, objectSnap: true, stepX: 100, stepY: 100, angleStep: 15, distance: 8, strength: .24, coordinates: 'world' });
export function normalizeSampling(value = {}) {
  const result = { ...SAMPLING_DEFAULTS };
  for (const key of ['grid', 'gridSnap', 'objectSnap']) if (typeof value[key] === 'boolean') result[key] = value[key];
  for (const [key, min, max] of [['stepX', .01, 100000], ['stepY', .01, 100000], ['angleStep', .1, 180], ['distance', 2, 32], ['strength', .05, .8]]) if (Number.isFinite(value[key])) result[key] = Math.max(min, Math.min(max, value[key]));
  if (['world', 'local', 'delta'].includes(value.coordinates)) result.coordinates = value.coordinates;
  return result;
}
const roundTo = (n, step, origin = 0) => origin + Math.round((n - origin) / step) * step;
export function sampleInBasis(point,basis){const dx=point.x-basis.origin.x,dy=point.y-basis.origin.y,det=basis.x.x*basis.y.y-basis.x.y*basis.y.x;if(Math.abs(det)<1e-12)return null;return{x:(dx*basis.y.y-dy*basis.y.x)/det,y:(basis.x.x*dy-basis.x.y*dx)/det};}
export function sampleFromBasis(point,basis){return{x:basis.origin.x+point.x*basis.x.x+point.y*basis.y.x,y:basis.origin.y+point.x*basis.x.y+point.y*basis.y.y};}
export function snapSamplePoint(point, { settings = SAMPLING_DEFAULTS, targets = [], scale = 1, previous, origin = { x: 0, y: 0 }, free = false } = {}) {
  if (free) return { ...point, guides: [] };
  const guides = [];
  const result = { ...point };
  for (const axis of ['x', 'y']) {
    const radius=settings.distance/Math.max(1e-8,typeof scale==='number'?scale:scale[axis]);
    const candidates = settings.objectSnap ? targets.filter(t => Number.isFinite(t[axis])).map(t => ({ ...t, error: Math.abs(t[axis] - point[axis]), axis })) : [];
    const held = previous?.guides?.find(t => t.axis === axis);
    const target = held && candidates.find(t => t.id === held.id && t.error <= radius * 1.5) || candidates.filter(t => t.error <= radius).sort((a, b) => a.error - b.error)[0];
    if (target) { result[axis] = target[axis]; guides.push(target); }
    else if (settings.gridSnap) {
      const value = roundTo(point[axis], settings[axis === 'x' ? 'stepX' : 'stepY'], settings.coordinates === 'delta' ? origin[axis] : 0);
      const id = 'grid:' + axis + ':' + value;
      const held = previous?.guides?.some(guide => guide.id === id);
      if (Math.abs(value - point[axis]) <= radius * (held ? 1.5 : 1)) { result[axis] = value; guides.push({ id, axis, [axis]: value, grid: true }); }
    }
  }
  return { ...result, guides };
}
export function snapConstrainedPoint(point, base, axis, options = {}) {
  const {settings=SAMPLING_DEFAULTS,targets=[],scale=1,origin={x:0,y:0},previous,free=false}=options;
  const length=axis.x*axis.x+axis.y*axis.y;if(length<1e-12)return{...base,guides:[]};
  const amount=((point.x-base.x)*axis.x+(point.y-base.y)*axis.y)/length;
  const at=t=>({x:base.x+t*axis.x,y:base.y+t*axis.y});const projected=at(amount);
  if(free)return{...projected,guides:[]};
  const screenScale=typeof scale==='number'?scale:Math.hypot(axis.x*scale.x,axis.y*scale.y)/Math.sqrt(length);
  const radius=settings.distance/Math.max(1e-8,screenScale),candidates=[];
  for(const dimension of ['x','y']){if(Math.abs(axis[dimension])<1e-9)continue;
    if(settings.objectSnap)for(const target of targets){if(!Number.isFinite(target[dimension]))continue;const t=(target[dimension]-base[dimension])/axis[dimension],distance=Math.abs(t-amount)*Math.sqrt(length),held=previous?.guides?.some(p=>p.id===target.id&&p.axis===dimension);if(distance<=radius*(held?1.5:1))candidates.push({t,distance:held?-1:distance,guide:{...target,axis:dimension}});}
  }
  let best=candidates.sort((a,b)=>a.distance-b.distance)[0];
  if(!best&&settings.gridSnap){for(const dimension of ['x','y']){if(Math.abs(axis[dimension])<1e-9)continue;const value=roundTo(projected[dimension],settings[dimension==='x'?'stepX':'stepY'],settings.coordinates==='delta'?origin[dimension]:0),t=(value-base[dimension])/axis[dimension],distance=Math.abs(t-amount)*Math.sqrt(length),id='grid:'+dimension+':'+value,held=previous?.guides?.some(guide=>guide.id===id);if(distance<=radius*(held?1.5:1)&&(!best||distance<best.distance))best={t,distance,guide:{id,axis:dimension,[dimension]:value,grid:true}};}}
  return best?{...at(best.t),guides:best.guide?[best.guide]:[]}:{...projected,guides:[]};
}
export function unwrapAngle(angle, near, period = 360) { return angle + Math.round((near - angle) / period) * period; }
export function snapSampleAngle(angle, { settings = SAMPLING_DEFAULTS, targets = [], previous, free = false, origin = 0 } = {}) {
  if (free) return { angle };
  const radius = Math.min(4, settings.angleStep / 4);
  const candidates = settings.objectSnap ? targets.filter(t => Number.isFinite(t.rotation)).flatMap(t => [0, 90].map(offset => ({ ...t, angle: unwrapAngle(t.rotation + offset, angle, 180) }))) : [];
  const held = previous && candidates.find(t => t.id === previous.id && Math.abs(t.angle - angle) <= radius * 1.5);
  const target = held || candidates.filter(t => Math.abs(t.angle - angle) <= radius).sort((a,b) => Math.abs(a.angle-angle)-Math.abs(b.angle-angle))[0];
  if (target) return target;
  if (settings.gridSnap) {
    const value = roundTo(angle, settings.angleStep, settings.coordinates === 'delta' ? origin : 0), id = 'grid:angle:' + value;
    if (Math.abs(value - angle) <= radius * (previous?.id === id ? 1.5 : 1)) return { angle: value, id, grid: true };
  }
  return { angle };
}
