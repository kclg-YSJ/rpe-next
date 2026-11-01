import { eventList, eventKey } from './event-commands.mjs';

export function selectionState(session) {
  return { lineIndex: session.lineIndex, eventLayer: session.eventLayer, focus: session.focus,
    selection: [...session.selection].sort((left, right) => left - right), eventSelection: [...session.eventSelection].sort(),
    multiLineSelection: [...(session.multiLineSelection ?? new Map())].map(([line, values]) => [line, [...values].sort((left, right) => left - right)]).sort((left, right) => left[0] - right[0]),
    multiEventSelection: [...(session.multiEventSelection ?? new Map())].map(([line, values]) => [line, [...values].sort()]).sort((left, right) => left[0] - right[0]),
    multiLineEnabled: session.multiLineEnabled, multiLineMode: session.multiLineMode, multiLineMerge: session.multiLineMerge, multiLineExpression: session.multiLineExpression ?? '', multiLineIndices: [...(session.multiLineIndices ?? [])] };
}

export function sameSelection(left, right) {
  return Boolean(right && left.lineIndex === right.lineIndex && left.eventLayer === right.eventLayer && left.focus === right.focus
    && left.multiLineEnabled === right.multiLineEnabled && left.multiLineMode === right.multiLineMode && left.multiLineMerge === right.multiLineMerge
    && (left.multiLineExpression ?? '') === (right.multiLineExpression ?? '')
    && JSON.stringify(left.multiLineIndices ?? []) === JSON.stringify(right.multiLineIndices ?? [])
    && JSON.stringify(left.multiLineSelection ?? []) === JSON.stringify(right.multiLineSelection ?? [])
    && JSON.stringify(left.multiEventSelection ?? []) === JSON.stringify(right.multiEventSelection ?? [])
    && ['selection', 'eventSelection'].every(key => left[key].length === right[key].length && left[key].every((value, index) => value === right[key][index])));
}

function remapIndices(source, target, indices) {
  const locations = new Map(target.map((item, index) => [item, index]));
  const identities = new Map(target.flatMap((item, index) => item?._rpeCollabId ? [[item._rpeCollabId, index]] : []));
  const sourceItems = new Set(source);
  return indices.flatMap(index => {
    if (!source[index]) return [];
    if (source[index]._rpeCollabId) return identities.has(source[index]._rpeCollabId) ? [identities.get(source[index]._rpeCollabId)] : [];
    const mapped = locations.get(source[index]);
    if (mapped !== undefined) return [mapped];
    return source.length === target.length && target[index] && !sourceItems.has(target[index]) ? [index] : [];
  });
}

export function remapSelection(source, target, state) {
  const line = source.judgeLineList?.[state.lineIndex]; const lines = target.judgeLineList ?? [];
  const matching = line ? lines.findIndex(candidate => line._rpeCollabId ? candidate._rpeCollabId === line._rpeCollabId : candidate === line || candidate.notes === line.notes && candidate.eventLayers === line.eventLayers) : -1;
  const lineIndex = matching >= 0 ? matching : Math.max(0, Math.min(state.lineIndex, lines.length - 1));
  const sourceSession = { ...state, chart: source, line };
  const targetSession = { ...state, chart: target, lineIndex, line: lines[lineIndex] };
  const selection = remapIndices(line?.notes ?? [], targetSession.line?.notes ?? [], state.selection);
  const eventSelection = [];
  const byType = new Map();
  for (const key of state.eventSelection) {
    const [type, index] = key.split(':');
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(Number(index));
  }
  for (const [type, indices] of byType) for (const index of remapIndices(eventList(sourceSession, type), eventList(targetSession, type), indices)) eventSelection.push(eventKey(type, index));
  const multiEventSelection = (state.multiEventSelection ?? []).flatMap(([sourceLineIndex, keys]) => {
    const sourceLine = source.judgeLineList?.[sourceLineIndex];
    const targetLineIndex = sourceLine?._rpeCollabId ? lines.findIndex(line => line._rpeCollabId === sourceLine._rpeCollabId) : sourceLineIndex;
    const targetLine = target.judgeLineList?.[targetLineIndex];
    if (!sourceLine || !targetLine) return [];
    const sourceSession = { ...state, chart: source, lineIndex: sourceLineIndex, line: sourceLine };
    const targetSession = { ...state, chart: target, lineIndex: targetLineIndex, line: targetLine };
    const byType = new Map();
    for (const key of keys) { const [type, index] = String(key).split(':'); if (!byType.has(type)) byType.set(type, []); byType.get(type).push(Number(index)); }
    const mapped = [];
    for (const [type, indices] of byType) for (const index of remapIndices(eventList(sourceSession, type), eventList(targetSession, type), indices)) mapped.push(eventKey(type, index));
    return mapped.length ? [[targetLineIndex, mapped]] : [];
  });
  const multiLineSelection = (state.multiLineSelection ?? []).flatMap(([sourceLineIndex, indices]) => {
    const sourceNotes = source.judgeLineList?.[sourceLineIndex]?.notes ?? [];
    const id = source.judgeLineList?.[sourceLineIndex]?._rpeCollabId;
    const targetLineIndex = id ? lines.findIndex(line => line._rpeCollabId === id) : sourceLineIndex;
    const targetNotes = target.judgeLineList?.[targetLineIndex]?.notes ?? [];
    const mapped = remapIndices(sourceNotes, targetNotes, indices);
    return mapped.length ? [[targetLineIndex, mapped]] : [];
  });
  const multiLineIndices = (state.multiLineIndices ?? []).flatMap(index => {
    const identity = source.judgeLineList?.[index]?._rpeCollabId;
    if (!identity) return [index];
    const mapped = lines.findIndex(line => line._rpeCollabId === identity);
    return mapped < 0 ? [] : [mapped];
  });
  return { ...state, lineIndex, selection, eventSelection, multiLineSelection, multiEventSelection, multiLineIndices };
}

export function restoreSelection(session, state) {
  session.lineIndex = Math.max(0, Math.min(state.lineIndex, (session.chart.judgeLineList?.length ?? 0) - 1));
  session.eventLayer = state.eventLayer; session.focus = state.focus;
  session.selection = new Set(state.selection.filter(index => session.notes[index]));
  session.multiLineSelection = new Map((state.multiLineSelection ?? []).map(([lineIndex, indices]) => [lineIndex, new Set(indices.filter(index => session.chart.judgeLineList?.[lineIndex]?.notes?.[index]))]).filter(([, values]) => values.size));
  session.eventSelection = new Set(state.eventSelection.filter(key => {
    const [type, index] = key.split(':'); return eventList(session, type)[Number(index)];
  }));
  session.multiEventSelection = new Map((state.multiEventSelection ?? []).map(([lineIndex, keys]) => [lineIndex, new Set(keys.filter(key => {
    const [type, index] = String(key).split(':'); const line = session.chart.judgeLineList?.[lineIndex];
    return line && eventList({ ...session, chart: session.chart, lineIndex, line }, type)[Number(index)];
  }))]).filter(([, keys]) => keys.size));
  session.multiLineEnabled = state.multiLineEnabled ?? false;
  session.multiLineMode = state.multiLineMode === 'events' ? 'events' : 'notes';
  session.multiLineMerge = state.multiLineMerge ?? true;
  session.multiLineIndices = [...(state.multiLineIndices ?? [])];
  session.multiLineExpression = state.multiLineExpression ?? '';
  if (session.multiLineExpression) session.multiLineResolvedIndices = session.multiLineIndices;
  session.normalizeMultiLine();
}
