import type { Beat, Note, NoteType } from './types.ts';
import { beatValue, fromNumber } from './beat.ts';
import { createNote } from './chart.ts';
import { easing } from './easing.ts';

/** Every parameter the curve dialog and the panel feed in; only the two beats and the two X values are required. */
export interface CurveNoteOptions {
  startTime: Beat;
  endTime: Beat;
  startX: number;
  endX: number;
  /** Note kind to emit: Tap, Flick or Drag, never Hold. */
  type?: NoteType;
  /** Horizontal divisions per beat. */
  division?: number;
  /** Notes per division. */
  density?: number;
  easingType?: number;
}

export function generateCurveNotes({ startTime, endTime, startX, endX, type = 4, division = 4, density = 1, easingType = 1 }: CurveNoteOptions): Note[] {
  const start = beatValue(startTime); const end = beatValue(endTime);
  if (start < 0 || end < start) throw new Error('曲线结束拍不能早于起始拍，起始拍不能为负');
  if (![startX, endX, density, division].every(Number.isFinite) || density <= 0 || density > 1000 || division < 1 || division > 100) throw new Error('坐标须为有限数值；密度须大于 0 且不超过 1000，横线分格为 1–100');
  if (![1, 3, 4].includes(type) || !Number.isInteger(easingType) || easingType < 1 || easingType > 29) throw new Error('请选择 Tap/Drag/Flick 及有效缓动');
  const denominator = Math.max(1, Math.trunc(division * density));
  const count = start === end ? Math.ceil(density) : Math.max(0, Math.ceil((end - start) * denominator - 1e-9) - 1);
  if (count > 20000) throw new Error(`本次将生成 ${count} 个音符，超过 20000 个限制；请缩短区间或降低密度`);
  return Array.from({ length: count }, (unused, index) => {
    const amount = start === end ? (index + 1) / (density + 1) : (index + 1) / denominator / (end - start);
    const position = startX + (endX - startX) * (start === end ? amount : easing(amount, easingType));
    // Annotated because the spread of a tuple would otherwise be inferred as number[], which is not a Beat.
    const beat: Beat = start === end ? [...startTime] : fromNumber(start + (index + 1) / denominator, denominator * startTime[2]);
    const note: Note = { ...createNote(type, 0, position), startTime: beat, endTime: [...beat] };
    return note;
  });
}
