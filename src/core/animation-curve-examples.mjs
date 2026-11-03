// These definitions power both help diagrams and their editable examples.
const n = (x, y, mode, incoming, outgoing) => ({ x, y, mode, ...(incoming ? { in: incoming } : {}), ...(outgoing ? { out: outgoing } : {}) });
export const ANIMATION_CURVE_EXAMPLES = Object.freeze([
  { id: 'ease', nodes: [n(0, 0, 'corner', null, [.42, 0]), n(1, 1, 'corner', [.58, 1])] },
  { id: 'overshoot', nodes: [n(0, 0, 'corner', null, [.2, 0]), n(.7, 1.15, 'smooth', [.45, 1.15], [.8, 1.15]), n(1, 1, 'corner', [.9, 1])] },
  { id: 'anticipation', nodes: [n(0, 0, 'corner', null, [.06, 0]), n(.2, -.18, 'smooth', [.12, -.18], [.34, -.18]), n(1, 1, 'corner', [.7, 1])] },
  { id: 'pause', nodes: [n(0, 0, 'linear'), n(.35, .5, 'hold'), n(.65, .5, 'linear'), n(1, 1, 'linear')] },
  { id: 'bounce', nodes: [n(0, 0, 'corner', null, [.08, .05]), n(.55, 1, 'corner', [.4, .65], [.61, .72]), n(.74, .82, 'smooth', [.66, .82], [.8, .82]), n(.9, 1, 'corner', [.87, .9], [.94, .94]), n(1, 1, 'corner', [.98, .96])] },
  { id: 'steps', nodes: [n(0, 0, 'hold'), n(.25, .33, 'hold'), n(.5, .66, 'hold'), n(.75, 1, 'hold'), n(1, 1, 'hold')] },
]);
export function animationCurveExample(id, name = '') {
  const example = ANIMATION_CURVE_EXAMPLES.find(e => e.id === id);
  if (!example) throw Error('Unknown animation curve example');
  return { version: 1, name, nodes: structuredClone(example.nodes) };
}
