import { agentSchema, agentText, agentNumber, agentIndex, checkAgentSignal } from '../core/agent-commands.mjs';
import { agentBeat } from '../core/agent-chart.mjs';
import { fromNumber, beatValue } from '../core/beat.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { CURVE_PRESETS, TRAJECTORY_DEFAULTS, presetOptions, editableTrajectoryOptions } from '../core/curve-trajectory.mjs';
import { generateCurveNotes } from '../core/curve-notes.mjs';
import { trackedNoiseArea, noiseTrackingChart } from '../core/noise-tracking.mjs';
import { trackedNoteEvents, noteTrackingChart } from './note-tracking.mjs';
import { NOISE_REVEALS } from '../core/noise-fit.mjs';
import { noiseLayers } from '../core/noise-skin.mjs';
import { validateColumnEvent } from '../core/global-events.mjs';
import { createTrajectoryEvent, trajectoryChart, splitTrajectoryChart } from './trajectory-commands.mjs';
import { fittedNoiseAreas, noiseFitChart } from './noise-fit.mjs';
import { textLinesChart } from './text-lines.mjs';
import { parseLineExpression } from './multi-line-edit.mjs';
import { groupNames } from '../core/line-groups.mjs';
import { rasterizeNoisePattern, rasterizeTextLines, runPatternFit } from '../platform/pattern-raster.mjs';
import { t } from '../i18n.mjs';

const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const choice = values => ({ enum: values });
const boolean = { type: 'boolean' };
const beat = { description: t('agent-chart-tools.s18a6328') };
const layerNumber = { ...integer(0, 3), description: t('agent-chart-tools.sa55436c') };
const time = value => Array.isArray(value) ? [...value] : fromNumber(agentBeat(value));
const splitSchema = agentSchema({ segments: integer(4, 8192), simplify: boolean, tolerance: number(.001, 10000) });
const trajectoryOptions = agentSchema(Object.fromEntries(Object.entries(TRAJECTORY_DEFAULTS).map(([key, value]) => [key, typeof value === 'boolean' ? boolean : typeof value === 'number' ? agentNumber : typeof value === 'string' ? agentText : { type: 'object' }])));
const checkLineTokens = (input, chart) => {
  const count = chart.judgeLineList.length;
  const groups = new Set(groupNames(chart));
  for (const token of input.trim().split(/\s+/)) if (!groups.has(token) && /^[+-]?\d+(?::[+-]?\d+)?$/.test(token) && token.split(':').some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) >= count)) throw Error(t('agent-chart-tools.s9519714'));
};
const lineIndices = (input, chart) => {
  const count = chart.judgeLineList.length;
  if (typeof input === 'string') checkLineTokens(input, chart);
  else if (!Array.isArray(input)) throw Error(t('agent-chart-tools.s1d6a371'));
  const indices = Array.isArray(input) ? [...input] : parseLineExpression(input, count, chart);
  if (indices.some(index => !Number.isInteger(index) || !chart.judgeLineList[index]) || new Set(indices).size !== indices.length) throw Error(t('agent-chart-tools.saad7470'));
  return indices;
};

export const AGENT_CHART_TOOLS = Object.freeze([
  { id: 'metadata', name: t('agent-chart-tools.sd352b59'), commands: ['chart_read', 'chart_patch', 'assets_list', 'asset_read', 'asset_write'] },
  { id: 'bpm', name: t('agent-chart-tools.sb08507c'), commands: ['bpm_set', 'audio_prepend_silence'] },
  { id: 'assets', name: t('agent-chart-tools.s885200a'), commands: ['assets_list', 'asset_read', 'asset_write', 'ui_inspect', 'ui_action'] },
  { id: 'audio-analysis-tool', name: t('agent-chart-tools.sad869af'), commands: ['audio_sources', 'audio_separate', 'audio_source', 'audio_detector', 'audio_analyze', 'audio_taps', 'audio_view'] },
  { id: 'noise-areas-tool', name: t('agent-chart-tools.s0f8a536'), commands: ['chart_templates', 'chart_patch', 'chart_generate', 'chart_transform', 'noise_circle'] },
  { id: 'curve-notes', name: t('agent-chart-tools.sae195fe'), commands: ['curve_notes'] },
  { id: 'curve-trajectory', name: t('agent-chart-tools.sf8e5bf7'), commands: ['trajectory_presets', 'trajectory_generate', 'trajectory_split'] },
  { id: 'spatial-tool', name: t('spatial.title'), commands: ['ui_inspect', 'ui_action', 'chart_query', 'chart_patch'] },
  { id: 'text-lines-tool', name: t('agent-chart-tools.s23acb5a'), commands: ['text_fit'] },
  { id: 'noise-fit-tool', name: t('agent-chart-tools.s9835372'), commands: ['noise_fit'] },
  { id: 'noise-tracking-tool', name: t('agent-chart-tools.sd5825e9'), commands: ['noise_track'] },
  { id: 'note-tracking-tool', name: t('note-track.title'), commands: ['note_track'] },
  { id: 'multi-line-tool', name: t('agent-chart-tools.s5255093'), commands: ['multi_line', 'chart_query', 'chart_transform'] },
  { id: 'global-events-tool', name: t('agent-chart-tools.s895a20e'), commands: ['global_events'] },
  { id: 'diagnose', name: t('agent-chart-tools.s000a07b'), commands: ['diagnose'] },
  { id: 'history-panel', name: t('agent-chart-tools.s05a196d'), commands: ['history'] },
  { id: 'version-control-tool', name: t('agent-chart-tools.s8414f7a'), commands: ['version_control', 'ui_inspect', 'ui_action'] },
]);

export function registerAgentChartTools(commands, editor, { current, check, prepareChart, fit = runPatternFit, textRaster = rasterizeTextLines, noiseRaster = rasterizeNoisePattern }) {
  const register = (name, description, parameters, access, prepare) => commands.register({ name, description, parameters, access, prepare });
  const presets = () => [...CURVE_PRESETS, ...(editor.trajectoryPanel?.custom ?? [])];
  register('note_track', t('note-track.help'), agentSchema({ revision: agentText, start: beat, end: beat, target: agentSchema({ lineIndex: agentIndex, noteIndex: agentIndex }, ['lineIndex', 'noteIndex']), line: integer(-1, 100000), layer: layerNumber, rotation: boolean, sampleRate: choice([60, 120, 240]), replace: boolean }, ['revision', 'start', 'end', 'target']), 'edit', args => {
    const chart = check(args), tempo = new TempoMap(chart.BPMList), generated = trackedNoteEvents(chart, tempo, { ...args, start: time(args.start), end: time(args.end), lineIndex: args.line ?? editor.session.lineIndex, layer: args.layer ?? editor.timeline?.layer ?? editor.session.eventLayer ?? 0, lineDefaults: editor.session.lineEventDefaults });
    const next = noteTrackingChart(chart, generated, args.replace === true, tempo);
    return prepareChart(args, chart, next, t('note-track.title'), { line: generated.lineIndex, layer: generated.layer, events: [...generated.tracks.values()].reduce((sum, entries) => sum + entries.length, 0) }, args.replace === true);
  });
  register('chart_tools', t('agent-chart-tools.sf3fa163'), agentSchema(), 'read', () => ({ apply: () => AGENT_CHART_TOOLS.map(tool => ({ ...tool, commands: tool.commands.filter(name => commands.entries.has(name)) })) }));
  register('trajectory_presets', t('agent-chart-tools.sd9df6ae'), agentSchema({ query: agentText }), 'read', args => ({ apply: () => presets().filter(entry => !args.query || [entry.name, entry.id, entry.category].some(value => value?.toLowerCase().includes(args.query.toLowerCase()))).map(entry => ({ ...entry, options: presetOptions(entry) })) }));
  register('trajectory_generate', t('agent-chart-tools.sc5d76a3'), agentSchema({ revision: agentText, line: agentIndex, layer: layerNumber, start: beat, end: beat, preset: agentText, options: trajectoryOptions, segments: integer(4, 8192), split: splitSchema, output: choice(['trajectory', 'events']), eventIndex: agentIndex, replace: boolean }, ['revision', 'line', 'start', 'end']), 'edit', args => {
    const chart = check(args), layer = args.layer ?? 0, entries = chart.judgeLineList[args.line]?.eventLayers?.[layer]?.moveXEvents ?? [], editing = args.eventIndex === undefined ? null : entries[args.eventIndex];
    if (args.eventIndex !== undefined && !editing?.trajectory) throw Error(t('agent-chart-tools.s8d0aeb1'));
    let base = editing?.trajectory?.options ?? TRAJECTORY_DEFAULTS;
    if (args.preset) { const matches = presets().filter(entry => entry.id === args.preset || entry.name === args.preset); if (matches.length !== 1) throw Error(t('agent-chart-tools.s577626f')); base = presetOptions(matches[0]); }
    const options = editableTrajectoryOptions({ ...base, ...args.options, parameters: { ...base.parameters, ...args.options?.parameters } });
    const event = createTrajectoryEvent(options, time(args.start), time(args.end), args.segments ?? editing?.trajectory.segments ?? 128, args.split ?? editing?.trajectory.split);
    let next = trajectoryChart(chart, args.line, layer, event, editing, args.replace === true);
    if (args.output === 'events') next = splitTrajectoryChart(next, args.line, layer, event, args.split);
    return prepareChart(args, chart, next, t('agent-chart-tools.sf8e5bf7'), { line: args.line, layer, output: args.output ?? 'trajectory', start: event.startTime, end: event.endTime, options, eventCount: Object.values(next.judgeLineList[args.line].eventLayers[layer]).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0) }, args.replace === true);
  });
  register('trajectory_split', t('agent-chart-tools.s67c90c6'), agentSchema({ revision: agentText, line: agentIndex, layer: layerNumber, eventIndex: agentIndex, settings: splitSchema }, ['revision', 'line', 'eventIndex']), 'edit', args => {
    const chart = check(args), layer = args.layer ?? 0, event = chart.judgeLineList[args.line]?.eventLayers?.[layer]?.moveXEvents?.[args.eventIndex];
    if (!event?.trajectory) throw Error(t('agent-chart-tools.s8d0aeb1'));
    return prepareChart(args, chart, splitTrajectoryChart(chart, args.line, layer, event, args.settings), t('agent-chart-tools.sd0b8713'), { line: args.line, layer });
  });
  register('curve_notes', t('agent-chart-tools.s7906f9d'), agentSchema({ revision: agentText, line: agentIndex, start: beat, end: beat, startX: agentNumber, endX: agentNumber, type: choice([1, 3, 4]), division: integer(1, 100), density: number(.001, 1000), easingType: integer(1, 29) }, ['revision', 'line', 'start', 'end', 'startX', 'endX']), 'edit', args => {
    const chart = check(args), line = chart.judgeLineList[args.line]; if (!line) throw Error(t('agent-chart-tools.s7a90672'));
    const notes = generateCurveNotes({ startTime: time(args.start), endTime: time(args.end), startX: args.startX, endX: args.endX, type: args.type ?? 4, division: args.division ?? editor.timeline.division ?? 4, density: args.density ?? 1, easingType: args.easingType ?? 1, noteDefaults: editor.session.noteDefaults });
    if (!notes.length) throw Error(t('agent-chart-tools.sfbba660'));
    const next = { ...chart, judgeLineList: chart.judgeLineList.map((entry, index) => index === args.line ? { ...entry, notes: [...(entry.notes ?? []), ...notes].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime)), numOfNotes: (entry.notes?.length ?? 0) + notes.length } : entry) };
    return prepareChart(args, chart, next, t('agent-chart-tools.sae195fe'), { line: args.line, count: notes.length });
  });
  register('noise_track', t('agent-chart-tools.sd2ee023'), agentSchema({ revision: agentText, start: beat, end: beat, target: agentSchema({ mode: choice(['line', 'note']), lineIndex: agentIndex, noteIndex: agentIndex }, ['mode', 'lineIndex']), width: number(.001, 100000), height: number(.001, 100000), layerId: agentText, invert: boolean, active: boolean, sampleRate: choice([60, 120, 240]), name: agentText }, ['revision', 'start', 'end', 'target', 'width', 'height']), 'edit', args => {
    const chart = check(args), area = trackedNoiseArea(chart, new TempoMap(chart.BPMList), { ...args, start: time(args.start), end: time(args.end) });
    return prepareChart(args, chart, noiseTrackingChart(chart, area), t('agent-chart-tools.sd5825e9'), { count: 1, index: chart.blockAreaList?.length ?? 0, target: args.target, segments: area.moveXEvents.length });
  });
  register('noise_fit', t('agent-chart-tools.sfd5c03e'), agentSchema({ revision: agentText, mode: choice(['text', 'image']), text: { type: 'string', maxLength: 1000 }, font: { type: 'string', maxLength: 200 }, image: agentText, precision: integer(16, 512), spacing: number(.5, 4), threshold: integer(1, 254), polarity: choice(['dark', 'light', 'alpha']), invertImage: boolean, merge: boolean, maxSpan: integer(1, 512), trim: boolean,
    first: beat, last: beat, duration: beat, width: number(1, 20000), x: agentNumber, y: agentNumber, rotation: agentNumber, layerId: agentText, invert: boolean, name: agentText, active: boolean, activeStart: beat, activeEnd: beat, readyFlash: number(0, 600), reveal: choice(NOISE_REVEALS.map(entry => entry[0])), easingType: integer(1, 29), seed: integer(0, 4294967295), analyzeOnly: boolean }, ['revision', 'mode', 'first', 'duration', 'width']), 'edit', async (args, { signal }) => {
    const chart = check(args), options = { text: '', font: 'sans-serif', spacing: 1.2, precision: 128, threshold: 128, polarity: 'dark', merge: true, maxSpan: 12, trim: true, x: 0, y: 0, ...args,
      first: agentBeat(args.first), last: agentBeat(args.last ?? args.first), duration: agentBeat(args.duration), layerId: args.layerId ?? noiseLayers(chart)[0].id };
    if (args.activeStart !== undefined) options.activeStart = agentBeat(args.activeStart); if (args.activeEnd !== undefined) options.activeEnd = agentBeat(args.activeEnd);
    const sourceImage = args.image ? editor.assets.get(args.image) : editor.noiseFitPanel?.bitmap;
    let bitmap = editor.noiseFitPanel?.bitmap, owned = false, raster;
    try {
      if (args.mode === 'image' && args.image) { const bytes = editor.assets.get(args.image); if (!bytes) throw Error(t('agent-chart-tools.s8d35b04')); bitmap = await createImageBitmap(new Blob([bytes])); owned = true; if (bitmap.width * bitmap.height > 64000000) throw Error(t('agent-chart-tools.sa905723')); }
      checkAgentSignal(signal); raster = await noiseRaster(options, bitmap);
    } finally { if (owned) bitmap?.close(); }
    checkAgentSignal(signal);
    const result = await fit('noise', { ...raster, options: { threshold: options.threshold, polarity: options.mode === 'text' ? 'alpha' : options.polarity, invert: options.mode === 'image' && options.invertImage, maxSpan: options.merge ? options.maxSpan : 1, merge: options.merge, trim: options.trim } }, signal);
    const areas = fittedNoiseAreas(result, options), next = noiseFitChart(chart, areas), summary = { count: areas.length, width: result.width, height: result.height, layerId: options.layerId, first: options.first, last: options.last, duration: options.duration };
    if (args.analyzeOnly) return { access: 'read', apply: () => ({ ...summary, generated: false }) };
    const plan = prepareChart(args, chart, next, t('agent-chart-tools.s84b7ddd'), summary), valid = plan.valid;
    return { ...plan, valid: () => valid() && (args.mode !== 'image' || sourceImage === (args.image ? editor.assets.get(args.image) : editor.noiseFitPanel?.bitmap)) };
  });
  register('text_fit', t('agent-chart-tools.s6c14f6e'), agentSchema({ revision: agentText, text: { type: 'string', maxLength: 1000 }, font: { type: 'string', maxLength: 200 }, lines: { anyOf: [{ type: 'string' }, { type: 'array', items: agentIndex, maxItems: 5000 }] }, beat, width: number(10, 10000), x: agentNumber, y: agentNumber, spacing: number(.5, 4), size: number(.05, 4), noteType: choice([1, 3, 4]), tolerance: number(0, 90), coverage: number(0, 100), replace: boolean, addNotes: boolean, analyzeOnly: boolean }, ['revision', 'text', 'lines', 'beat']), 'edit', async (args, { signal }) => {
    const chart = check(args), options = { font: 'sans-serif', width: 900, x: 0, y: 0, spacing: 1.2, size: .4, noteType: 4, tolerance: 30, coverage: 95, ...args };
    const indices = lineIndices(args.lines, chart);
    if (!indices.length || indices.length > 5000 || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || !chart.judgeLineList[index])) throw Error(t('agent-chart-tools.saad7470'));
    const noteSize = editor.preview?.noteSize ?? 175, texture = () => editor.skin?.noteImage?.(options.noteType) ?? editor.skin?.images?.get({ 4: 'Drag2', 1: 'Tap2', 3: 'Flick2' }[options.noteType]), sourceTexture = texture();
    const raster = await textRaster(options, editor.skin, noteSize); checkAgentSignal(signal);
    const result = await fit('text', { mask: raster.mask, width: raster.width, height: raster.height, length: raster.length, thickness: raster.thickness, limit: indices.length, tolerance: options.tolerance / 100, requiredCoverage: options.coverage / 100 }, signal);
    const summary = { count: result.strokes.length, available: indices.length, error: result.error, skeletonCoverage: result.skeletonCoverage, passed: result.passed };
    if (args.analyzeOnly || !result.passed) return { access: 'read', apply: () => ({ ...summary, generated: false, reason: result.passed ? t('agent-chart-tools.se4ca0b4') : t('agent-chart-tools.s775c7d7') }) };
    const strokes = result.strokes.map(stroke => ({ x: options.x + (stroke.x - raster.width / 2) / raster.scale, y: options.y - (stroke.y - raster.height / 2) / raster.scale, angle: stroke.angle }));
    const beatTime = time(args.beat), next = textLinesChart(chart, { ...options, strokes, indices, beatTime, beat: beatValue(beatTime) });
    const plan = prepareChart(args, chart, next, t('agent-chart-tools.s23acb5a'), summary, args.replace === true), valid = plan.valid;
    return { ...plan, valid: () => valid() && noteSize === (editor.preview?.noteSize ?? 175) && sourceTexture === texture() };
  });
  register('multi_line', t('agent-chart-tools.s5f27b55'), agentSchema({ lines: { anyOf: [{ type: 'string' }, { type: 'array', items: agentIndex, maxItems: 10000 }] }, enabled: boolean, mode: choice(['notes', 'events']), merge: boolean, width: number(30, 2400) }), 'read', args => {
    const chart = current(), session = editor.session, changing = Object.keys(args).length > 0;
    if (typeof args.lines === 'string') checkLineTokens(args.lines, chart);
    const expression = typeof args.lines === 'string' ? editor.timeline.resolveMultiLineExpression?.(args.lines) : null;
    const indices = args.lines === undefined ? [...session.multiLineIndices] : expression?.indices ?? lineIndices(args.lines, chart);
    const dynamic = expression?.dynamic || args.lines === undefined && Boolean(session.multiLineExpression);
    if (indices.some(index => !Number.isInteger(index) || !chart.judgeLineList[index]) || new Set(indices).size !== indices.length || changing && (args.enabled ?? true) && !indices.length && !dynamic) throw Error(t('agent-chart-tools.saad7470'));
    return { access: changing ? 'edit' : 'read', valid: () => editor.session === session && editor.chart === chart, apply: () => {
      if (changing) {
        if (args.lines !== undefined) {
          if (expression?.dynamic) editor.timeline.setMultiLineExpression(args.lines);
          else { session.multiLineExpression = ''; session.multiLineIndices = indices; }
        }
        session.setMultiLineEnabled(args.enabled ?? true, args.mode ?? session.multiLineMode);
        if (args.merge !== undefined) session.setMultiLineMerge(args.merge);
        if (args.width !== undefined) { const events = session.multiLineMode === 'events'; editor.timeline[events ? 'multiLineEventWidth' : 'multiLineWidth'] = args.width; editor.timeline[events ? 'multiLineEventWidthExplicit' : 'multiLineWidthExplicit'] = true; editor.raw?.persistEditor?.(); }
        session.notify(); editor.render?.();
      }
      return { enabled: session.multiLineEnabled, mode: session.multiLineMode, lines: [...session.multiLineIndices], expression: session.multiLineExpression || null, merge: session.multiLineMerge };
    } };
  });
  register('global_events', t('agent-chart-tools.s654934a'), agentSchema({ action: choice(['list', 'read', 'replace']), revision: agentText, type: agentText, column: agentText, offset: agentIndex, limit: integer(1, 200), events: { type: 'array', maxItems: 10000, items: { type: 'object' } } }, ['action']), 'read', args => {
    const document = editor.globalEvents.document;
    if (args.action === 'list') return { apply: () => document.types.map(type => ({ id: type.id, name: type.name, source: type.source, readonly: type.readonly, persistent: type.persistent, columns: type.columns.map(({ id, name, valueType, defaultValue, min, max, step, overlap }) => ({ id, name, valueType, defaultValue, min, max, step, overlap })) })) };
    const entry = document.columns.find(entry => entry.type.id === args.type && entry.column.id === args.column); if (!entry) throw Error(t('agent-chart-tools.sdd70d01'));
    if (args.action === 'read') return { apply: () => { const events = document.read(args.type, args.column), offset = args.offset ?? 0, limit = args.limit ?? 100; return { type: args.type, column: args.column, total: events.length, events: events.slice(offset, offset + limit), nextOffset: offset + limit < events.length ? offset + limit : null }; } };
    const chart = check(args), session = editor.session, original = JSON.stringify(entry.events), registryRevision = document.registry.revision;
    if (entry.type.readonly || !Array.isArray(args.events)) throw Error(t('agent-chart-tools.s1057f5d'));
    args.events.forEach(event => { validateColumnEvent(entry.column, event); const result = entry.type.validate?.(event, entry.column); if (result === false || typeof result === 'string') throw Error(typeof result === 'string' ? result : t('agent-chart-tools.s634a0c2')); });
    return { access: entry.events.length > 100 ? 'dangerous' : 'edit', summary: t('agent-chart-tools.s17d7c54', { p0: entry.type.name, p1: entry.column.name }), details: { before: entry.events, after: args.events }, valid: () => editor.session === session && editor.chart === chart && document.registry.revision === registryRevision && JSON.stringify(document.read(args.type, args.column)) === original, apply: () => {
      if (!document.apply([{ type: args.type, column: args.column, events: args.events }], t('agent-chart-tools.sa412903'))) throw Error(t('agent-chart-tools.s3c73225')); return { count: args.events.length, undoable: true, persistent: entry.type.persistent };
    } };
  });
}
