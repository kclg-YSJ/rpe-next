import type { Chart, ChartEvent, Note } from './types.ts';

/**
 * Truncates the named fields toward zero, returning the original object when nothing changes.
 *
 * RPE stores alpha as an integer, but documents in the wild carry fractional values (a converted
 * official chart can produce them). Truncating rather than rounding matches the game's cast, and
 * returning the same reference when no field moved keeps the caller's identity checks meaningful.
 */
function integerFields<T extends object>(item: T, fields: (keyof T)[]): T {
  let result = item;
  for (const field of fields) {
    const value = item[field];
    if (Number.isFinite(value) && !Number.isInteger(value)) result = { ...result, [field]: Math.trunc(value as number) };
  }
  return result;
}

export const integerAlphaEvent = (event: ChartEvent): ChartEvent => integerFields(event, ['start', 'end']);
export const integerNoteAlpha = (note: Note): Note => integerFields(note, ['alpha']);

/**
 * Maps `transform` over `items`, copying only when an element actually changes.
 *
 * The copy-on-first-change shape is what lets `integerChartAlpha` below return the original chart
 * when a document is already integral, so a no-op normalisation costs no allocation. The overloads
 * keep a definitely-present array definitely present: `JudgeLine.notes` and `.eventLayers` are both
 * required, so the `undefined` arm is unreachable at those two call sites and would otherwise force a
 * cast on the rebuilt line.
 */
function mapChanged<T>(items: T[], transform: (item: T, index: number) => T): T[];
function mapChanged<T>(items: T[] | undefined, transform: (item: T, index: number) => T): T[] | undefined;
function mapChanged<T>(items: T[] | undefined, transform: (item: T, index: number) => T): T[] | undefined {
  let result = items;
  for (let index = 0; index < (items?.length ?? 0); index++) {
    const next = transform(items![index], index);
    if (next === items![index]) continue;
    if (result === items) result = [...items!];
    result![index] = next;
  }
  return result;
}

/**
 * Truncates every alpha value in a chart, reusing `previous` to skip untouched lines and layers.
 *
 * `previous` is the same chart before an edit: passing it turns this into a structural diff, so only
 * the lines, layers and events that actually changed are rebuilt. Omit it to normalise everything.
 */
export function integerChartAlpha(chart: Chart, previous?: Chart): Chart {
  const lines = mapChanged(chart.judgeLineList, (line, index) => {
    const oldLine = previous?.judgeLineList?.[index];
    if (line === oldLine) return line;
    const notes = line.notes === oldLine?.notes ? line.notes : mapChanged(line.notes, integerNoteAlpha);
    const layers = mapChanged(line.eventLayers, (layer, layerIndex) => {
      if (!layer || layer === oldLine?.eventLayers?.[layerIndex]) return layer;
      const events = layer.alphaEvents === oldLine?.eventLayers?.[layerIndex]?.alphaEvents ? layer.alphaEvents : mapChanged(layer.alphaEvents, integerAlphaEvent);
      return events === layer.alphaEvents ? layer : { ...layer, alphaEvents: events };
    });
    return notes === line.notes && layers === line.eventLayers ? line : { ...line, notes, eventLayers: layers };
  });
  return lines === chart.judgeLineList ? chart : { ...chart, judgeLineList: lines };
}
