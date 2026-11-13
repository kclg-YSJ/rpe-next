import { GUIDE_LINES_KEY, GUIDE_EPSILON, guidePosition, followGuideNote, replaceGuideLine } from '../core/guide-lines.mjs';
import { beatValue } from '../core/beat.mjs';
import { NoteDisplayIndex } from '../core/note-display-index.mjs';
import { t } from '../i18n.mjs';
const noteIndexes = new WeakMap();

// Built only for an active gesture. Preview updates touch followers, not every
// note in the chart; the immutable note arrays are copied once on commit.
export function captureGuideFollowers(chart, guide) {
  const followers = new Map();
  if (!guide || guide.keepSnapped === false) return followers;
  const first = beatValue(guide.startTime), last = beatValue(guide.endTime);
  for (const [lineIndex, line] of (chart.judgeLineList ?? []).entries()) {
    const matches = new Map();
    const notes = line.notes; if (!notes?.length) continue;
    let display = noteIndexes.get(notes); if (!display) { display = new NoteDisplayIndex(notes); noteIndexes.set(notes, display); }
    for (const { item, index } of display.query(first, last)) {
      const x = guidePosition(guide, beatValue(item.startTime));
      if (x !== null && Math.abs(item.positionX - x) <= GUIDE_EPSILON) matches.set(index, item);
    }
    if (matches.size) followers.set(lineIndex, matches);
  }
  return followers;
}

export function previewGuideFollowers(followers, before, after) {
  const changes = new Map();
  for (const [line, notes] of followers) {
    const replacements = new Map();
    for (const [index, note] of notes) { const next = followGuideNote(note, before, after); if (next !== note) replacements.set(index, next); }
    if (replacements.size) changes.set(line, replacements);
  }
  return changes;
}

export function editGuideLineChart(chart, id, next, followers) {
  const before = chart[GUIDE_LINES_KEY]?.find(guide => guide.id === id);
  let result = replaceGuideLine(chart, id, next);
  if (!before || !next || before.keepSnapped === false) return result;
  const changes = previewGuideFollowers(followers ?? captureGuideFollowers(chart, before), before, next);
  if (changes.size) result = { ...result, judgeLineList: chart.judgeLineList.map((line, index) => {
    const notes = changes.get(index); return notes ? { ...line, notes: line.notes.map((note, i) => notes.get(i) ?? note) } : line;
  }) };
  return result;
}

export function commitGuideLine(session, id, next, followers) {
  const label = t(next ? session.chart[GUIDE_LINES_KEY]?.some(guide => guide.id === id) ? 'guide-lines.edit' : 'guide-lines.add' : 'guide-lines.remove');
  if (session.largeDocument) return session.largeDocument.editGuideLine(label, id, next);
  const chart = editGuideLineChart(session.chart, id, next, followers);
  if (JSON.stringify(chart[GUIDE_LINES_KEY]) === JSON.stringify(session.chart[GUIDE_LINES_KEY])) return false;
  session.commit(label, chart); return true;
}
