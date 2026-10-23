import { compileExpression } from './batch-script.mjs';
import { easing } from './easing.mjs';
import { t } from '../i18n.mjs';

export const TRAJECTORY_VERSION = 210;
export const TRAJECTORY_DEFAULTS = Object.freeze({ mode: 'parametric', xExpression: '200*cos(2*pi*t)', yExpression: '200*sin(2*pi*t)', radiusExpression: '200', rotationExpression: '', tangentRotation: false, parameterStart: '0', parameterEnd: '1', angleStart: '0', angleEnd: '2*pi', trimStart: 0, trimEnd: 1, rotation: 0, scaleX: 1, scaleY: 1, alignStart: false, startX: 0, startY: 0, easingX: 1, easingY: 1, seed: 1, randomness: 0, parameters: {} });
export const trajectoryHasRotation = options => Boolean(options.tangentRotation || options.rotationExpression?.trim());
const radiusParameter = { key: 'radius', label: t('curve-trajectory.sb29ee13'), value: 200, min: 1, max: 2000, step: 1 };
const parameter = (key, label, value, min = 1, max = 1000, step = 1) => ({ key, label, value, min, max, step });
const polygon = sides => ({ mode: 'polar', radiusExpression: `radius*cos(pi/${sides})/cos(theta-round(theta/(2*pi/${sides}))*(2*pi/${sides}))` });
export const CURVE_PRESETS = [
  { id: 'line', category: t('curve-trajectory.s3bfba45'), name: t('curve-trajectory.s1082f4e'), xExpression: 'length*t', yExpression: '0', parameters: [parameter('length', t('curve-trajectory.sa539498'), 400)] },
  { id: 'circle', category: t('curve-trajectory.s3bfba45'), name: t('curve-trajectory.se006237'), mode: 'polar', radiusExpression: 'radius', parameters: [radiusParameter] },
  ...[[3, t('curve-trajectory.s0a876c1')], [4, t('curve-trajectory.sdfed728')], [5, t('curve-trajectory.s564fc19')], [6, t('curve-trajectory.sac60b7f')], [8, t('curve-trajectory.s1266627')], [12, t('curve-trajectory.s8c35c41')]].map(([sides, name]) => ({ id: `polygon-${sides}`, category: t('curve-trajectory.s3bfba45'), name, ...polygon(sides), parameters: [radiusParameter] })),
  { id: 'arc', category: t('curve-trajectory.s3bfba45'), name: t('curve-trajectory.sdd7169e'), mode: 'polar', radiusExpression: 'radius', angleEnd: 'sweep*pi/180', parameters: [radiusParameter, parameter('sweep', t('curve-trajectory.sf488250'), 180, -720, 720)] },
  { id: 'rectangle', category: t('curve-trajectory.s3bfba45'), name: t('curve-trajectory.sb5d5ad3'), mode: 'polar', radiusExpression: 'min(width/max(abs(cos(theta)),0.000001),height/max(abs(sin(theta)),0.000001))', parameters: [parameter('width', t('curve-trajectory.s07bbeda'), 250), parameter('height', t('curve-trajectory.s1d2c05e'), 150)] },
  { id: 'diamond', category: t('curve-trajectory.s3bfba45'), name: t('curve-trajectory.sce8122f'), mode: 'polar', radiusExpression: '1/(abs(cos(theta))/width+abs(sin(theta))/height)', parameters: [parameter('width', t('curve-trajectory.s561a432'), 260), parameter('height', t('curve-trajectory.s4616e80'), 160)] },
  { id: 'star', category: t('curve-trajectory.s3bfba45'), name: t('curve-trajectory.s4ea7857'), shape: 'star', parameters: [radiusParameter, parameter('points', t('curve-trajectory.s5dd141d'), 5, 3, 20), parameter('inner', t('curve-trajectory.s035b2eb'), 0.4, 0.05, 1, 0.01)] },
  { id: 'ellipse', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s229298d'), xExpression: 'width*cos(2*pi*t)', yExpression: 'height*sin(2*pi*t)', parameters: [parameter('width', t('curve-trajectory.s561a432'), 280), parameter('height', t('curve-trajectory.s4616e80'), 140)] },
  { id: 'heart', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sd32afa0'), xExpression: 'radius*sin(2*pi*t)^3', yExpression: 'radius*(13*cos(2*pi*t)-5*cos(4*pi*t)-2*cos(6*pi*t)-cos(8*pi*t))/16', parameters: [radiusParameter] },
  { id: 'spiral', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sdf64101'), mode: 'polar', radiusExpression: 'radius*t', angleEnd: '2*pi*turns', parameters: [radiusParameter, parameter('turns', t('curve-trajectory.sdc87b8c'), 3, 0.1, 20, 0.1)] },
  { id: 'rose', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s9aa4c15'), mode: 'polar', radiusExpression: 'radius*cos(petals*theta)', parameters: [radiusParameter, parameter('petals', t('curve-trajectory.sa804976'), 5, 1, 20)] },
  { id: 'infinity', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sa7e7085'), xExpression: 'radius*cos(2*pi*t)', yExpression: 'radius*sin(4*pi*t)/2', parameters: [radiusParameter] },
  { id: 'lissajous', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sb848592'), xExpression: 'radius*sin(a*2*pi*t)', yExpression: 'radius*sin(b*2*pi*t+phase)', parameters: [radiusParameter, parameter('a', t('curve-trajectory.sb85e519'), 3, 1, 20), parameter('b', t('curve-trajectory.sc3e2201'), 2, 1, 20), parameter('phase', t('curve-trajectory.s781e2de'), 0, -6.3, 6.3, 0.1)] },
  { id: 'parabola', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sf3c36ad'), xExpression: 'width*(2*t-1)', yExpression: 'height*(2*t-1)^2', parameters: [parameter('width', t('curve-trajectory.s07bbeda'), 250), parameter('height', t('curve-trajectory.seea51aa'), 200)] },
  { id: 'sine', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s01260a6'), xExpression: 'length*(t-0.5)', yExpression: 'amplitude*sin(2*pi*waves*t+phase)', parameters: [parameter('length', t('curve-trajectory.sa539498'), 600), parameter('amplitude', t('curve-trajectory.sd76e84e'), 100), parameter('waves', t('curve-trajectory.sed07397'), 2, 0.1, 20, 0.1), parameter('phase', t('curve-trajectory.s90dda8c'), 0, -6.3, 6.3, 0.1)] },
  { id: 'damped-wave', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s7af5002'), xExpression: 'length*(t-0.5)', yExpression: 'amplitude*(1-t)^decay*sin(2*pi*waves*t)', parameters: [parameter('length', t('curve-trajectory.sa539498'), 600), parameter('amplitude', t('curve-trajectory.sd76e84e'), 180), parameter('waves', t('curve-trajectory.sed07397'), 4, 1, 20), parameter('decay', t('curve-trajectory.s2e6fb07'), 2, 0.1, 8, 0.1)] },
  { id: 'cycloid', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s6c0456a'), xExpression: 'radius*(2*pi*t-sin(2*pi*t)-pi)', yExpression: 'radius*(1-cos(2*pi*t))', parameters: [parameter('radius', t('curve-trajectory.se234fcc'), 90)] },
  { id: 'astroid', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sfa3a0ca'), xExpression: 'radius*cos(2*pi*t)^3', yExpression: 'radius*sin(2*pi*t)^3', parameters: [radiusParameter] },
  { id: 'cardioid', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.se11731d'), mode: 'polar', radiusExpression: 'radius*(1-cos(theta))', parameters: [parameter('radius', t('curve-trajectory.s7ffb03e'), 130)] },
  { id: 'limacon', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sd0bce98'), mode: 'polar', radiusExpression: 'radius*(ratio+cos(theta))', parameters: [parameter('radius', t('curve-trajectory.s7ffb03e'), 150), parameter('ratio', t('curve-trajectory.sd7ff195'), 0.5, 0.1, 3, 0.1)] },
  { id: 'log-spiral', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s9db4592'), mode: 'polar', radiusExpression: 'radius*growth^t', angleEnd: '2*pi*turns', parameters: [parameter('radius', t('curve-trajectory.sd2392f6'), 30), parameter('growth', t('curve-trajectory.sec18f7c'), 8, 0.1, 30, 0.1), parameter('turns', t('curve-trajectory.sdc87b8c'), 2, 0.1, 20, 0.1)] },
  { id: 'hypotrochoid', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s10c1e15'), xExpression: '(outer-inner)*cos(2*pi*turns*t)+pen*cos((outer-inner)/inner*2*pi*turns*t)', yExpression: '(outer-inner)*sin(2*pi*turns*t)-pen*sin((outer-inner)/inner*2*pi*turns*t)', parameters: [parameter('outer', t('curve-trajectory.sa8d2126'), 240), parameter('inner', t('curve-trajectory.sd7e0b98'), 90), parameter('pen', t('curve-trajectory.s80695e5'), 120), parameter('turns', t('curve-trajectory.sdc87b8c'), 3, 1, 20)] },
  { id: 'epitrochoid', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.sb9dd744'), xExpression: '(outer+inner)*cos(2*pi*turns*t)-pen*cos((outer+inner)/inner*2*pi*turns*t)', yExpression: '(outer+inner)*sin(2*pi*turns*t)-pen*sin((outer+inner)/inner*2*pi*turns*t)', parameters: [parameter('outer', t('curve-trajectory.s88267eb'), 120), parameter('inner', t('curve-trajectory.sd7e0b98'), 40), parameter('pen', t('curve-trajectory.s80695e5'), 70), parameter('turns', t('curve-trajectory.sdc87b8c'), 1, 1, 20)] },
  { id: 'superellipse', category: t('curve-trajectory.sf505d38'), name: t('curve-trajectory.s6a069b6'), mode: 'polar', radiusExpression: '1/((abs(cos(theta))/width)^power+(abs(sin(theta))/height)^power)^(1/power)', parameters: [parameter('width', t('curve-trajectory.s07bbeda'), 240), parameter('height', t('curve-trajectory.s1d2c05e'), 150), parameter('power', t('curve-trajectory.s6cd7e54'), 4, 0.5, 12, 0.1)] },
  { id: 'random-wave', category: t('curve-trajectory.s1a26edf'), name: t('curve-trajectory.s419b223'), xExpression: 'length*(t-0.5)', yExpression: 'amplitude*(sin(2*pi*waves*t)+randomness*(0.5*sin(13*pi*t+seed)+0.3*cos(23*pi*t+2*seed)))', randomness: 0.5, parameters: [parameter('length', t('curve-trajectory.sa539498'), 600), parameter('amplitude', t('curve-trajectory.sd76e84e'), 100), parameter('waves', t('curve-trajectory.s270aeb1'), 2, 1, 20)] },
  { id: 'random-polygon', category: t('curve-trajectory.s1a26edf'), name: t('curve-trajectory.s30ec055'), shape: 'random-polygon', randomness: 0.5, parameters: [radiusParameter, parameter('points', t('curve-trajectory.sb244821'), 7, 3, 40)] },
  { id: 'random-loop', category: t('curve-trajectory.s1a26edf'), name: t('curve-trajectory.s92935a1'), mode: 'polar', radiusExpression: 'radius*(1+randomness*(0.5*sin(3*theta+seed)+0.3*cos(5*theta+seed*2)+0.2*sin(7*theta+seed*3)))', randomness: 0.5, parameters: [radiusParameter] },
];

export function normalizeCurveExpression(source) {
  return String(source ?? '').trim().replaceAll('$t$', 't').replaceAll('θ', 'theta').replace(/\bPi\b/g, 'pi').replaceAll('π', 'pi').replaceAll('，', ',').replaceAll('（', '(').replaceAll('）', ')');
}

export function presetOptions(preset) {
  return editableTrajectoryOptions({ ...preset, parameters: Object.fromEntries((preset.parameters ?? []).map(entry => [entry.key, entry.value])) });
}

export function editableTrajectoryOptions(input) {
  const options = { ...TRAJECTORY_DEFAULTS, ...structuredClone(input) };
  if (!options.shape) return options;
  if (!['star', 'random-polygon'].includes(options.shape)) throw new Error(t('curve-trajectory.s836db4d'));
  const star = options.shape === 'star';
  const sides = `(clamp(round(points),3,40)${star ? '*2' : ''})`;
  const amount = `(((t%1+1)%1)*${sides})`;
  const index = `floor(${amount})`;
  const vertex = (step, axis) => {
    const wrapped = `((${step})%${sides})`;
    const noise = `(sin(${wrapped}*127.1+seed*311.7)*43758.5453)`;
    const radius = star ? `radius*(${wrapped}%2?inner:1)` : `radius*(1-randomness*(${noise}-floor(${noise})))`;
    return `${radius}*${axis === 'x' ? 'cos' : 'sin'}(2*pi*${wrapped}/${sides})`;
  };
  for (const axis of ['x', 'y']) options[`${axis}Expression`] = `lerp(${vertex(index, axis)},${vertex(`${index}+1`, axis)},${amount}-${index})`;
  options.parameters = { radius: 200, points: 5, ...(star ? { inner: 0.4 } : {}), ...options.parameters };
  if (options.rotationExpression?.trim()) {
    const polar = options.mode === 'polar';
    const begin = polar ? options.angleStart : options.parameterStart;
    const end = polar ? options.angleEnd : options.parameterEnd;
    const coordinate = `((${begin})+((${end})-(${begin}))*ease(t,${options.easingX}))`;
    options.rotationExpression = normalizeCurveExpression(options.rotationExpression).replace(/\b(t|theta)\b/g, token => polar && token === 't' ? 't' : coordinate);
  }
  options.mode = 'parametric'; options.parameterStart = '0'; options.parameterEnd = '1'; options.easingX = 1; options.easingY = 1;
  delete options.shape;
  return options;
}

export function compileTrajectory(input = {}) {
  const options = { ...TRAJECTORY_DEFAULTS, ...input };
  const parameters = options.parameters ?? {};
  if (Array.isArray(parameters) || typeof parameters !== 'object' || Object.keys(parameters).length > 32) throw new Error(t('curve-trajectory.s36409e4'));
  for (const [key, value] of Object.entries(parameters)) if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key) || !Number.isFinite(value)) throw new Error(t('curve-trajectory.se2207d9'));
  for (const key of ['trimStart', 'trimEnd', 'rotation', 'scaleX', 'scaleY', 'startX', 'startY', 'seed', 'randomness']) if (!Number.isFinite(Number(options[key]))) throw new Error(t('curve-trajectory.s67aaa7f', { p0: key }));
  if (options.trimStart < 0 || options.trimEnd > 1 || options.trimEnd <= options.trimStart) throw new Error(t('curve-trajectory.s0f30bbd'));
  for (const key of ['easingX', 'easingY']) if (!Number.isInteger(Number(options[key])) || options[key] < 1 || options[key] > 29) throw new Error(t('curve-trajectory.s149b25e'));
  const scope = { ...parameters, seed: Number(options.seed), randomness: Number(options.randomness) };
  const expression = source => compileExpression(normalizeCurveExpression(source));
  const begin = expression(options.mode === 'polar' ? options.angleStart : options.parameterStart)(scope);
  const finish = expression(options.mode === 'polar' ? options.angleEnd : options.parameterEnd)(scope);
  const horizontal = options.mode === 'polar' || options.shape ? null : expression(options.xExpression);
  const vertical = options.mode === 'polar' || options.shape ? null : expression(options.yExpression);
  const radial = options.mode === 'polar' ? expression(options.radiusExpression) : null;
  const direction = !options.tangentRotation && options.rotationExpression?.trim() ? expression(options.rotationExpression) : null;
  const random = index => { const value = Math.sin(index * 127.1 + scope.seed * 311.7) * 43758.5453; return value - Math.floor(value); };
  const raw = progress => {
    const unit = Number(options.trimStart) + (Number(options.trimEnd) - Number(options.trimStart)) * progress;
    const coordinate = axis => begin + (finish - begin) * easing(unit, Number(options[axis === 'x' ? 'easingX' : 'easingY']));
    let point;
    if (options.shape) {
      const sides = Math.max(3, Math.min(40, Math.round(parameters.points ?? 5))) * (options.shape === 'star' ? 2 : 1);
      const amount = ((unit % 1) + 1) % 1 * sides; const index = Math.floor(amount); const fraction = amount - index;
      const vertex = step => { const wrapped = step % sides; const radius = (parameters.radius ?? 200) * (options.shape === 'star' ? (wrapped % 2 ? parameters.inner ?? 0.4 : 1) : 1 - scope.randomness * random(wrapped)); const angle = 2 * Math.PI * wrapped / sides; return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }; };
      const first = vertex(index); const second = vertex(index + 1);
      point = { x: first.x + (second.x - first.x) * fraction, y: first.y + (second.y - first.y) * fraction };
    } else if (radial) {
      const theta = coordinate('x'); const radius = radial({ ...scope, theta, t: unit, u: progress });
      point = { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
    } else point = { x: horizontal({ ...scope, t: coordinate('x'), u: progress }), y: vertical({ ...scope, t: coordinate('y'), u: progress }) };
    const angle = Number(options.rotation) * Math.PI / 180;
    const horizontalValue = point.x * Number(options.scaleX); const verticalValue = point.y * Number(options.scaleY);
    return { x: horizontalValue * Math.cos(angle) - verticalValue * Math.sin(angle), y: horizontalValue * Math.sin(angle) + verticalValue * Math.cos(angle), rotation: direction ? direction({ ...scope, t: options.mode === 'polar' ? unit : coordinate('x'), theta: coordinate('x'), u: progress }) : 0 };
  };
  const first = raw(0);
  const tangent = progress => {
    for (const delta of [0.00001, 0.0001, 0.001, 0.01]) {
      const before = raw(Math.max(0, progress - delta)); const after = raw(Math.min(1, progress + delta));
      const horizontal = after.x - before.x; const vertical = after.y - before.y;
      if (Math.hypot(horizontal, vertical) > 1e-9) return -Math.atan2(vertical, horizontal) * 180 / Math.PI;
    }
    return null;
  };
  const angles = [];
  if (options.tangentRotation) {
    for (let index = 0; index <= 1024; index++) {
      const previous = angles.at(-1) ?? 0; const angle = tangent(index / 1024) ?? previous;
      angles.push(index ? angle + 360 * Math.round((previous - angle) / 360) : angle);
    }
  }
  return progress => {
    progress = Math.max(0, Math.min(1, progress));
    const point = raw(progress);
    if (options.tangentRotation) {
      const reference = angles[Math.round(progress * 1024)]; const angle = tangent(progress) ?? reference;
      point.rotation = angle + 360 * Math.round((reference - angle) / 360);
    }
    const result = { x: point.x + (options.alignStart ? Number(options.startX) - first.x : 0), y: point.y + (options.alignStart ? Number(options.startY) - first.y : 0), rotation: point.rotation };
    if (!Object.values(result).every(Number.isFinite)) throw new Error(t('curve-trajectory.s05bd0c5'));
    return result;
  };
}

export function sampleCurveTrajectory(options = {}, count = 257) {
  if (!Number.isFinite(count) || count < 2 || count > 8193) throw new Error(t('curve-trajectory.s8304cf4'));
  const evaluate = compileTrajectory(options); const length = Math.trunc(count);
  return Array.from({ length }, (unused, index) => ({ t: index / (length - 1), ...evaluate(index / (length - 1)) }));
}

export function validateCurvePreset(preset) {
  if (!preset || typeof preset !== 'object' || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 80) throw new Error(t('curve-trajectory.s3497162'));
  const allowed = new Set([...Object.keys(TRAJECTORY_DEFAULTS), 'name', 'category', 'id', 'shape']);
  for (const key of Object.keys(preset)) if (!allowed.has(key)) throw new Error(t('curve-trajectory.s7750756', { p0: key }));
  if (preset.mode !== undefined && !['parametric', 'polar'].includes(preset.mode)) throw new Error(t('curve-trajectory.s769ce17'));
  if (preset.shape !== undefined && !['star', 'random-polygon'].includes(preset.shape)) throw new Error(t('curve-trajectory.s836db4d'));
  for (const [key, fallback] of Object.entries(TRAJECTORY_DEFAULTS)) {
    if (key === 'parameters' || !Object.hasOwn(preset, key)) continue;
    if (typeof preset[key] !== typeof fallback) throw new Error(t('curve-trajectory.s6e3b660', { p0: key, p1: typeof fallback === 'string' ? t('curve-trajectory.s4dc9621') : typeof fallback === 'boolean' ? t('curve-trajectory.s642a2c8') : t('curve-trajectory.s7a4dc82') }));
  }
  const required = preset.shape ? [] : preset.mode === 'polar' ? ['radiusExpression'] : ['xExpression', 'yExpression'];
  for (const key of required) if (typeof preset[key] !== 'string' || !preset[key].trim()) throw new Error(t('curve-trajectory.s6a63bc2', { p0: key }));
  if (!Array.isArray(preset.parameters) || preset.parameters.length > 32) throw new Error(t('curve-trajectory.s4117df4'));
  const keys = new Set();
  for (const entry of preset.parameters) {
    if (!entry || keys.has(entry.key) || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(entry.key) || ['t', 'u', 'theta', 'pi', 'seed', 'randomness'].includes(entry.key) || !Number.isFinite(entry.value)) throw new Error(t('curve-trajectory.s06d9b77'));
    for (const key of Object.keys(entry)) if (!['key', 'label', 'value', 'min', 'max', 'step'].includes(key)) throw new Error(t('curve-trajectory.s83e52c2', { p0: entry.key, p1: key }));
    if (entry.label !== undefined && typeof entry.label !== 'string') throw new Error(t('curve-trajectory.s3e14221', { p0: entry.key }));
    for (const key of ['min', 'max', 'step']) if (entry[key] !== undefined && !Number.isFinite(entry[key])) throw new Error(t('curve-trajectory.s5b51b92', { p0: entry.key, p1: key }));
    if (entry.step <= 0 || entry.min > entry.max || entry.value < entry.min || entry.value > entry.max) throw new Error(t('curve-trajectory.s9f6a2f1', { p0: entry.key }));
    keys.add(entry.key);
  }
  const clean = { name: preset.name.trim(), parameters: structuredClone(preset.parameters), category: t('curve-trajectory.sc493338') };
  for (const key of Object.keys(TRAJECTORY_DEFAULTS)) if (key !== 'parameters' && Object.hasOwn(preset, key)) clean[key] = structuredClone(preset[key]);
  if (['star', 'random-polygon'].includes(preset.shape)) clean.shape = preset.shape;
  sampleCurveTrajectory(presetOptions(clean), 257);
  return clean;
}

const compiledEvents = new WeakMap();
export function trajectoryEventValue(event, progress, axis = event.trajectoryAxis ?? 'x') {
  let evaluate = compiledEvents.get(event);
  if (!evaluate) { evaluate = compileTrajectory(event.trajectory.options); compiledEvents.set(event, evaluate); }
  return evaluate(progress)[axis];
}
