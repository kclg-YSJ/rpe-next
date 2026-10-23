import { gameUiLayout, gameUiBindings, scoreAt } from '../core/game-ui.mjs';
import { chartDisplayName } from '../core/labels.mjs';

export function drawGameUi(context, chart, states, completionTimes, seconds, selectedLine, viewport, viewScale, skin, duration) {
  const { combo, score } = scoreAt(completionTimes, seconds);
  const progress = Math.max(0, Math.min(1, (seconds + (chart.META.offset ?? 0) / 1000) / Math.max(0.001, duration)));
  const bindings = gameUiBindings(chart, states);
  const name = chartDisplayName(chart.META.name);
  const texts = { combonumber: String(combo), combo: 'combo', score: String(score).padStart(7, '0'), name, level: chart.META.level ?? '' };
  const baseScale = viewScale;
  const logicalWidth = viewport.width / viewport.scale;
  const logicalHeight = viewport.height / viewport.scale;
  for (const item of gameUiLayout(logicalWidth, logicalHeight)) {
    const binding = bindings.get(item.key);
    const alpha = binding ? Math.max(0, Math.min(1, binding.alpha / 255)) : ['combo', 'combonumber'].includes(item.key) && combo < 3 ? 0 : 1;
    if (alpha === 0) continue;
    const color = binding ? chart.judgeLineList[selectedLine]?.attachUI === item.key ? [0, 200, 0] : binding.color : item.key === 'bar' ? [125, 125, 125] : [255, 255, 255];
    context.save();
    context.translate(viewport.left + viewport.width / 2 + item.x * baseScale + (binding?.x ?? 0) * viewScale,
      viewport.top + viewport.height / 2 - item.y * baseScale - (binding?.y ?? 0) * viewScale);
    context.rotate((binding?.rotation ?? 0) * Math.PI / 180);
    context.scale(binding?.scaleX ?? 1, binding?.scaleY ?? 1);
    context.globalAlpha = alpha; context.fillStyle = `rgb(${color.join(',')})`;
    if (item.key === 'pause') {
      const picture = skin?.tinted('Pause', color);
      if (picture) context.drawImage(picture, 0, 0, item.width * baseScale, item.height * baseScale);
    } else if (item.key === 'bar') {
      context.fillRect(0, -item.height * baseScale / 2, viewport.width / viewport.scale * baseScale * progress, item.height * baseScale);
    } else {
      context.font = `${item.fontSize * baseScale}px RPEGame, sans-serif`;
      context.textAlign = item.anchorX === 1 ? 'right' : item.anchorX === 0 ? 'left' : 'center';
      context.textBaseline = item.anchorY === 1 ? 'top' : item.anchorY === 0 ? 'bottom' : 'middle';
      context.fillText(texts[item.key], 0, 0);
    }
    context.restore();
  }
}
