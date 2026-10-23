import { assertChart } from '../core/chart.mjs';
import { fromNumber } from '../core/beat.mjs';
import { createNoiseArea, createNoiseEvent, withNoiseAreas } from '../core/noise-areas.mjs';
import { noiseLayers } from '../core/noise-skin.mjs';
import { orderedNoiseRectangles, noiseAppearanceOffsets } from '../core/noise-fit.mjs';
import { t } from '../i18n.mjs';

export function fittedNoiseAreas(fit, options) {
  const { first, last, duration, width, x, y, rotation = 0, easingType = 1, active = true, activeStart = 0, activeEnd = duration, readyFlash = 0.5, layerId, invert = false, name = '' } = options;
  if (![first, last, duration, width, x, y, rotation, readyFlash].every(Number.isFinite) || last < first || duration <= 0 || width <= 0 || width > 20000 || readyFlash < 0 || readyFlash > 600) throw new Error(t('noise-fit.s04cdacc'));
  if (!Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error(t('noise-fit.s112d35f'));
  if (active && (![activeStart, activeEnd].every(Number.isFinite) || activeStart < 0 || activeEnd <= activeStart || activeEnd > duration)) throw new Error(t('noise-fit.s2a2cd3a'));
  if (!fit?.rectangles?.length || fit.width <= 0 || fit.height <= 0) throw new Error(t('noise-fit.s997d2e1'));
  if (fit.rectangles.length > 20000) throw new Error(t('noise-fit.s1b9de47'));
  const rectangles = orderedNoiseRectangles(fit, options.reveal, options.seed);
  const offsets = noiseAppearanceOffsets(rectangles.length, easingType);
  const scale = width / fit.width; const angle = rotation * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle);
  return rectangles.map((rectangle, index) => {
    const at = first + (last - first) * offsets[index];
    const localX = (rectangle.x + rectangle.width / 2 - fit.width / 2) * scale;
    const localY = (fit.height / 2 - rectangle.y - rectangle.height / 2) * scale;
    const center = { x: x + localX * cosine + localY * sine, y: y - localX * sine + localY * cosine };
    const halfWidth = rectangle.width * scale / 2; const halfHeight = rectangle.height * scale / 2;
    return { ...createNoiseArea(at, at + duration), Name: name ? `${name} ${index + 1}` : '', layerId,
      bottomLeft: { x: center.x - halfWidth, y: center.y - halfHeight }, topRight: { x: center.x + halfWidth, y: center.y + halfHeight },
      isInvert: Boolean(invert), editorPositionX: Math.max(-650, Math.min(650, center.x)),
      activeIntervals: active ? [{ startTime: fromNumber(at + activeStart), endTime: fromNumber(at + activeEnd), readyFlash: Math.round(readyFlash * 1000) / 1000 }] : [],
      rotateEvents: rotation ? [createNoiseEvent(rotation, rotation, at, at + duration, center)] : [] };
  });
}

export function noiseFitChart(chart, areas) {
  const layers = new Set(noiseLayers(chart).map(layer => layer.id));
  if (areas.some(area => !layers.has(area.layerId))) throw new Error(t('noise-fit.s4fe1cc5'));
  const next = withNoiseAreas(chart, [...(chart.blockAreaList ?? []), ...areas]);
  assertChart(next); return next;
}
