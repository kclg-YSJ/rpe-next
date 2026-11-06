const keys = { ' ': 'Space', Escape: 'Esc', Delete: 'Delete', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: '⌘' };
export function keyDisplayLabel(event) {
  if (event.isComposing || ['Process', 'Dead', 'Unidentified', ''].includes(event.key ?? '')) return null;
  const target = event.target;
  if (target?.closest?.('input[type="password"], [data-recording-private]')) return null;
  const key = keys[event.key] ?? (/^Key[A-Z]$/.test(event.code ?? '') ? event.code.slice(3) : String(event.key).length === 1 ? String(event.key).toUpperCase() : event.key);
  const modifiers = [event.ctrlKey && key !== 'Ctrl' ? 'Ctrl' : '', event.metaKey && key !== '⌘' ? '⌘' : '', event.altKey && key !== 'Alt' ? 'Alt' : '', event.shiftKey && key !== 'Shift' ? 'Shift' : ''].filter(Boolean);
  return [...modifiers, key].filter(Boolean).join(' + ').slice(0, 100);
}
export class KeyDisplayState {
  constructor() { this.keys = []; this.serial = 0; }
  add(label, at) {
    const previous = this.keys.at(-1);
    if (previous?.label === label && at - previous.at < .25) { previous.at = at; previous.count++; }
    else this.keys.push({ label, at, count: 1, id: ++this.serial });
    if (this.keys.length > 12) this.keys.splice(0, this.keys.length - 12);
  }
  shift(seconds) { for (const key of this.keys) key.at += seconds; }
  rows(at) {
    this.keys = this.keys.filter(item => at - item.at < 1.8);
    return this.keys.map((item, index, all) => {
      const age = Math.max(0, at - item.at), rise = age * 66 + (all.length - index - 1) * 44;
      return { ...item, rise, alpha: Math.min(1, Math.max(0, (240 - rise) / 85), Math.max(0, (1.8 - age) / .6)) };
    });
  }
}
