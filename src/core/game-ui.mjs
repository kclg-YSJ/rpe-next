import { t } from '../i18n.mjs';
export const UI_BINDINGS = [
  ['pause', t('game-ui.s130448b')], ['combonumber', t('game-ui.s3c215d3')], ['combo', t('game-ui.s4d9dba2')], ['score', t('game-ui.sda335e2')],
  ['bar', t('game-ui.s6eb113e')], ['name', t('game-ui.scaeac8b')], ['level', t('game-ui.s205aff9')],
];

const layout = {
  pause: { x: 0.021, y: 0.838, anchorX: 0, anchorY: 1, width: 42, height: 42, edgeX: -1, edgeY: 1 },
  combonumber: { x: 0.3516, y: 0.825, anchorX: 0.5, anchorY: 0.5, fontSize: 67, edgeX: 0, edgeY: 1 },
  combo: { x: 0.3516, y: 0.7833, anchorX: 0.5, anchorY: 0.5, fontSize: 35, edgeX: 0, edgeY: 1 },
  score: { x: 0.6855, y: 0.8458, anchorX: 1, anchorY: 1, fontSize: 49, edgeX: 1, edgeY: 1 },
  bar: { x: 0, y: 0.863, anchorX: 0, anchorY: 0.5, height: 8, edgeX: -1, edgeY: 1 },
  name: { x: 0.02, y: 0.05417, anchorX: 0, anchorY: 0, fontSize: 35, edgeX: -1, edgeY: -1 },
  level: { x: 0.6855, y: 0.05417, anchorX: 1, anchorY: 0, fontSize: 33, edgeX: 1, edgeY: -1 },
};

export function gameUiLayout(logicalWidth, logicalHeight) {
  return Object.entries(layout).map(([key, item]) => ({ ...item, key,
    x: item.x * 1920 - 675 + item.edgeX * (logicalWidth - 1350) / 2,
    y: item.y * 1080 - 486 + item.edgeY * (logicalHeight - 900) / 2,
  }));
}

export function gameUiBindings(chart, states) {
  const result = new Map();
  for (const [index, line] of (chart.judgeLineList ?? []).entries()) {
    if (UI_BINDINGS.some(([key]) => key === line.attachUI)) result.set(line.attachUI, { ...states[index], lineIndex: index });
  }
  return result;
}

export function scoreAt(completionTimes, seconds) {
  let low = 0; let high = completionTimes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (completionTimes[middle] < seconds) low = middle + 1; else high = middle;
  }
  return { combo: low, score: completionTimes.length ? Math.round(1000000 * low / completionTimes.length) : 0 };
}

export function renderPasses(lines, order) {
  return [...order.map(index => ({ kind: 'line', index, depth: lines[index].zOrder ?? 0 })),
    { kind: 'hold', depth: 999 }, { kind: 'note', depth: 1000 }].sort((left, right) => left.depth - right.depth);
}
