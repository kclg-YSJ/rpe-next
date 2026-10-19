export function appendLineShortcutDigit(current: number, lineCount: number, digit: number): number {
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(lineCount) || lineCount < 1 || !Number.isInteger(digit) || digit < 0 || digit > 9) return current;
  const candidate = current * 10 + digit;
  if (candidate < lineCount) return candidate;
  return digit < lineCount ? digit : current;
}
