import { gameUiLayout, gameUiBindings, scoreAt } from '../core/game-ui.ts';
import type { RpeSkin } from './skin.ts';
import type { Color, Chart } from '../core/types.ts';
import type { LineState } from '../core/scene.ts';
import type { PreviewViewport } from '../core/editor-display.ts';

/**
 * One entry of {@link gameUiLayout}.
 *
 * The layout table in `core/game-ui.ts` mixes three property sets: the text entries (and the pause
 * button) carry a `fontSize`, the pause button additionally carries `width`/`height`, and the
 * progress bar carries only a `height`. `key` discriminates them, so the branches that already test
 * `item.key` also narrow the members they read. Pushing these property sets upstream would mean
 * editing the layout table and its other callers, and they stay per-key invariants that the layout
 * builder itself does not enforce.
 */
interface GameUiTextItem {
  key: 'combo' | 'combonumber' | 'score' | 'name' | 'level';
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  edgeX: number;
  edgeY: number;
  fontSize: number;
}

interface GameUiPauseItem {
  key: 'pause';
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  edgeX: number;
  edgeY: number;
  fontSize: number;
  width: number;
  height: number;
}

interface GameUiBarItem {
  key: 'bar';
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  edgeX: number;
  edgeY: number;
  height: number;
}

type GameUiItem = GameUiTextItem | GameUiPauseItem | GameUiBarItem;

export function drawGameUi(context: CanvasRenderingContext2D, chart: Chart, states: (LineState | undefined)[], completionTimes: readonly number[], seconds: number, selectedLine: number, viewport: PreviewViewport, viewScale: number, skin: RpeSkin | null, duration: number): void {
  const { combo, score } = scoreAt(completionTimes, seconds);
  const progress = Math.max(0, Math.min(1, (seconds + (chart.META.offset ?? 0) / 1000) / Math.max(0.001, duration)));
  const bindings = gameUiBindings(chart, states);
  const texts: Record<string, string> = { combonumber: String(combo), combo: 'combo', score: String(score).padStart(7, '0'), name: chart.META.name ?? '', level: chart.META.level ?? '' };
  const baseScale = viewScale;
  const logicalWidth = viewport.width / viewport.scale;
  const logicalHeight = viewport.height / viewport.scale;
  for (const item of gameUiLayout(logicalWidth, logicalHeight) as GameUiItem[]) {
    const binding = bindings.get(item.key);
    const alpha = binding ? Math.max(0, Math.min(1, binding.alpha / 255)) : ['combo', 'combonumber'].includes(item.key) && combo < 3 ? 0 : 1;
    if (alpha === 0) continue;
    const color: Color = binding ? chart.judgeLineList[selectedLine]?.attachUI === item.key ? [0, 200, 0] : binding.color : item.key === 'bar' ? [125, 125, 125] : [255, 255, 255];
    context.save();
    context.translate(viewport.left + viewport.width / 2 + item.x * baseScale + (binding?.x ?? 0) * viewScale,
      viewport.top + viewport.height / 2 - item.y * baseScale - (binding?.y ?? 0) * viewScale);
    context.rotate((binding?.rotation ?? 0) * Math.PI / 180);
    context.scale(binding?.scaleX ?? 1, binding?.scaleY ?? 1);
    context.globalAlpha = alpha; context.fillStyle = `rgb(${color.join(',')})`;
    if (item.key === 'pause') {
      const picture = skin?.tinted('Pause', color);
      // Same boundary as `skin.ts`'s own `drawImage` call: the record is a decoded `<img>` or the
      // offscreen canvas `tinted` painted, and only the drawing surface consumes it.
      if (picture) context.drawImage(picture as unknown as CanvasImageSource, 0, 0, item.width * baseScale, item.height * baseScale);
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
