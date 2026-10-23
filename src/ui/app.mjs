// Must stay first: it applies the saved language before the modules below build
// their label tables with `t()`.
import '../platform/locale-bootstrap.mjs';
import { EditorSession } from '../application/session.mjs';
import { FrameLimiter, validFpsLimit } from '../core/frame-timing.mjs';
import { assertChart, createChart, diagnose, EVENT_TYPES, previewLimitations } from '../core/chart.mjs';
import { chartDisplayName } from '../core/labels.mjs';
import { beatValue, parseBeat, formatBeat, fromNumber, upperBound } from '../core/beat.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { AudioTransport } from '../platform/audio.mjs';
import { openFiles, assetBytes, resourceReferences, attachExternalEffects } from '../platform/files.mjs';
import { showExportDialog } from './export-dialog.mjs';
import { listDrafts, readDraft, saveSnapshot } from '../platform/recovery.mjs';
import { Timeline, prepareCanvas } from './timeline.mjs';
import { Preview } from './preview.mjs';
import { renderProperties } from './inspector.mjs';
import { showDialog, editJson, choose, confirmAction, dialogOpen } from './dialog.mjs';
import { migratePreferences, shortcutAction, shortcutReleased, shortcutMatches, DEFAULT_HOTKEYS } from '../core/preferences.mjs';
import { directoryEntries, uploadedEntries, scanMigration } from '../platform/migration.mjs';
import { readProject, readPreferences, storePreferences, storeProject, readClipboardHistory, storeClipboardHistory, subscribeLibrary } from '../platform/library.mjs';
import { storageFailure, requestPersistence } from '../platform/storage.mjs';
import { StoragePanel, noteLibrarySave, noteExternalBackup } from './storage-panel.mjs';
import { VersionControlPanel } from './version-control.mjs';
import { migrationDialog } from './migration-dialog.mjs';
import { LinePanel } from './line-panel.mjs';
import { AssetLibraryPanel } from './asset-library.mjs';
import { remapAssetReferences } from '../platform/asset-library.mjs';
import { HELP_TEXT } from './help.mjs';
import { download } from '../platform/files.mjs';
import { RpeSkin } from './skin.mjs';
import { ProjectImages } from '../platform/images.mjs';
import { HitSounds } from '../platform/hitsounds.mjs';
import { renderEventInspector } from './event-inspector.mjs';
import { cancelValueDrag, handleValueDragKey } from './draggable-value.mjs';
import { eventKey, eventList, selectedEventEntries, selectEvent, selectAllEvents, deleteEvents, transformEvents, toggleSingleEventLock } from '../application/event-commands.mjs';
import { stickSelectedEventToNext } from '../application/event-tools.mjs';
import { BATCH_ACTIONS, applyBatchAction, nudgeSelection, captureSelection } from '../application/batch-edit.mjs';
import { copyObjects, cutObjects, pasteObjects, deleteObjects } from '../application/clipboard.mjs';
import { ClipboardHistory } from '../application/clipboard-history.mjs';
import { renderClipboardHistory } from './clipboard-history.mjs';
import { PasteGesture } from './paste-gesture.mjs';
import { SelectionOverlay } from './selection-overlay.mjs';
import { SelectionIntervalPanel } from './selection-interval.mjs';
import { LineSwitcher } from './line-switcher.mjs';
import { stepLine } from '../core/line-overview.mjs';
import { applyNumberShortcut } from '../application/number-shortcuts.mjs';
import { BatchControls } from './batch-controls.mjs';
import { MultiEditPanel } from './multi-edit.mjs';
import { MultiLinePanel } from './multi-line.mjs';
import { clipboardBeat } from './clipboard-preview.mjs';
import { shaderEvents, replaceShaderEvents, shaderIdentity } from '../core/shader-events.mjs';
import { renderMetadataPanel, renderBpmPanel } from './forms.mjs';
import { EditorPlayback } from '../application/playback.mjs';
import { readEditorPreferences, writeEditorPreferences } from '../platform/editor-preferences.mjs';
import { ProjectHome } from './home.mjs';
import { createSettingsPanel } from './settings.mjs';
import { showHotkeySettings } from './hotkey-settings.mjs';
import { AutoSaveClock } from '../application/autosave.mjs';
import { ManualSaveQueue } from '../application/manual-save.mjs';
import { SPECIAL_TRACKS, MAX_BASE_LAYERS } from '../core/editor-display.mjs';
import { lineGroupName, isDefaultLineGroup, lineDisplayLabel } from '../core/line-groups.mjs';
import { isTextEntry, usesNativeTextShortcut, releaseShortcutFocus } from './keyboard.mjs';
import { setRatioOptions, applyViewControls } from './view-controls.mjs';
import { generateCurveNotes } from '../core/curve-notes.mjs';
import { createEasingPicker } from './easing-picker.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { SceneRuntime } from '../core/scene.mjs';
import { TimelineActivity } from '../core/timeline-activity.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { AudioAnalysis } from './audio-analysis.mjs';
import { TrajectoryPanel } from './trajectory-panel.mjs';
import { TextLinesPanel } from './text-lines.mjs';
import { NoiseFitPanel } from './noise-fit.mjs';
import { NoiseTrackingPanel } from './noise-tracking.mjs';
import { CollaborationPanel } from './collaboration.mjs';
import { NoiseAreaEditor } from './noise-area.mjs';
import { EventSampler } from './event-sampler.mjs';
import { EditorSkins } from './editor-skins.mjs';
import { NoteSkins } from './note-skins.mjs';
import { editorSkinContext, editorCanvasRevision } from './editor-skin-canvas.mjs';
import { editorSkinState, editorSkinSignal } from './editor-skin-state.mjs';
import { pcmWave } from '../platform/pcm-wave.mjs';
import { ModManager } from './mod-manager.mjs';
import { emitModHook } from '../core/mod-hooks.mjs';
import { GlobalEventRegistry, registerPlaceholderGlobalEvent } from '../core/global-events.mjs';
import { GlobalEventsEditor } from './global-events.mjs';
import { initializeLocalPreferences, flushLocalPreferences } from '../platform/local-preferences.mjs';
import { nativeStorage } from '../platform/native.mjs';
import { DEFAULT_EDITOR_PREFERENCES, DEFAULT_SETTINGS } from '../core/default-settings.mjs';
import { appendLineShortcutDigit } from '../core/line-switch.mjs';
import { installNumericExpressionInputs } from './numeric-expression-input.mjs';
import { TimeReadouts } from './time-readouts.mjs';
import { currentLocale, setLocale, t } from '../i18n.mjs';
import { localeCandidates, preferredLocales, readLocalePreference, writeLocalePreference } from '../platform/locale.mjs';
import { installDomTranslation } from './dom-i18n.mjs';

// Resolve the interface language before any UI text is created. An explicit
// choice wins; otherwise the browser and migrated RPE settings decide.
for (const candidate of preferredLocales({ stored: readLocalePreference() })) {
  if (setLocale(candidate).locale) break;
}
document.documentElement.lang = currentLocale().locale;

try { await initializeLocalPreferences(); }
catch (error) {
  const host = document.createElement('div'); host.className = 'native-storage-migration';
  const message = document.createElement('p'); message.textContent = t('app.sa0301be') + error.message + t('app.se81663c');
  const retry = document.createElement('button'); retry.textContent = t('app.se2d53a6'); retry.onclick = () => location.reload();
  host.append(message, retry); document.body.append(host); throw error;
}
if (globalThis.rpenDesktopStorage) globalThis.rpenFlushPreferences = flushLocalPreferences;

const element = selector => document.querySelector(selector);
let mods;
globalThis.__rpenModInputGate=true;
for(const type of ['keydown','keyup','wheel','pointerdown','pointerup','mousedown','mouseup','click','dblclick','contextmenu','drop','dragstart','input','change','submit'])window.addEventListener(type,event=>{
  const runtime=mods?.runtime;
  if(type==='keydown'&&event.ctrlKey&&event.altKey&&event.shiftKey&&event.key==='F11'){cancelValueDrag();event.preventDefault();event.stopImmediatePropagation();runtime?.emergency?.();return;}
  runtime?.handleInput(event);
  if(!event.defaultPrevented&&['keydown','keyup'].includes(type))handleValueDragKey(event);
},{capture:true,passive:false});
const displayFields = [
  ['selection-interval', 'selectionInterval', DEFAULT_EDITOR_PREFERENCES.selectionInterval],
  ['include-backup-charts', 'includeBackupCharts', false],
  ['text-selection-drag', 'textSelectionDrag', false],
  ['event-cut-density', 'cutDensity', 4],
  ['event-drag-sensitivity', 'dragSensitivity', 1],
  ['sample-auto-fit', 'sampleAutoFit', true],
  ['paired-movement-sampling', 'pairedMovementSampling', true],
  ['note-size', 'noteSize', 200],
  ['wheel-limit-audio-start', 'wheelStopAtAudioStart', true],
  ['hit-tap-delay', 'hitTapDelay', DEFAULT_EDITOR_PREFERENCES.hitTapDelay], ['hit-drag-delay', 'hitDragDelay', DEFAULT_EDITOR_PREFERENCES.hitDragDelay], ['hit-flick-delay', 'hitFlickDelay', DEFAULT_EDITOR_PREFERENCES.hitFlickDelay],
  ['draw-event-curves', 'drawEventCurves', true],
  ['pick-preview-noise-areas', 'pickPreviewNoiseAreas', true],
  ['seamless-noise-areas', 'seamlessNoiseAreas', true],
  ['force-simple-noise', 'forceSimpleNoise', false],
  ['judgement-offset', 'judgementOffset', 92],
  ['judgement-color', 'judgementColor', '#ffffff'],
  ['default-line-thickness', 'lineScale', 1.5],
  ['line-switcher-enabled', 'lineSwitcher', true],
  ['clipboard-history-enabled', 'clipboardHistory', true],
  ['bar-width', 'barWidth', DEFAULT_SETTINGS.barWidth], ['bar-alpha', 'barAlpha', DEFAULT_SETTINGS.barAlpha], ['event-value-size', 'eventValueSize', 13], ['event-value-threshold', 'eventValueThreshold', 30], ['event-curve-threshold', 'eventCurveThreshold', 24], ['event-opacity', 'eventOpacity', 0.25], ['event-bar-width', 'eventBarWidth', DEFAULT_EDITOR_PREFERENCES.eventBarWidth], ['seamless-events', 'seamlessEvents', true],
  ['background-blur', 'backgroundBlur', 10.5], ['scroll-speed', 'scrollSpeed', 5], ['tips-enabled', 'tipsEnabled', true], ['success-notifications', 'successNotifications', true],
  ['viewport-overflow', 'viewportOverflow', DEFAULT_EDITOR_PREFERENCES.viewportOverflow], ['overflow-blur', 'overflowBlur', DEFAULT_EDITOR_PREFERENCES.overflowBlur], ['overflow-darken', 'overflowDarken', DEFAULT_EDITOR_PREFERENCES.overflowDarken],
  ['line-numbers', 'lineNumbers', true], ['line-arrows', 'lineArrows', true], ['line-tint', 'lineTint', true], ['merge-line-numbers', 'mergeLineNumbers', true], ['pick-preview-lines', 'pickPreviewLines', true],
  ['note-source-hover', 'noteSourceHover', true],
  ['preserve-pitch', 'preservePitch', true], ['autoplay-view', 'autoplayView', true], ['highlight-notes', 'highlight', true],
  ['autosave-enabled', 'autoSave', true], ['autosave-seconds', 'autoSaveSeconds', 60], ['autosave-limit', 'autoSaveLimit', 10],
];
const settingsDialog = createSettingsPanel({
  onLocaleChange: (locale, previousLocale) => {
    // Parts of the editor (skins, mods, toolbar buttons…) build their DOM once
    // at startup, so a live switch would leave them in the old language. Reload
    // instead and reopen the chart the user was editing.
    if (hasDocument && (session.history.dirty || assetDirty || !libraryProject?.id)) {
      // Report in the language the user is still looking at.
      if (previousLocale) setLocale(previousLocale);
      notify(t('notify.localeNeedsSave'), 'warning');
      return false;
    }
    writeLocalePreference(locale.locale);
    try { if (hasDocument && libraryProject?.id) sessionStorage.setItem(LOCALE_REOPEN_KEY, libraryProject.id); } catch { /* storage unavailable */ }
    location.reload();
    return true;
  },
});
// Static markup is translated once here; the language switch reloads the page.
installDomTranslation(() => { document.documentElement.lang = currentLocale().locale; renderSession(); });
installNumericExpressionInputs();
let session = new EditorSession();
let assets = new Map();
let assetFolders = new Set();
let assetDirty = false;
let chartName = 'chart.json';
// A brand-new chart stores the reference-language sentinel; show it localized.
const chartTitle = () => chartDisplayName(session.chart.META.name);
let recoveryId = crypto.randomUUID();
let tempo = new TempoMap(session.chart.BPMList);
let tempoEntries = session.chart.BPMList;
let dirtyFrame = true;
let lastDraftDocument;
let lastDraftAssets = [], lastDraftFolders = [];
let preferences = migratePreferences();
let libraryProject = null;
let versionRepoId = crypto.randomUUID();
let versionControl = null;
let persistenceRequested = false;
const manualSaves = new ManualSaveQueue(storeProject);
let editorPreferences = { ...DEFAULT_EDITOR_PREFERENCES, ...readEditorPreferences() };
const fileOptions = () => ({ includeBackupCharts: editorPreferences.includeBackupCharts === true });
let atHome = true;
let hasDocument = false;
// Set right before a language switch reloads the page so the same chart reopens.
const LOCALE_REOPEN_KEY = 'rpe-next-reopen-project';
let previewReturnTime = 0;
let placementContext;
let heldPreview;
let curveStart;
let curveEnd;
let curveAnchorMode = null;
let curveEditorOpen = false;
let curveEasingPicker;
let curveValues = { startTime: [0, 0, 1], endTime: [4, 0, 1], startX: -405, endX: 405, density: 1, type: 4, easingType: 1 };
let loop = null;
let activePaneName = 'chart';
let lastSelectionSignature = '';
let editTimeSeconds = 0;
let editClockTick = performance.now();
let lastDiagnosticSignature = null;
const audio = new AudioTransport();
const hitSounds = new HitSounds(audio);
const preview = new Preview(element('#preview'));
const realtimePreview = new Preview(element('#realtime-preview'));
const lineInfoScene = new SceneRuntime();
const timelineActivity = new TimelineActivity();
const invalidate = () => { dirtyFrame = true; };
const timeReadouts = new TimeReadouts(element('.time-readouts'), invalidate);
preview.invalidate = realtimePreview.invalidate = invalidate;
realtimePreview.applyShaders = false;
realtimePreview.showHitEffects = false;
const skin = new RpeSkin(invalidate);
const images = new ProjectImages(invalidate, message => status(message));
const timeline = new Timeline(element('#notes'), element('#events'), () => session, editEvent, invalidate, error => reportError(error), openTimelineContextMenu);
const noiseEditor = new NoiseAreaEditor(element('#noise-panel'), element('#noise-editor-canvas'), () => ({ session, tempo, timeline, preview, realtimePreview, previewVisible: preview.visible, seconds: chartSeconds, sampleAutoFit: element('#sample-auto-fit').checked }), {
  commit: (label, chart) => session.commit(label, chart), invalidate, notify, activate: activatePane,
  onContextMenu: event => openTimelineContextMenu(event),
  pause: () => playback.pause(), seek: beat => seekBeat(beat), wheel: event => previewWheel(event),
  getAssets: () => assets,
  onAssets: entries => { for (const [name, bytes] of entries) assets.set(name, bytes); assetDirty = true; images.load(session.chart, assets, chartName); invalidate(); },
});
const globalEventRegistry = new GlobalEventRegistry();
registerPlaceholderGlobalEvent(globalEventRegistry);
const globalEvents = new GlobalEventsEditor(element('#global-events-panel'), element('#global-events-canvas'), globalEventRegistry,
  () => ({ session, tempo, timeline, previewVisible: preview.visible, seconds: () => chartSeconds(), duration: () => audio.duration }),
  { activate: activatePane, invalidate, notify, seek: beat => seekBeat(beat), wheel: event => previewWheel(event), onContextMenu: event => openTimelineContextMenu(event) });
const selectionIntervalPanel = new SelectionIntervalPanel(element('#selection-interval'), () => editorPreferences.selectionInterval ?? 1, value => {
  editorPreferences.selectionInterval = value; timeline.selectionInterval = globalEvents.timeline.selectionInterval = value;
  persistEditor(); invalidate();
});
for (const renderer of [preview, realtimePreview]) {
  renderer.noisePreview.hiddenLayers = noiseEditor.hiddenLayers;
  renderer.noisePreview.simpleLayers = noiseEditor.simpleLayers;
}
const eventSampler = new EventSampler(element('.stage'), () => ({ session, tempo, preview, realtimePreview, previewVisible: preview.visible, timeline, seconds: chartSeconds, playing: () => audio.playing, sampleAutoFit: element('#sample-auto-fit').checked, pairedMovementSampling: element('#paired-movement-sampling').checked }), { invalidate, pause: () => playback.pause(), notify });
const audioAnalysis = new AudioAnalysis(element('#audio-analysis-overlay'), () => timeline, () => audio, () => persistEditor());
let noteHoverTimer = null;
let noteHoverKey = null;
function clearNoteSourceToast() {
  if (noteHoverTimer) { clearTimeout(noteHoverTimer); noteHoverTimer = null; }
  noteHoverKey = null;
  const toast = element('#note-source-toast');
  if (toast) { toast.hidden = true; toast.onclick = null; }
}
timeline.onNoteHover = entry => {
  clearTimeout(noteHoverTimer); noteHoverTimer = null;
  const toast = element('#note-source-toast');
  const hoverEnabled = editorPreferences.noteSourceHover ?? preferences.settings.noteSourceHover ?? true;
  if (!hoverEnabled) { clearNoteSourceToast(); return; }
  if (!entry || atHome || !preview.visible || session.multiLineActive || !toast) { clearNoteSourceToast(); return; }
  const key = `${entry.lineIndex}:${entry.index}`;
  if (key === noteHoverKey && !toast.hidden) return;
  noteHoverKey = key; toast.hidden = true;
  noteHoverTimer = setTimeout(() => {
    if (noteHoverKey !== key || !entry?.lineIndex && entry?.lineIndex !== 0) return;
    const line = session.chart.judgeLineList?.[entry.lineIndex];
    if (!line) return;
    toast.textContent = t('app.sb6e1d2c', { p0: entry.lineIndex });
    toast.hidden = false;
    toast.onclick = () => { session.selectLine(entry.lineIndex); clearNoteSourceToast(); invalidate(); };
  }, 1000);
};
timeline.multiLineLabels = element('#multi-line-labels');
timeline.multiLineScrollElement = element('#multi-line-scroll');
timeline.multiLineScrollElement.addEventListener('input', event => {
  const area = session.multiLineMode === 'events' ? 'events' : 'notes';
  if (typeof timeline.multiLineScroll === 'number') timeline.multiLineScroll = { notes: timeline.multiLineScroll, events: timeline.multiLineScroll };
  timeline.multiLineScroll[area] = Number(event.target.value) || 0;
  invalidate();
});
let draggingMultiLineScroll = false;
function updateMultiLineScrollFromPointer(event) {
  const range = timeline.multiLineScrollElement;
  const rectangle = range.getBoundingClientRect();
  if (!rectangle.width) return;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width));
  range.value = String(Number(range.max || 0) * ratio);
  range.dispatchEvent(new Event('input', { bubbles: true }));
}
timeline.multiLineScrollElement.addEventListener('pointerdown', event => {
  event.preventDefault(); event.stopPropagation(); draggingMultiLineScroll = true;
  timeline.multiLineScrollElement.setPointerCapture?.(event.pointerId);
  updateMultiLineScrollFromPointer(event);
});
timeline.multiLineScrollElement.addEventListener('pointermove', event => {
  if (!draggingMultiLineScroll) return;
  event.preventDefault(); event.stopPropagation(); updateMultiLineScrollFromPointer(event);
});
const stopMultiLineScrollDrag = event => {
  if (!draggingMultiLineScroll) return;
  draggingMultiLineScroll = false; event?.stopPropagation?.();
};
timeline.multiLineScrollElement.addEventListener('pointerup', stopMultiLineScrollDrag);
timeline.multiLineScrollElement.addEventListener('pointercancel', stopMultiLineScrollDrag);
timeline.multiLineScrollElement.addEventListener('lostpointercapture', stopMultiLineScrollDrag);
const batchControls = new BatchControls(element('.stage'), timeline, () => session, () => !atHome && !preview.visible && !noiseEditor.active && !globalEvents.active, error => reportError(error));
const multiEdit = new MultiEditPanel(element('#multi-editor'), () => session, timeline, {
  close: () => activatePane('chart'), invalidate, notify: (message, severity) => notify(message, severity),
});
const trajectoryPanel = new TrajectoryPanel(element('#trajectory-editor'), () => ({ session, timeline, tempo, previewVisible: preview.visible }), { invalidate, notify, activate: activatePane });
const textLinesPanel = new TextLinesPanel(element('#text-lines-editor'), () => ({ session, tempo, seconds: chartSeconds(), skin, noteSize: preview.noteSize }), { invalidate, notify, activate: activatePane });
const noiseFitPanel = new NoiseFitPanel(element('#noise-fit-editor'), element('.stage'), () => ({ session, tempo, timeline, previewVisible: preview.visible, seconds: () => chartSeconds() }), { invalidate, notify, activate: activatePane, pause: () => playback.pause() });
const noiseTrackingPanel = new NoiseTrackingPanel(element('#noise-tracking-editor'), element('.stage'), () => ({ session, tempo, timeline, preview, realtimePreview, previewVisible: preview.visible, seconds: () => chartSeconds(), wheel: event => previewWheel(event) }), { invalidate, notify, activate: activatePane, pause: () => playback.pause() });
const multiLinePanel = new MultiLinePanel(element('#multi-line-editor'), () => session, { timeline, render: renderSession, notify, persist: persistEditor });
const linePanel = new LinePanel(element('#line-panel'), () => session, { render: renderSession, notify, getAssets: () => assets, getChartName: () => chartName, afterTexture: () => images.load(session.chart, assets, chartName) });
const editorSkins = new EditorSkins(element('#editor-skin-settings'), { invalidate, notify });
const noteSkins = new NoteSkins(element('#note-skin-settings'), { skin, hitSounds, audio, invalidate, notify, settings: settingsDialog, pause: () => playback.pause() });
document.addEventListener('rpen-editor-skin-changed', () => {
  lineSwitcher.lastFrame = -Infinity; lineSwitcher.cache.clear(); renderSession();
  if (activePaneName === 'clipboard') renderClipboardPanel();
});
document.addEventListener('rpen-note-skin-changed', () => { if (textLinesPanel.active) textLinesPanel.refresh(); });
const assetLibrary = new AssetLibraryPanel(element('#asset-library'), () => ({ assets, folders: assetFolders, chart: session.chart, chartName }), {
  notify,
  onChange: (nextAssets, nextFolders, paths) => {
    const nextChart = remapAssetReferences(session.chart, assets, nextAssets, paths, chartName);
    assets = nextAssets; assetFolders = new Set(nextFolders ?? []); assetDirty = true;
    if (nextChart !== session.chart) session.commit(t('app.s66f5500'), nextChart);
    images.load(session.chart, assets, chartName); status(t('app.s61fc662')); renderSession();
  },
  openFolder: nativeStorage ? async (path, folder) => {
    if (!libraryProject || assetDirty) throw Error(t('app.s7d40547'));
    await nativeStorage.call('openAssetFolder', libraryProject.id, path, folder);
  } : undefined,
});
const clipboardHistory = new ClipboardHistory();
const selectionOverlay = new SelectionOverlay(element('.stage'), timeline);
const lineSwitcher = new LineSwitcher(element('.stage'), () => ({
  chart: session.chart, tempo, seconds: chartSeconds(), selected: session.lineIndex,
  layer: timeline.layer, extended: timeline.extended,
  start: timeline.timeAt(timeline.viewHeight()), end: timeline.timeAt(0),
  visible: hasDocument && !atHome && !preview.visible && !noiseEditor.active && !globalEvents.active && !dialogOpen(),
}), { select: index => selectOverviewLine(index) });
function clipboardTargetLine() {
  return timeline.hoverArea === 'events'
    ? timeline.lineIndexAt(timeline.eventCursor?.x ?? 0, timeline.eventsCanvas.clientWidth, 'events')
    : timeline.lineIndexAt(timeline.cursor?.x ?? 0, timeline.notesCanvas.clientWidth, 'notes');
}
const pasteGesture = new PasteGesture({
  paste: context => { try { pasteObjects(session, context.beat, { ...timeline.clipboardMode, targetLineIndex: clipboardTargetLine() }); } catch (error) { reportError(error); } },
  open: () => { activatePane('clipboard'); renderClipboardPanel(); },
  reportError: error => notify(t('app.s70852e2', { p0: error.message }), 'error'),
  valid: context => context.session === session && context.chart === session.chart && context.layer === timeline.layer && !atHome && !preview.visible && !dialogOpen() && !isTextEntry(document.activeElement),
});
window.addEventListener('blur', () => pasteGesture.cancel());
document.addEventListener('focusin', event => { if (isTextEntry(event.target)) pasteGesture.cancel(); });
let stripCache;
function createStripCanvas(width, height, role) {
  const canvas = document.createElement('canvas'); const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const context = editorSkinContext(canvas.getContext('2d'), role); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  return { canvas, context, width, height };
}
function drawTimelineStrips() {
  const height = timeline.notesCanvas.clientHeight; const densityCanvas = element('#note-density'); const historyCanvas = element('#history-strip');
  const width = densityCanvas.clientWidth; if (!height || !width) return;
  timelineActivity.compile(session.chart, tempo);
  const duration = Math.max(0.001, audio.duration > 0 ? audio.duration : timelineActivity.duration);
  const historyEntries = session.recentEdits ?? [];
  const historySignature = `${historyEntries.length}:${historyEntries.at(-1)?.start ?? ''}:${historyEntries.at(-1)?.end ?? ''}:${historyEntries.at(-1)?.label ?? ''}`;
  const key = { chart: session.chart, line: session.lineIndex, layer: timeline.layer, extended: timeline.extended, duration, width, historyWidth: historyCanvas.clientWidth, height, historySignature, skinRevision: editorCanvasRevision() };
  if (!stripCache || Object.keys(key).some(name => stripCache[name] !== key[name])) {
    const noteFrame = createStripCanvas(width, height, 'density'); const historyFrame = createStripCanvas(historyCanvas.clientWidth, height, 'history');
    const { bins, noteBins, eventBins, maximum } = timelineActivity.density(session.lineIndex, timeline.layer, timeline.extended, duration, height);
    const logarithm = Math.log1p(maximum); const half = Math.max(1, width / 2 - 2);
    for (let index = 0; index < bins; index++) {
      const y = height - (index + 1) * height / bins; const barHeight = Math.max(1, height / bins - 1);
      const noteValue = noteBins[index] ? Math.log1p(noteBins[index]) / logarithm : 0;
      const eventValue = eventBins[index] ? Math.log1p(eventBins[index]) / logarithm : 0;
      if (noteValue) { noteFrame.context.fillStyle = '#56b9d4'; noteFrame.context.globalAlpha = noteValue; noteFrame.context.fillRect(2, y, half, barHeight); }
      if (eventValue) { noteFrame.context.fillStyle = '#d39b55'; noteFrame.context.globalAlpha = eventValue; noteFrame.context.fillRect(width - half - 2, y, half, barHeight); }
    }
    const historyWidth = historyCanvas.clientWidth;
    historyEntries.forEach((command, index) => {
      const start = Math.max(0, Math.min(duration, command.start)); const end = Math.max(start, Math.min(duration, command.end));
      const y1 = height - end / duration * height; const y2 = height - start / duration * height;
      historyFrame.context.globalAlpha = Math.max(0.25, (index + 1) / Math.max(1, historyEntries.length)); historyFrame.context.fillStyle = '#c69b55';
      historyFrame.context.fillRect(2, Math.min(y1, y2) - 1, historyWidth - 4, Math.max(2, Math.abs(y2 - y1) + 2));
    });
    stripCache = { ...key, note: noteFrame.canvas, history: historyFrame.canvas };
  }
  const noteFrame = prepareCanvas(densityCanvas); const historyFrame = prepareCanvas(historyCanvas);
  densityCanvas.getContext('2d').drawImage(stripCache.note, 0, 0, width, height);
  historyCanvas.getContext('2d').drawImage(stripCache.history, 0, 0, historyCanvas.clientWidth, height);
  const markerY = height - Math.max(0, Math.min(duration, chartSeconds())) / duration * height;
  for (const frame of [noteFrame, historyFrame]) { frame.context.strokeStyle = '#f5e59a'; frame.context.lineWidth = 1; frame.context.beginPath(); frame.context.moveTo(0, markerY + .5); frame.context.lineTo(frame.width, markerY + .5); frame.context.stroke(); }
}
function seekFromStrip(event) {
  const rect = event.currentTarget.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  timelineActivity.compile(session.chart, tempo);
  const duration = audio.duration > 0 ? audio.duration : timelineActivity.duration; playback.seek((1 - ratio) * duration + offsetSeconds());
}
element('#note-density').addEventListener('click', seekFromStrip);
element('#history-strip').addEventListener('click', seekFromStrip);
timeline.curvePick = note => {
  if (!curveAnchorMode) return false;
  const anchor = { startTime: [...note.startTime], positionX: note.positionX, type: note.type };
  if (curveAnchorMode === 'start') {
    curveStart = anchor;
    curveAnchorMode = null;
    element('#curve-start')?.classList.remove('active');
    curveValues.startTime = anchor.startTime; curveValues.startX = anchor.positionX; updateCurvePanel();
    status(t('app.s55fff36'));
    invalidate();
    return true;
  }
  if (!curveStart) { curveAnchorMode = null; status(t('app.s0b8378a')); return true; }
  curveEnd = anchor;
  curveAnchorMode = null;
  element('#curve-end')?.classList.remove('active');
  curveValues.endTime = anchor.startTime; curveValues.endX = anchor.positionX; updateCurvePanel();
  status(t('app.s3739e90'));
  return true;
};
timeline.curveGhost = () => {
  if (!curveEditorOpen || !curveStart) return [];
  const exists = anchor => session.notes.some(note => note.positionX === anchor.positionX && beatValue(note.startTime) === beatValue(anchor.startTime));
  const anchors = [{ startTime: [...curveValues.startTime], positionX: curveValues.startX, type: curveValues.type, anchor: exists(curveStart) && curveValues.startX === curveStart.positionX && beatValue(curveValues.startTime) === beatValue(curveStart.startTime) }];
  if (!curveEnd) return anchors;
  const end = { startTime: [...curveValues.endTime], positionX: curveValues.endX, type: curveValues.type, anchor: exists(curveEnd) && curveValues.endX === curveEnd.positionX && beatValue(curveValues.endTime) === beatValue(curveEnd.startTime) };
  try {
    return [...anchors, ...generateCurveNotes({ ...curveValues, division: timeline.division }), end];
  } catch { return [...anchors, end]; }
};
timeline.skin = skin; preview.skin = skin; preview.images = images;
realtimePreview.skin = skin; realtimePreview.images = images;
skin.load();
document.fonts.load('35px RPEGame').then(invalidate);
const status = message => { element('#status').textContent = message; };
const notificationTimers = new Set();
function notify(message, level = 'success', duration = 2800) {
  if (['error', 'warning'].includes(level)) editorSkinSignal(level);
  if (level === 'success' && editorPreferences.successNotifications === false) return;
  const host = element('#notifications'); if (!host) return;
  const item = document.createElement('div'); item.className = `editor-notification ${level}`; item.textContent = message; host.append(item);
  requestAnimationFrame(() => item.classList.add('visible'));
  const timer = setTimeout(() => { item.classList.add('leaving'); setTimeout(() => item.remove(), 260); notificationTimers.delete(timer); }, duration); notificationTimers.add(timer);
}
timeline.notify = (message, level = 'warning') => notify(message, level);
const reportError = error => {
  const message = storageFailure(error); status(message); notify(message, 'error', 7000);
  const host = showDialog(error.name === 'ProjectConflictError' ? t('app.s61fa498') : t('app.s223fb3c'), message);
  if (error.name === 'ProjectConflictError' && libraryProject?.id === error.projectId && hasDocument) {
    for (const [label, run] of [[t('app.s15e8f96'), () => showExportDialog(session.chart, assets, chartName, (_name, format) => { if (format === 'pez') noteExternalBackup(); }, libraryProject?.identifier, fileOptions())],
      [t('app.s53213ef'), async () => { libraryProject = null; session.history.savedDocument = null; await save(); }]]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.onclick = async () => { element('#modal').close(); try { await run(); } catch (failure) { reportError(failure); } }; host.append(button);
    }
  }
};
document.addEventListener('rpen-storage-blocked', () => notify(t('app.sc0d447d'), 'warning', 7000));
// Tips are stored as keys so switching the language swaps the text too.
const tipKeys = [
  'app.s4bf04e3',
  'app.s6861f58',
  'app.s7b81457',
  'app.s02fa461',
  'app.saeff07b',
  'app.s2b801b6',
  'app.s7795e1c',
  'app.sc5574a8',
  'app.s99a95fb',
  'app.sc9bc457',
  'app.sd67584b',
  'app.sad8e978',
  'app.s18f7e80',
  'app.sf35446f',
  'app.sf50c3c5',
  'app.s1ed117b',
  'app.s860780f',
  'app.saf9dadc',
  'app.s7a89e84',
  'app.s3f8c4d7',
  'app.s5ed173f',
  'app.s801fd0c',
  'app.s61024c2',
  'app.s2f3f064',
  'app.s2fa0c57',
  'app.s46e26f6',
  'app.s58b1d6f',
  'app.s26acb9c',
  'app.s7bce64d',
  'app.s9e43446',
  'app.s02c2119',
  'app.sc21eb7c',
  'app.s4963c44',
  'app.s9320781',
  'app.sffe6b8a',
  'app.sb329966',
  'app.s1332d89',
  'app.s4648271',
  'app.s760f48e',
  'app.s074da51',
  'app.sce9623e',
  'app.sd7c1b2e',
  'app.s7dc5fa4',
  'app.s15c86b5',
  'app.s4a39c08',
  'app.s6f9d89a',
  'app.s669449c',
  'app.sfd56c24',
  'app.sa302181',
  'app.s094100c',
  'app.sfb6f94a',
  'app.s3816d85',
  'app.s53040c5',
  'app.sa5551d9',
  'app.sbc9e4e2',
  'app.sb1d120a',
  'app.sf47134d',
  'app.s88df27a',
  'app.s5d11416',
  'app.s7ba89fe',
  'app.sa668593',
  'app.sa4488e7',
  'app.s9c16d38',
  'app.sd64fc07',
  'app.sbff4832',
];
let tipIndex = 0;
function rotateTip() { const target = element('#tips'); if (!target || editorPreferences.tipsEnabled === false || atHome) { if (target) target.textContent = ''; return; } target.textContent = t(tipKeys[tipIndex++ % tipKeys.length]); }
setInterval(rotateTip, 10000);
const offsetSeconds = () => Number(session.chart.META.offset ?? 0) / 1000;
const chartSeconds = () => audio.time - offsetSeconds();
const resetEditClock = chart => {
  editTimeSeconds = 0;
  editClockTick = performance.now();
};
const advanceEditClock = timestamp => {
  const elapsed = Math.max(0, (timestamp - editClockTick) / 1000);
  if (hasDocument && !atHome && !document.hidden) editTimeSeconds += elapsed;
  editClockTick = timestamp;
};
const formatEditTime = seconds => `${String(Math.floor(seconds / 3600)).padStart(2, '0')} h, ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')} m, ${String(Math.floor(seconds) % 60).padStart(2, '0')} s`;
const currentBeat = () => tempo.beat(chartSeconds(), noiseEditor.active || globalEvents.active ? 1 : session.line?.bpmfactor ?? 1);
let collaborationJoining = false;
const collaborationTool = document.createElement('button'); collaborationTool.id = 'collaboration-tool'; collaborationTool.textContent = t('app.se55c4de'); element('[data-panel="chart"] .action-grid').append(collaborationTool);
const collaboration = new CollaborationPanel(element('#collaboration-panel'), () => ({
  session, timeline, interactionBusy: batchControls.active, seconds: chartSeconds(), offset: offsetSeconds(), duration: Number(element('#scrubber').max) || 600,
  seek: seconds => playback.seek(seconds + offsetSeconds()),
  sharedAssets: () => {
    const references = resourceReferences(session.chart, assets, chartName);
    const names = new Set([references.song, references.background, session.chart.META.background, ...session.chart.judgeLineList.map(line => line.Texture)].filter(Boolean));
    const skins = (session.chart.noiseAreaLayers ?? []).map(layer => layer.skin).filter(Boolean);
    return [...names].flatMap(name => { const bytes = assetBytes(assets, name, chartName); return bytes ? [[name, bytes]] : []; }).concat([...assets].filter(([name]) => skins.some(root => name.startsWith(root + '/'))));
  }
}), {
  notify, activate: activatePane,
  confirmJoin: run => guardReplace(run),
  receiveChart: (chart, owner) => {
    if (owner) { session.history.document = chart; return; }
    collaborationJoining = true;
    try { replaceChart(chart, '联机谱面.json'); } finally { collaborationJoining = false; }
    activatePane('collaboration');
  },
  receiveAsset: async (name, bytes) => {
    assets.set(name, bytes); assetDirty = true; images.load(session.chart, assets, chartName);
    const references = resourceReferences(session.chart, assets, chartName);
    if (name === references.song || name === session.chart.META.song) await loadMusic(bytes, name, false);
    hitSounds.setProject(session.chart, assets, chartName); renderSession();
  }
});
element('#collaboration-tool').onclick = () => activatePane('collaboration');
const playback = new EditorPlayback(audio, hitSounds, () => {
  timeline.origin = currentBeat();
  for (const renderer of [preview, realtimePreview]) { renderer.noisePreview.gpu?.reset(); renderer.overflowNoisePreview?.gpu?.reset(); renderer.overflowRevision++; }
  preview.effectsSince = realtimePreview.effectsSince = chartSeconds();
  invalidate();
});
timeline.onDragScroll = seconds => playback.seek(audio.time + seconds);
const autoSave = new AutoSaveClock(async () => {
  const current = session; const document = current.chart; const snapshot = { ...document }; delete snapshot.chartTime;
  const media = [...assets], folders = [...assetFolders];
  await saveSnapshot(libraryProject?.id ?? recoveryId, chartName, snapshot, media, editorPreferences.autoSaveLimit ?? preferences.settings.autoSaveLimit, { lineIndex: current.lineIndex, vcsId: versionRepoId });
  if (current === session) { lastDraftDocument = document; lastDraftAssets = media; lastDraftFolders = folders; status(t('app.s43755f3')); notify(t('app.s0d49e0d'), 'success'); }
}, error => { const message = t('app.sf83f150', { p0: storageFailure(error) }); status(message); notify(message, 'error', 7000); });
timeline.onWheel = event => {
  if (event.ctrlKey) {
    if (event.deltaY) {
      if (lineSwitcher.enabled) { lineSwitcher.step(event.deltaY); lineSwitcher.show(); }
      else switchLine(event.deltaY);
    }
  } else previewWheel(event);
};
function switchLine(direction) {
  const index = stepLine(session.lineIndex, direction, session.chart.judgeLineList?.length ?? 0);
  return selectOverviewLine(index);
}
function selectOverviewLine(index) {
  if (!Number.isInteger(index) || !session.chart.judgeLineList?.[index]) return false;
  batchControls.cancel(); pasteGesture.cancel(); timeline.cancelPlacement(); session.selectLine(index); return true;
}
const previewWheel = event => {
  event.preventDefault();
  playback.wheel(event, { ...preferences.settings, scrollSpeed: editorPreferences.scrollSpeed ?? preferences.settings.scrollSpeed, wheelStopAtAudioStart: editorPreferences.wheelStopAtAudioStart ?? preferences.settings.wheelStopAtAudioStart ?? true }, performance.now() / 1000);
};
element('.preview-wrap').addEventListener('wheel', previewWheel, { passive: false });
const pickPreviewLine = (renderer, event) => {
  const index = renderer.pick(event.clientX, event.clientY);
  if (index === null) return false;
  timeline.cancelPlacement(); session.selectLine(index); return true;
};
element('#preview').addEventListener('click', event => {
  if (!preview.visible) return;
  if (noiseTrackingPanel.sampling) { noiseTrackingPanel.pick(event); return; }
  const noiseIndex = preview.pickNoiseArea(event.clientX, event.clientY);
  if (Number.isInteger(noiseIndex)) {
    clearNoteSourceToast(); togglePreview(false, true); openNoisePanel(); noiseEditor.select(noiseIndex); noiseEditor.areaList.reveal(noiseIndex); return;
  }
  const noteLine = preview.pickNote(event.clientX, event.clientY);
  if (Number.isInteger(noteLine)) { timeline.cancelPlacement(); session.selectLine(noteLine); clearNoteSourceToast(); invalidate(); return; }
  pickPreviewLine(preview, event);
});
element('#preview').addEventListener('pointermove', event => {
  if (noiseTrackingPanel.sampling) { clearNoteSourceToast(); return; }
  if (!preview.visible || (editorPreferences.noteSourceHover ?? preferences.settings.noteSourceHover ?? true) === false) { clearNoteSourceToast(); return; }
  const lineIndex = preview.pickNote(event.clientX, event.clientY);
  if (!Number.isInteger(lineIndex)) { clearNoteSourceToast(); return; }
  const key = `preview:${lineIndex}`;
  clearTimeout(noteHoverTimer); noteHoverTimer = null;
  if (key === noteHoverKey && !element('#note-source-toast')?.hidden) return;
  noteHoverKey = key;
  const toast = element('#note-source-toast'); if (!toast) return;
  toast.hidden = true;
  noteHoverTimer = setTimeout(() => {
    if (noteHoverKey !== key || !preview.visible) return;
    toast.textContent = t('app.s33058f1', { p0: lineIndex });
    toast.hidden = false;
    toast.onclick = () => { session.selectLine(lineIndex); clearNoteSourceToast(); invalidate(); };
  }, 1000);
});
element('#preview').addEventListener('pointerleave', event => { if (!element('#note-source-toast')?.contains(event.relatedTarget)) clearNoteSourceToast(); });
timeline.previewPick = () => false;
const home = new ProjectHome(async id => {
  const project = await readProject(id);
  if (!project) throw new Error(t('app.s4572dcf'));
  guardReplace(() => loadCandidate({ chart: project.chart, name: project.chartName, info: project.info, project }, new Map(project.assets)).catch(reportError));
}, reportError, project => {
  if (libraryProject?.id === project.id) {
    if (project.deleted) {
      libraryProject = null;
      if (atHome) {
        hasDocument = false; session.history.markSaved(); assetDirty = false;
        setHome(true);
      } else {
        session.history.savedDocument = null; renderSession();
      }
      return;
    }
    const renamed = libraryProject.chart.META.name !== project.chart.META.name;
    libraryProject = project;
    if (!session.history.dirty) {
      session.commit(t('app.sc456347'), project.chart); session.history.markSaved(); renderSession();
    } else if (renamed) session.commit(t('app.sf1249c2'), { ...session.chart, META: { ...session.chart.META, name: project.chart.META.name } });
  }
});
// After a language switch the page reloads; reopen the chart that was open so
// the user lands back where they were.
try {
  const reopen = sessionStorage.getItem(LOCALE_REOPEN_KEY);
  if (reopen) { sessionStorage.removeItem(LOCALE_REOPEN_KEY); home.openProject(reopen).catch(reportError); }
} catch { /* storage unavailable */ }
const storagePanel = new StoragePanel(settingsDialog, { reportError, notify, fileOptions, canSwitchLibrary: () => {
  if (hasDocument && (session.history.dirty || assetDirty)) { notify(t('app.sa139201'), 'warning'); return false; }
  return true;
} });
async function persistVersionRepoId() {
  if (!libraryProject?.id || libraryProject.vcsId) return;
  const current = session, repoId = versionRepoId, project = libraryProject;
  const saved = await storeProject({ ...project, vcsId: repoId });
  if (session === current && libraryProject?.id === project.id && versionRepoId === repoId) libraryProject = saved;
  storagePanel.refresh().catch(() => {});
}
versionControl = new VersionControlPanel(element('#version-control-panel'), {
  getChart: () => session.chart,
  getAssets: () => assets,
  getFolders: () => assetFolders,
  getChartName: () => chartName,
  getRepoId: () => versionRepoId,
  isDirty: () => session.history.dirty || assetDirty,
  isPersisted: () => Boolean(libraryProject?.id),
  hasDocument: () => hasDocument && !atHome,
}, {
  notify, reportError,
  loadSnapshot: (snapshot, options) => loadVersionSnapshot(snapshot, options),
  persistRepoId: persistVersionRepoId,
});
document.addEventListener('rpen-preference-error', event => reportError(event.detail));
document.addEventListener('rpen-library-refresh', () => home.refresh().catch(reportError));
subscribeLibrary(change => {
  if (atHome) home.refresh().catch(reportError);
  if (libraryProject?.id === change.id && change.revision !== libraryProject.storageRevision) notify(change.deleted ? t('app.s6516ed3') : t('app.s69c0878'), 'warning', 7000);
});

function setHome(visible) {
  if (visible && noiseTrackingPanel.sampling) noiseTrackingPanel.endSample();
  if (visible && collaboration.client.active) collaboration.client.leave();
  atHome = visible;
  if (visible) clearNoteSourceToast();
  if (visible) { lineSwitcher.reset(); hitSounds.onlyCurrentLine = false; element('#mute-current-line')?.setAttribute('aria-pressed', 'false'); element('#mute-current-line')?.classList.remove('active'); }
  if (visible) { lineInfoVisible = false; element('#line-info-overlay')?.setAttribute('hidden', ''); }
  element('#document-name').textContent = visible ? t('app.sc3dbce4') : `${session.history.dirty ? '● ' : ''}${chartTitle()}`;
  element('#home').hidden = !visible;
  element('.workspace').hidden = visible;
  element('.transport').hidden = visible;
  element('#resume-editor').hidden = !hasDocument;
  for (const selector of ['#save', '#export']) element(selector).disabled = !hasDocument;
  if (visible) { playback.pause(); timeline.cancelPlacement(); home.refresh().catch(reportError); }
  invalidate();
}

let pendingTimelineMenu = null;
function timelineMarkers() {
  return Array.isArray(session.chart?.markers)
    ? session.chart.markers.filter(marker => Number.isFinite(Number(marker?.time)) && String(marker?.name ?? '').trim())
    : [];
}
function renderTimelineMarkers() {
  const root = element('#timeline-markers'); if (!root) return;
  root.replaceChildren();
  const width = root.clientWidth || element('#scrubber')?.clientWidth || 1;
  const duration = Math.max(0.001, audio.duration > 0 ? audio.duration : timelineActivity.duration || 1);
  for (const [index, marker] of timelineMarkers().entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'timeline-marker'; button.textContent = String(marker.name).trim();
    const ratio = Math.max(0, Math.min(1, Number(marker.time) / duration));
    button.style.left = `${ratio * width}px`; button.style.width = 'max-content'; button.style.maxWidth = '160px'; button.style.whiteSpace = 'nowrap'; button.title = `${marker.name} · ${Number(marker.time).toFixed(3)} s`;
    button.onclick = () => playback.seek(Number(marker.time) + offsetSeconds());
    button.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); openTimelineContextMenu(event, null, index); };
    root.append(button);
  }
}
function openTimelineContextMenu(event, canvas = null, markerIndex = null) {
  const menu = element('#timeline-context-menu'); if (!menu) return;
  selectionIntervalPanel.hide();
  const point = canvas ? timeline.point(event, canvas) : null;
  pendingTimelineMenu = { time: point ? timeline.timeAt(point.y) : null, markerIndex };
  element('#timeline-add-marker').hidden = !canvas;
  element('#timeline-delete-marker').hidden = markerIndex === null;
  element('#timeline-selection-interval').hidden = markerIndex !== null;
  element('#timeline-selection-interval').textContent = t('app.s3f3831b', { p0: timeline.selectionInterval ?? 1 });
  const selections = session.multiLineActive && session.multiLineMode === 'events'
    ? [...session.multiEventSelection].flatMap(([lineIndex, keys]) => [...keys].map(key => ({ lineIndex, key })))
    : [...session.eventSelection].map(key => ({ lineIndex: session.lineIndex, key }));
  const selection = selections.length === 1 ? selections[0] : null;
  const [type, index] = selection?.key.split(':') ?? [];
  const selected = type === 'moveXEvents' ? session.chart.judgeLineList[selection.lineIndex]?.eventLayers?.[timeline.layer]?.moveXEvents?.[Number(index)] : null;
  const split = element('#trajectory-context-split'); split.hidden = !selected?.trajectory || canvas !== timeline.eventsCanvas;
  split.onclick = () => { closeTimelineContextMenu(); trajectoryPanel.open(selected, selection.lineIndex, timeline.layer); trajectoryPanel.split(); };
  menu.hidden = false;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(window.innerWidth - bounds.width - 4, event.clientX))}px`;
  menu.style.top = `${Math.max(4, Math.min(window.innerHeight - bounds.height - 4, event.clientY))}px`;
}
function closeTimelineContextMenu() { const menu = element('#timeline-context-menu'); if (menu) menu.hidden = true; pendingTimelineMenu = null; }
function addTimelineMarker() {
  const pending = pendingTimelineMenu; closeTimelineContextMenu(); if (!pending || !Number.isFinite(pending.time)) return;
  const content = showDialog(t('app.s0898b72'), t('app.sc340606', { p0: pending.time.toFixed(3) }));
  const input = document.createElement('input'); input.type = 'text'; input.placeholder = t('app.sd762586'); input.setAttribute('aria-label', t('app.sd410ed1')); content.append(input);
  const apply = element('#modal-apply'); apply.hidden = false; apply.onclick = () => {
    const name = String(input.value ?? '').trim(); if (!name) { element('#modal-error').textContent = t('app.s7d9692d'); return; }
    const markers = [...timelineMarkers(), { time: pending.time, name }].sort((left, right) => left.time - right.time);
    session.commit(t('app.s0898b72'), { ...session.chart, markers }); element('#modal').close();
  }; input.focus();
}
function deleteTimelineMarker() {
  const pending = pendingTimelineMenu; closeTimelineContextMenu(); if (!pending || pending.markerIndex === null) return;
  const markers = timelineMarkers().filter((unused, index) => index !== pending.markerIndex);
  session.commit(t('app.sa5ceb33'), { ...session.chart, markers });
}
window.addEventListener('pointerdown', event => { const menu = element('#timeline-context-menu'); if (menu && !menu.contains(event.target)) closeTimelineContextMenu(); }, true);
element('#timeline-add-marker').addEventListener('click', addTimelineMarker);
element('#timeline-delete-marker').addEventListener('click', deleteTimelineMarker);
element('#timeline-selection-interval').addEventListener('click', () => {
  const bounds = element('#timeline-context-menu').getBoundingClientRect(); closeTimelineContextMenu(); selectionIntervalPanel.open(bounds.left, bounds.top);
});

function persistEditor() {
  editorPreferences = { ...editorPreferences, scale: timeline.scale, division: timeline.division, gridCount: timeline.gridCount, snapX: timeline.snapX, judgementOffset: timeline.judgementOffset, multiLineWidth: timeline.multiLineWidth || undefined, multiLineEventWidth: timeline.multiLineEventWidth || undefined,
    realtime: realtimePreview.visible, realtimeAlpha: Number(element('#realtime-alpha').value), volume: audio.volume, hitVolume: hitSounds.volume,
    hitEnabled: hitSounds.enabled, allLines: preview.allLines, toolbarMode: editorPreferences.toolbarMode ?? 'icons',
    analysisEnabled: audioAnalysis.enabled, analysisMode: audioAnalysis.mode, analysisAlpha: audioAnalysis.alpha, analysisWidth: audioAnalysis.width };
  try { writeEditorPreferences(editorPreferences); } catch (error) { status(t('app.s0971abd', { p0: error.message })); }
}

function activatePane(name) {
  if (name === 'global-event-properties' && (!globalEvents.active || globalEvents.selection.size !== 1)) name = 'global-events';
  if (name === 'global-events' && !globalEvents.active) { openGlobalEvents(); return; }
  if (name !== 'events' && eventSampler.active) eventSampler.finish(false);
  if (name !== 'multi') multiEdit.hide();
  if (name !== 'trajectory') trajectoryPanel.hide();
  if (name !== 'text-lines') textLinesPanel.hide();
  if (name !== 'noise-fit') noiseFitPanel.hide();
  if (name !== 'noise-tracking') noiseTrackingPanel.hide();
  activePaneName = name;
  editorSkinState({ pane: name });
  noiseEditor.syncChrome();
  globalEvents.syncChrome();
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
  for (const button of document.querySelectorAll('[data-pane]')) button.classList.toggle('active', button.dataset.pane === name);
  if (globalEvents.active && ['global-events', 'global-event-properties'].includes(name)) globalEvents.render();
  if (name === 'version-control') versionControl?.open().catch(reportError);
  invalidate();
}
for (const button of document.querySelectorAll('[data-pane]')) button.onclick = () => {
  const pane = button.dataset.pane;
  if (['notes', 'events'].includes(pane)) session.focus = pane;
  activatePane(pane);
  if (pane === 'lines') linePanel.render();
};
function openMultiLinePanel() { if (globalEvents.active) globalEvents.close(); activatePane('multi-line'); multiLinePanel.render(); }
function openNoisePanel() { if (globalEvents.active) globalEvents.close(); timeline.cancelPlacement(); batchControls.cancel(); pasteGesture.cancel(); multiEdit.hide(); trajectoryPanel.hide(); curveEditorOpen = false; noiseEditor.open(); }
function openGlobalEvents() {
  if (noiseEditor.active) noiseEditor.close();
  eventSampler.finish?.(false); timeline.cancelPlacement(); batchControls.cancel(); pasteGesture.cancel(); multiEdit.hide(); trajectoryPanel.hide(); curveEditorOpen = false;
  globalEvents.open();
  renderSession();
}
const globalEventsTool = document.createElement('button'); globalEventsTool.id = 'global-events-tool'; globalEventsTool.textContent = t('app.s895a20e'); element('#noise-areas-tool').after(globalEventsTool);
globalEventsTool.onclick = openGlobalEvents;
element('#close-global-events').onclick = () => { globalEvents.close(); renderSession(); };
element('#noise-areas-tool').addEventListener('click', openNoisePanel);
element('#close-noise-editor').addEventListener('click', () => noiseEditor.close());
element('#noise-tab').addEventListener('click', () => { activatePane('noise'); noiseEditor.render(); });
element('#multi-line-tool').addEventListener('click', openMultiLinePanel);
element('#multi-line-open').addEventListener('click', openMultiLinePanel);
element('#multi-line-toggle').addEventListener('click', () => {
  const enabling = !session.multiLineEnabled;
  session.setMultiLineEnabled(enabling, session.focus === 'events' ? 'events' : 'notes');
  if (enabling) openMultiLinePanel();
});
element('#multi-line-prev-add').addEventListener('click', () => session.addPreviousMultiLine());
element('#multi-line-prev-remove').addEventListener('click', () => session.removeMinimumMultiLine());
element('#multi-line-next-add').addEventListener('click', () => session.addNextMultiLine());
element('#multi-line-next-remove').addEventListener('click', () => session.removeMaximumMultiLine());
element('#multi-line-merge').addEventListener('click', () => session.setMultiLineMerge(!session.multiLineMerge));
for (const button of document.querySelectorAll('[data-return-chart]')) button.onclick = () => activatePane('chart');
for (const form of document.querySelectorAll('#properties, #event-properties')) form.addEventListener('submit', event => { event.preventDefault(); document.activeElement?.blur(); });
for (const button of document.querySelectorAll('[data-icon]')) button.style.setProperty('--icon', `url('${assetUrl(`rpe/Texture/icon/${button.dataset.icon}.png`)}')`);
function togglePreview(force, stay = false, replay = false, { autoplay = true } = {}) {
  const visible = force ?? !preview.visible;
  if (visible) clearNoteSourceToast();
  if (visible && (!preview.visible || replay)) {
    previewReturnTime = audio.time; timeline.cancelPlacement();
    if (replay) playback.seek(0);
    if (autoplay && (editorPreferences.autoplayView ?? preferences.settings.autoplayView) && !audio.playing && !playback.pending) togglePlayback().catch(reportError);
  }
  if (!visible && preview.visible) playback.seek(stay ? audio.time : previewReturnTime);
  preview.visible = visible;
  element('.preview-wrap').hidden = !preview.visible;
  element('#view-toggle').classList.toggle('active', preview.visible);
  globalEvents.syncChrome();
  element('#multi-line-labels').hidden = preview.visible;
  element('#multi-line-scroll').hidden = preview.visible;
  element('#preview-title').textContent = chartDisplayName(session.chart.META.name);
  timeline.origin = currentBeat();
  invalidate();
}

function listen(selector, callback) {
  element(selector).addEventListener('click', async () => {
    try { await callback(); } catch (error) { reportError(error); }
  });
}

let lineInfoVisible = false;
const lineInfoNumber = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '0.00';
function selectedEventSpeed(type, event) {
  if (!event) return null;
  const duration = tempo.seconds(event.endTime, session.line?.bpmfactor ?? 1) - tempo.seconds(event.startTime, session.line?.bpmfactor ?? 1);
  if (!Number.isFinite(duration) || Math.abs(duration) < 0.000001 || !Number.isFinite(event.start) || !Number.isFinite(event.end)) return null;
  const rate = (event.end - event.start) / duration;
  if (type === 'moveXEvents') return `X ${lineInfoNumber(rate / 120)}`;
  if (type === 'moveYEvents') return `Y ${lineInfoNumber(rate / 120)}`;
  if (type === 'rotateEvents') return `R ${lineInfoNumber(rate)}`;
  if (type === 'speedEvents') return `Speed ${lineInfoNumber(rate / 120)}`;
  return null;
}
function updateLineInfo() {
  const overlay = element('#line-info-overlay');
  if (!overlay) return;
  if (!lineInfoVisible || !session.line || atHome) { overlay.hidden = true; return; }
  lineInfoScene.compile(session.chart, tempo);
  const seconds = chartSeconds();
  const state = lineInfoScene.sampler(seconds)(session.lineIndex) ?? { x: 0, y: 0, rotation: 0, alpha: 255 };
  const runtime = lineInfoScene.lines[session.lineIndex];
  const scrollSpeed = runtime?.speeds?.reduce((sum, track) => sum + (track.value(seconds) || 0), 0) ?? 0;
  const line = session.line;
  const lineText = `Pos: (${lineInfoNumber(state.x)},${lineInfoNumber(state.y)})  Dir: ${lineInfoNumber(state.rotation)}  Alpha: ${lineInfoNumber(state.alpha, 0)}  Speed: ${lineInfoNumber(scrollSpeed)}`;
  const dt = 1 / 120;
  const before = lineInfoScene.sampler(seconds - dt)(session.lineIndex) ?? state;
  const after = lineInfoScene.sampler(seconds + dt)(session.lineIndex) ?? state;
  const xSpeed = (after.x - before.x) / (2 * dt) / 120;
  const ySpeed = (after.y - before.y) / (2 * dt) / 120;
  const rotateSpeed = (after.rotation - before.rotation) / (2 * dt);
  const activeSpeeds = [];
  for (const [type, label] of [['moveXEvents', 'X'], ['moveYEvents', 'Y'], ['rotateEvents', 'R'], ['speedEvents', 'Speed']]) {
    for (const track of runtime?.tracks?.[type] ?? []) {
      for (const entry of track.events ?? []) {
        if (seconds < entry.start || seconds > entry.end) continue;
        const rate = selectedEventSpeed(type, entry.event);
        if (rate) activeSpeeds.push(rate);
        else if (type === 'speedEvents') activeSpeeds.push(`${label} ${lineInfoNumber(track.value(seconds))}`);
      }
    }
  }
  const selectedSpeeds = [];
  for (const key of session.eventSelection ?? []) {
    const separator = key.lastIndexOf(':');
    const type = separator < 0 ? key : key.slice(0, separator);
    const index = Number(key.slice(separator + 1));
    const event = eventList(session, type)[index];
    const speed = selectedEventSpeed(type, event);
    if (speed) selectedSpeeds.push(speed);
  }
  const eventSpeed = selectedSpeeds.length ? selectedSpeeds : activeSpeeds;
  const eventText = `X Y R Speed: ${lineInfoNumber(xSpeed)}, ${lineInfoNumber(ySpeed)}, ${lineInfoNumber(rotateSpeed)}${eventSpeed.length ? `\nEvent Speed: ${eventSpeed.slice(0, 6).join(', ')}` : ''}`;
  const globalShaders = [];
  for (const index of session.chart.judgeLineList?.keys?.() ?? []) {
    const eventBeat = tempo.beat(seconds, session.chart.judgeLineList[index]?.bpmfactor ?? 1);
    for (const event of shaderEvents(session.chart, index)) {
      if (!event.global) continue;
      const start = beatValue(event.startTime); const end = beatValue(event.endTime ?? event.startTime);
      if (eventBeat >= start && eventBeat < end) globalShaders.push(shaderIdentity(event));
    }
  }
  const shaderText = globalShaders.length ? `\nShader: ${globalShaders.join(', ')}` : '';
  overlay.textContent = `${lineText}\n${eventText}${shaderText}`;
  overlay.hidden = false;
}

function renderSession() {
  editorSkinState({ dirty: session.history.dirty || assetDirty, location: atHome ? 'home' : 'editor', mode: globalEvents.active ? 'global-events' : noiseEditor.active ? 'noise' : session.multiLineActive ? 'multi-' + session.multiLineMode : timeline.notesOnly ? 'notes' : 'notes-events' });
  const editor = element('.editor');
  noiseEditor.syncChrome();
  editor.classList.toggle('multi-notes', session.multiLineActive && session.multiLineMode === 'notes');
  editor.classList.toggle('multi-events', session.multiLineActive && session.multiLineMode === 'events');
  const context = `${session.lineIndex}:${timeline.layer}`;
  if (placementContext !== context) { timeline.cancelPlacement(); placementContext = context; }
  if (tempoEntries !== session.chart.BPMList) { tempoEntries = session.chart.BPMList; tempo = new TempoMap(tempoEntries); }
  timeline.tempo = tempo;
  session.tempo = tempo; session.division = timeline.division;
  session.cutDensity = Number(element('#event-cut-density').value);
  session.dragSensitivity = Number(element('#event-drag-sensitivity').value);
  updateLineInfo();
  session.eventWheelSteps = Object.fromEntries(['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents', 'scaleXEvents', 'scaleYEvents'].flatMap((key, index) => Number.isFinite(preferences.originalSettings.scrollValueIncrement?.[index]) ? [[key, preferences.originalSettings.scrollValueIncrement[index]]] : []));
  timeline.origin = currentBeat();
  element('#document-name').textContent = atHome ? t('app.sc3dbce4') : `${session.history.dirty ? '● ' : ''}${chartTitle()}`;
  renderTimelineMarkers();
  element('#note-count').textContent = `${session.notes.length} notes`;
  const countEvents = line => [...(line.eventLayers ?? []), line.extended ?? {}].reduce((total, layer) => total + Object.entries(layer ?? {}).filter(([type, events]) => type !== 'paintEvents' && Array.isArray(events)).reduce((count, [, events]) => count + events.length, 0), 0) + shaderEvents(session.chart, session.chart.judgeLineList?.indexOf(line) ?? -1).length;
  const totalLines = session.chart.judgeLineList?.length ?? 0;
  const totalNotes = (session.chart.judgeLineList ?? []).reduce((count, line) => count + (line.notes?.length ?? 0), 0);
  const totalEvents = (session.chart.judgeLineList ?? []).reduce((count, line) => count + countEvents(line), 0);
  const chartInfo = [[t('app.sd3892f9'), `Notes: ${session.notes.length}  Events: ${countEvents(session.line ?? {})}  TotalLines: ${totalLines}  TotalNotes: ${totalNotes}  TotalEvents: ${totalEvents}  Time: ${formatEditTime(editTimeSeconds)}`]];
  element('#chart-info').replaceChildren(...chartInfo.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    return [term, description];
  }));
  const songName = session.chart.META?.song;
  const backgroundName = session.chart.META?.background;
  const missingMedia = [!songName || !assets.has(songName) ? t('app.safb3c40') : '', !backgroundName || !assets.has(backgroundName) ? t('app.sb8bb31e') : ''].filter(Boolean);
  const materialHint = element('#chart-material-hint');
  if (materialHint) materialHint.textContent = missingMedia.length ? t('app.s1674bb2', { p0: missingMedia.join('、') }) : '';
  const mediaStatus = element('#metadata-media-status');
  if (mediaStatus) mediaStatus.textContent = t('app.s40fd2fc', { p0: songName && assets.has(songName) ? songName : t('app.sab8115f'), p1: backgroundName && assets.has(backgroundName) ? backgroundName : t('app.sab8115f') });
  syncProjectFolderButton();
  if (!session.liveBeatEdit) element('#offset').value = session.chart.META.offset ?? 0;
  element('#selection-info').textContent = session.focus === 'events' ? t('app.sa922b31', { p0: session.eventSelection.size }) : t('app.s4112683', { p0: session.selection.size });
  element('#undo').disabled = !session.history.undoStack.length;
  element('#redo').disabled = !session.history.redoStack.length;
  element('#batch-run').disabled = !session.selection.size;
  element('#line-select').replaceChildren();
  (session.chart.judgeLineList ?? []).forEach((line, index) => {
    const option = document.createElement('option'); option.value = index; option.textContent = lineDisplayLabel(session.chart, index); element('#line-select').append(option);
  });
  element('#line-select').value = session.lineIndex;
  element('#multi-line-toggle').classList.toggle('active', session.multiLineActive);
  element('#multi-line-toggle').setAttribute('aria-pressed', String(session.multiLineActive));
  element('#notes-only').disabled = session.multiLineActive || noiseEditor.active || globalEvents.active;
  element('#multi-line-count').textContent = session.multiLineActive ? session.multiLineIndices.length : 0;
  element('#multi-line-merge').classList.toggle('active', session.multiLineMerge && session.multiLineMode === 'notes');
  element('#multi-line-merge').disabled = !session.multiLineActive || session.multiLineMode !== 'notes';
  const hasLines = session.multiLineActive && session.multiLineIndices.length;
  element('#multi-line-prev-add').disabled = !hasLines || session.multiLineIndices.length >= session.chart.judgeLineList.length;
  element('#multi-line-next-add').disabled = !hasLines || session.multiLineIndices.length >= session.chart.judgeLineList.length;
  element('#multi-line-prev-remove').disabled = !hasLines;
  element('#multi-line-next-remove').disabled = !hasLines;
  element('#line-next').disabled = element('#line-previous').disabled = session.chart.judgeLineList.length < 2;
  const lineGroup = element('#line-group-label');
  if (lineGroup) { const line = session.line; lineGroup.textContent = line && !isDefaultLineGroup(session.chart, line) ? lineGroupName(session.chart, line) : ''; lineGroup.title = lineGroup.textContent ? t('app.s595b038', { p0: lineGroup.textContent }) : ''; }
  if (activePaneName === 'lines') linePanel.render();
  updateLayerButtons();
  const liveIssues = diagnose(session.chart);
  const liveSignature = liveIssues.map(issue => `${issue.severity}:${issue.path}:${issue.message}`).sort().join('|');
  if (lastDiagnosticSignature !== null && liveSignature !== lastDiagnosticSignature && activePaneName !== 'diagnose') {
    const previous = new Set(lastDiagnosticSignature.split('|').filter(Boolean));
    const addedErrors = liveIssues.filter(issue => issue.severity === 'error' && !previous.has(`${issue.severity}:${issue.path}:${issue.message}`));
    if (addedErrors.length) notify(t('app.sd10d488', { p0: addedErrors.length }), 'error', 4200);
  }
  lastDiagnosticSignature = liveSignature;
  if (activePaneName === 'diagnose') renderDiagnostics();
  if (activePaneName === 'history') renderHistoryPanel();
  if (activePaneName === 'multi') multiEdit.sync();
  if (noiseTrackingPanel.active) noiseTrackingPanel.sync();
  if (activePaneName === 'multi-line') multiLinePanel.render();
  if (noiseEditor.active) noiseEditor.render();
  if (globalEvents.active) globalEvents.render();
  if (activePaneName === 'metadata') renderMetadataPanel(session, element('#metadata-editor'), () => { activatePane('chart'); renderSession(); });
  if (activePaneName === 'bpm') renderBpmPanel(session, element('#bpm-editor'));
  session.eventLayer = timeline.layer;
  renderProperties(session, reportError);
  if (!session.liveEventEdit) renderEventInspector(session, tempo, currentBeat, reportError, notify, eventSampler);
  if (session.eventSelection.size) {
    timeline.eventPlacementType = session.eventSelection.values().next().value.split(':')[0];
  }
  const multiEventSignature = [...(session.multiEventSelection ?? new Map())].map(([line, values]) => `${line}:${[...values].sort().join(',')}`).sort().join('|');
  const multiNoteSignature = [...(session.multiLineSelection ?? new Map())].map(([line, values]) => `${line}:${[...values].sort((left, right) => left - right).join(',')}`).sort().join('|');
  const selectionSignature = `${session.lineIndex}:${session.eventLayer}|${session.focus}|${[...session.selection].sort((left, right) => left - right).join(',')}|${[...session.eventSelection].sort().join(',')}|${multiNoteSignature}|${multiEventSignature}`;
  if (selectionSignature !== lastSelectionSignature) {
    lastSelectionSignature = selectionSignature;
    const selectionCount = session.focus === 'events'
      ? (session.multiLineActive && session.multiLineMode === 'events'
        ? Math.max(session.eventSelection.size, [...(session.multiEventSelection ?? new Map()).values()].reduce((total, values) => total + values.size, 0))
        : session.eventSelection.size)
      : (session.multiLineActive && session.multiLineMode === 'notes'
        ? [...(session.multiLineSelection ?? new Map()).values()].reduce((total, values) => total + values.size, 0)
        : session.selection.size);
    if (globalEvents.active) globalEvents.render();
    else if (noiseEditor.active) noiseEditor.render();
    else if (multiEdit.committing) multiEdit.sync();
    else if (activePaneName === 'collaboration') collaboration.renderState();
    else if (textLinesPanel.active) textLinesPanel.sync();
    else if (noiseFitPanel.active) noiseFitPanel.sync();
    else if (noiseTrackingPanel.active) noiseTrackingPanel.sync();
    else if (trajectoryPanel.active && selectionCount !== 1) activatePane('trajectory');
    else if (curveEditorOpen) activatePane('curve');
    else if (activePaneName === 'clipboard') renderClipboardPanel();
    else if (selectionCount > 1) { activatePane('multi'); multiEdit.open(session.focus === 'events' ? 'events' : 'notes'); }
    else if (selectionCount === 1) {
      const entries = session.multiLineActive && session.multiLineMode === 'events'
        ? [...session.multiEventSelection].flatMap(([lineIndex, keys]) => [...keys].map(key => ({ lineIndex, key })))
        : [...session.eventSelection].map(key => ({ lineIndex: session.lineIndex, key }));
      const selected = entries.length === 1 ? entries[0] : null;
      const [type, index] = selected?.key.split(':') ?? [];
      const event = session.chart.judgeLineList[selected?.lineIndex]?.eventLayers?.[timeline.layer]?.[type]?.[Number(index)];
      if (session.focus === 'events' && event?.trajectory) { curveEditorOpen = false; trajectoryPanel.open(event, selected.lineIndex, timeline.layer); }
      else activatePane(session.focus === 'events' ? 'events' : 'notes');
    }
    else if (!['multi-line', 'lines', 'assets', 'collaboration', 'version-control'].includes(activePaneName)) activatePane('chart');
  }
  const limits = previewLimitations(session.chart);
  element('#compatibility').textContent = t('app.s22feffd') + (limits.length ? t('app.s7f51215', { p0: limits.join('、') }) : '');
  invalidate();
  globalEvents.syncChrome();
  versionControl?.tick?.();
}

session.addEventListener('change', renderSession);

function replaceChart(chart, name, nextAssets = new Map(), nextFolders = [], options = {}) {
  assertChart(chart);
  if (!options.preserveRepoId) { versionRepoId = crypto.randomUUID(); versionControl?.detach(); }
  if (eventSampler.active) eventSampler.finish(false);
  noiseEditor.reset();
  globalEvents.reset();
  noiseFitPanel.reset();
  noiseTrackingPanel.reset();
  if (!collaborationJoining && collaboration.client.active) collaboration.client.leave();
  lineSwitcher.reset();
  playback.pause(); audio.clear();
  audioAnalysis.setBuffer(null);
  hitSounds.stop(); hitSounds.onlyCurrentLine = false; element('#mute-current-line').setAttribute('aria-pressed', 'false'); element('#mute-current-line').classList.remove('active'); images.clear(); libraryProject = null;
  session.removeEventListener('change', renderSession);
  session = new EditorSession(chart);
  if (options.dirty) session.history.markUnsaved();
  clipboardHistory.attach(session);
  lastSelectionSignature = '';
  activatePane('chart');
  session.history.limit = preferences.settings.historyLimit;
  session.addEventListener('change', renderSession);
  recoveryId = crypto.randomUUID();
  lastDraftDocument = undefined; lastDraftAssets = []; lastDraftFolders = [];
  autoSave.reset(performance.now());
  heldPreview = null; curveStart = null; curveEnd = null; curveAnchorMode = null; curveEditorOpen = false; loop = null; element('#loop-enabled').checked = false;
  assets = nextAssets;
  for (const renderer of [preview, realtimePreview]) { renderer.noisePreview.gpu?.clearSkins(); renderer.overflowNoisePreview?.gpu?.clearSkins(); renderer.overflowRevision++; }
  assetFolders = new Set(nextFolders ?? []);
  assetDirty = Boolean(options.dirty);
  chartName = name;
  resetEditClock(chart);
  hitSounds.setProject(chart, assets, name);
  images.load(chart, assets, name);
  timeline.origin = 0;
  timeline.layer = 0;
  timeline.cancelPlacement();
  preview.visible = false; element('.preview-wrap').hidden = true; element('#view-toggle').classList.remove('active');
  element('#preview-title').textContent = chartDisplayName(chart.META.name);
  element('#music-name').textContent = t('app.sbefb963');
  element('#scrubber').max = 600;
  renderSession();
  hasDocument = true; setHome(false);
  status(t('app.s5e07c0a', { p0: name }));
}

function guardReplace(action) {
  noiseEditor.flush();
  if (hasDocument && (session.history.dirty || assetDirty)) confirmAction(t('app.s13472be'), action);
  else action();
}

async function loadCandidate(candidate, nextAssets, options = {}) {
  attachExternalEffects([candidate], nextAssets);
  replaceChart(candidate.chart, candidate.name, nextAssets, options.folders ?? candidate.project?.assetFolders ?? [], options);
  libraryProject = candidate.project ?? null;
  if (candidate.project?.vcsId) versionRepoId = candidate.project.vcsId;
  syncProjectFolderButton();
  images.load(candidate.chart, assets, chartName, candidate.info);
  const references = resourceReferences(candidate.chart, assets, chartName, candidate.info);
  const bytes = assetBytes(assets, references.song, chartName);
  if (bytes) await loadMusic(bytes, references.song, false);
  else if (references.song) status(t('app.s54ac1d5', { p0: references.song }));
  if (session.chart === candidate.chart && candidate.project?.viewState) {
    const view = candidate.project.viewState;
    if (Number.isInteger(view.lineIndex) && session.chart.judgeLineList?.[view.lineIndex]) session.selectLine(view.lineIndex);
  }
  if (session.chart === candidate.chart && candidate.chart.rpeNextLegacySource?.format === 'phigros-v3') notify(t('app.s2882e27', { p0: candidate.chart.judgeLineList.length, p1: candidate.chart.blockAreaList?.length ?? 0 }), 'success');
}

function loadVersionSnapshot(snapshot, { force = false } = {}) {
  const project = libraryProject;
  const run = () => loadCandidate(
    { chart: snapshot.chart, name: snapshot.chartName ?? chartName, project },
    snapshot.assets,
    { preserveRepoId: true, folders: snapshot.folders, dirty: true }
  );
  if (force || !hasDocument || (!session.history.dirty && !assetDirty)) return run();
  return new Promise((resolve, reject) => {
    showDialog(t('app.s13472be'), t('app.s47a52ce'));
    const modal = element('#modal');
    const apply = element('#modal-apply');
    let done = false;
    apply.hidden = false;
    apply.textContent = t('app.s1fc1afc');
    modal.addEventListener('close', () => { if (!done) { done = true; resolve(); } }, { once: true });
    apply.onclick = () => { done = true; modal.close(); run().then(resolve, reject); };
  });
}

async function loadMusic(bytes, name, updateMetadata = true, recordHistory = true) {
  const chartPosition = chartSeconds();
  playback.pause();
  const loadingSession = session;
  const loaded = await audio.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name);
  if (!loaded || session !== loadingSession) return false;
  audioAnalysis.setBuffer(audio.buffer);
  assets.set(name, bytes);
  element('#music-name').textContent = name;
  element('#scrubber').max = audio.duration;
  renderTimelineMarkers();
  if (updateMetadata) {
    assetDirty = true;
    if (recordHistory) session.commit(t('app.s47261a4'), { ...session.chart, META: { ...session.chart.META, song: name } });
    else session.replaceMusicResource(name);
  }
  playback.seek(chartPosition + offsetSeconds());
  return true;
}

function prependAudioSilence() {
  if (!audio.buffer) { notify(t('app.s510310b'), 'error'); return; }
  const targetSession = session; const buffer = audio.buffer; const revision = audio.loadRevision;
  const first = [...session.chart.BPMList].sort((left, right) => beatValue(left.startTime) - beatValue(right.startTime))[0];
  const seconds = 240 / Number(first?.bpm);
  if (!(seconds > 0 && Number.isFinite(seconds))) { notify(t('app.s3820b91'), 'error'); return; }
  showDialog(t('app.s9329c06'), t('app.sa860bb7', { p0: first.bpm, p1: Number(seconds.toFixed(3)) }));
  const apply = element('#modal-apply'); apply.hidden = false; apply.textContent = t('app.s95f5c3a');
  apply.onclick = async () => {
    element('#modal').close();
    const button = element('#audio-leading-silence'); button.disabled = true; button.textContent = t('app.se86312b');
    const cancelled = () => session !== targetSession || audio.loadRevision !== revision;
    try {
      if (cancelled()) return;
      playback.pause();
      const wave = await pcmWave(buffer, cancelled, seconds);
      if (!wave || cancelled()) return;
      const bytes = new Uint8Array(await wave.arrayBuffer());
      if (cancelled()) return;
      const sourceName = resourceReferences(session.chart, assets, chartName).song || 'music';
      const stem = sourceName.replaceAll('\\', '/').split('/').at(-1).replace(/\.[^.]+$/, '') + '-leading';
      let name = stem + '.wav'; let suffix = 2;
      while (assetBytes(assets, name, chartName)) name = `${stem}-${suffix++}.wav`;
      if (await loadMusic(bytes, name, true, false)) notify(t('app.sad632ef'), 'success');
    } catch (error) { reportError(error); }
    finally { button.disabled = false; button.textContent = t('app.s763d8cd'); invalidate(); }
  };
}

function seekBeat(value, pause = true) {
  playback.seek(tempo.seconds(value, noiseEditor.active || globalEvents.active ? 1 : session.line?.bpmfactor ?? 1) + (session.chart.META.offset ?? 0) / 1000, pause);
  invalidate();
}

async function togglePlayback() {
  if (!audio.playing && !playback.pending) preview.effectsSince = realtimePreview.effectsSince = chartSeconds() - 0.001;
  await playback.toggle(session.chart);
  invalidate();
}

function save() {
  noiseEditor.flush();
  if (!persistenceRequested) { persistenceRequested = true; requestPersistence().then(() => storagePanel.refresh()).catch(() => {}); }
  editorSkinSignal('save-started');
  mods?.runtime.emit('editor:save-started',{});
  const savingSession = session;
  return manualSaves.save(savingSession, () => {
    const document = session.chart; const snapshot = { ...document }; delete snapshot.chartTime;
    const project = { ...(libraryProject ?? { id: crypto.randomUUID(), source: t('app.s70d7944'), imported: Date.now() }),
      chart: snapshot, chartName, vcsId: versionRepoId, assets: [...assets], assetFolders: [...assetFolders], bytes: [...assets.values()].reduce((sum, bytes) => sum + bytes.length, 0), updated: Date.now(), viewState: { lineIndex: session.lineIndex } };
    status(t('app.se64da0d'));
    return { document, project };
  }, ({ document, project }) => {
    savingSession.history.markSaved(document);
    if (session !== savingSession) return;
    libraryProject = project;
    noteLibrarySave(); storagePanel.refresh().catch(() => {});
    assetDirty = assets.size !== project.assets.length || project.assets.some(([name, bytes]) => assets.get(name) !== bytes)
      || assetFolders.size !== project.assetFolders.length || project.assetFolders.some(folder => !assetFolders.has(folder));
    renderSession();
    const message = session.history.dirty || assetDirty ? t('app.s46644e0') : t('app.s09bce60');
    status(message); notify(message, 'success'); editorSkinSignal('save-succeeded');mods?.runtime.emit('editor:save-succeeded',{message});
  }).catch(error => { editorSkinSignal('save-failed');mods?.runtime.emit('editor:save-failed',{error}); throw error; });
}

function validateCommit(label, next) { assertChart(next); session.commit(label, next); }

function editEvent(type, index, beat = currentBeat()) {
  if (!session.line) { status(t('app.sb9277d1')); return; }
  timeline.eventPlacementType = type;
  timeline.extended = !EVENT_TYPES.includes(type);
  timeline.indexedLayer = null;
  session.focus = 'events'; session.eventLayer = timeline.layer; session.selection.clear();
  activatePane('events');
  if (index !== null) { session.eventSelection = new Set([eventKey(type, index)]); session.notify(); return; }
  timeline.eventInteraction.place(type, beat);
  status(timeline.eventInteraction.pending ? t('app.s5d00864') : t('app.sbf92ebb'));
}

listen('#new', () => guardReplace(() => replaceChart(createChart(), 'chart.json')));
listen('#home-new', () => element('#new').click());
listen('#home-open', () => element('#open').click());
listen('#home-migrate', () => element('#migrate').click());
listen('#resume-editor', () => setHome(false));
listen('#open', () => { element('#file-input').click(); });
element('#file-input').addEventListener('change', async event => {
  try {
    const loaded = await openFiles(event.target.files, { ...fileOptions(), confirmLargeArchive: info => new Promise(resolve => {
      const host = showDialog(t('app.sfa57b17'), t('app.s3e6d0c4', { p0: (info.declaredBytes / 1024 ** 2).toFixed(1), p1: info.count }));
      const modal = host.closest('dialog'), apply = element('#modal-apply'); let decided = false;
      modal.addEventListener('close', () => { if (!decided) resolve(false); }, { once: true });
      apply.hidden = false; apply.textContent = t('app.s797d0a5');
      apply.onclick = () => { decided = true; modal.close(); resolve(true); };
    }) });
    if (!loaded) return;
    const proceed = () => {
      if (loaded.candidates.length === 1) loadCandidate(loaded.candidates[0], loaded.assets).catch(reportError);
      else choose(t('app.s47008a9'), t('app.sb2a3d63'), loaded.candidates, candidate => `${candidate.name} · ${candidate.chart.META.name ?? ''}`, candidate => loadCandidate(candidate, loaded.assets));
    };
    guardReplace(proceed);
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
listen('#save', () => save());
listen('#export', () => { noiseEditor.flush(); showExportDialog(session.chart, assets, chartName, (name, format) => { status(t('app.s94b8e7e', { p0: name })); if (format === 'pez') { noteExternalBackup(); storagePanel.refresh().catch(() => {}); } }, libraryProject?.identifier ?? libraryProject?.info?.Path, fileOptions()); });
listen('#view-toggle', () => togglePreview());
listen('#close-preview', () => togglePreview(false, true));
listen('#background', () => element('#background-input').click());
element('#background-input').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    const loadingSession = session;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (session !== loadingSession) return;
    assets.set(file.name, bytes);
    session.commit(t('app.s3ace90d'), { ...session.chart, META: { ...session.chart.META, background: file.name } });
    await images.load(session.chart, assets, chartName);
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
listen('#music', () => element('#music-input').click());
element('#music-input').addEventListener('change', async event => {
  try {
    const loadingSession = session;
    const file = event.target.files[0];
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (session === loadingSession) await loadMusic(bytes, file.name);
    }
  }
  catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
listen('#recover', async () => {
  const drafts = await listDrafts(atHome ? null : (libraryProject?.id ?? recoveryId));
  choose(t('app.s4d3e2db'), drafts.length ? t('app.s413ad27') : t('app.s96b0de9'), drafts,
    draft => `${draft.title} · ${new Date(draft.updated).toLocaleString()}`,
    entry => { guardReplace(async () => {
      try {
        const draft = await readDraft(entry.id);
        if (!draft) throw new Error(t('app.s2dee158'));
        await loadCandidate({ chart: draft.chart, name: draft.name, project: { viewState: draft.viewState, vcsId: draft.viewState?.vcsId } }, new Map(draft.assets ?? []));
        libraryProject = null; session.history.savedDocument = null; renderSession();
      } catch (error) { reportError(error); }
    }); });
});
listen('#play', togglePlayback);
listen('#rewind', () => seekBeat(0));
listen('#seek', () => seekBeat(beatValue(parseBeat(element('#seek-beat').value))));
element('#scrubber').addEventListener('input', event => playback.seek(Number(event.target.value)));
element('#rate').addEventListener('change', event => audio.setRate(Number(event.target.value)));
element('#offset').addEventListener('change', event => {
  const value = Number(event.target.value);
  if (!Number.isFinite(value)) { event.target.value = session.chart.META.offset ?? 0; return; }
  const chartPosition = chartSeconds();
  session.commit(t('app.s2f6297b'), { ...session.chart, META: { ...session.chart.META, offset: value } });
  playback.seek(chartPosition + value / 1000);
});
element('#chart-info-toggle').addEventListener('click', event => {
  const info = element('#chart-info'); info.hidden = !info.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!info.hidden));
});
element('#volume').addEventListener('input', event => { audio.setVolume(Number(event.target.value)); persistEditor(); });
element('#preview-mode').addEventListener('change', event => { preview.allLines = realtimePreview.allLines = event.target.value === 'all'; persistEditor(); invalidate(); });
for (const [selector, property, minimum, maximum, integer] of [['#division', 'division', 1, 100, true], ['#grid-count', 'gridCount', 2, 100, false], ['#y-scale', 'scale', 20, 2000, false]]) {
  element(selector).addEventListener('change', event => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) timeline[property] = Math.max(minimum, Math.min(maximum, integer ? Math.round(value) : value));
    event.target.value = timeline[property]; session.division = timeline.division; updateCurvePanel(); persistEditor(); invalidate();
    if (property === 'scale') element('#y-scale-slider').value = timeline.scale;
  });
}
element('#y-scale-slider').addEventListener('input', event => {
  timeline.scale = Number(event.target.value); element('#y-scale').value = timeline.scale; persistEditor(); invalidate();
});
element('#snap-x').addEventListener('change', event => { timeline.snapX = event.target.checked; persistEditor(); invalidate(); });
function updateLayerButtons() {
  const container = element('#layer');
  if (!container.children.length) for (let index = 0; index <= MAX_BASE_LAYERS; index++) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = index === MAX_BASE_LAYERS ? t('app.s20d7a24') : String(index);
    button.onclick = () => {
      timeline.cancelPlacement(); timeline.extended = index === MAX_BASE_LAYERS;
      if (!timeline.extended) timeline.layer = index;
      timeline.indexedLayer = null; session.eventLayer = timeline.layer; session.eventSelection.clear();
      timeline.eventPlacementType = timeline.eventTypes[0]; session.notify();
    };
    container.append(button);
  }
  const bottom = timeline.beatAt(timeline.notesCanvas.clientHeight); const top = timeline.beatAt(0);
  timelineActivity.compile(session.chart, tempo);
  [...container.children].forEach((button, index) => {
    const state = timelineActivity.layerState(session.lineIndex, index, index === MAX_BASE_LAYERS, bottom, top, timeline.eventBeatAt(timeline.notesCanvas.clientHeight, 'paintEvents'), timeline.eventBeatAt(0, 'paintEvents'));
    button.dataset.state = state;
    button.classList.toggle('active', timeline.extended ? index === MAX_BASE_LAYERS : index === timeline.layer);
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.title = t('app.s1e8776f', { p0: index === MAX_BASE_LAYERS ? t('app.s0804a42') : t('app.sfb282c2', { p0: index }), p1: state === 'empty' ? t('app.s1525642') : state === 'visible' ? t('app.s9728cde') : t('app.sc6758d7') });
  });
}
element('#line-select').addEventListener('change', event => { timeline.cancelPlacement(); session.selectLine(Number(event.target.value)); });
listen('#line-next', () => switchLine(1));
listen('#line-previous', () => switchLine(-1));
element('#hit-volume').addEventListener('input', event => { hitSounds.setVolume(Number(event.target.value)); persistEditor(); });
element('#hit-enabled').addEventListener('change', event => { hitSounds.enabled = event.target.checked; hitSounds.stop(); persistEditor(); });
element('#mute-current-line').addEventListener('click', () => {
  hitSounds.onlyCurrentLine = !hitSounds.onlyCurrentLine;
  const button = element('#mute-current-line');
  button.setAttribute('aria-pressed', String(hitSounds.onlyCurrentLine));
  button.classList.toggle('active', hitSounds.onlyCurrentLine);
  hitSounds.stop(); invalidate();
});
element('#realtime-enabled').addEventListener('change', event => { realtimePreview.visible = event.target.checked; element('#realtime-preview').hidden = !event.target.checked; persistEditor(); invalidate(); });
element('#realtime-alpha').addEventListener('input', event => { realtimePreview.opacity = Number(event.target.value); persistEditor(); invalidate(); });
for (const selector of ['#loop-start', '#loop-end', '#loop-enabled']) element(selector).addEventListener('change', () => {
  try {
    const start = beatValue(parseBeat(element('#loop-start').value));
    const end = beatValue(parseBeat(element('#loop-end').value));
    if (start < 0 || end <= start) throw new Error(t('app.s982f6d2'));
    loop = element('#loop-enabled').checked ? { start, end } : null;
  } catch (error) { loop = null; element('#loop-enabled').checked = false; reportError(error); }
});
for (const button of document.querySelectorAll('[data-tool]')) button.onclick = () => {
  timeline.cancelPlacement();
  timeline.tool = Number(button.dataset.tool);
  for (const item of document.querySelectorAll('[data-tool]')) item.classList.toggle('active', item === button);
  invalidate();
};
function travel(direction, silent = false) {
  globalEvents.timeline.cancelPlacement();
  noiseEditor.cancelGesture(); noiseEditor.endSample(false);
  timeline.cancelPlacement();
  const stack = direction === 'undo' ? session.history.undoStack : session.history.redoStack;
  const command = stack.at(-1);
  if (!command) { notify(direction === 'undo' ? t('app.s5f3dcc0') : t('app.s89594eb'), 'warning'); return; }
  session.travel(direction);
  if (!silent) notify(t('app.sf1164c8', { p0: direction === 'undo' ? t('app.s9fcefd8') : t('app.s1238f0d'), p1: command.label }), 'success');
}
listen('#undo', () => travel('undo'));
listen('#redo', () => travel('redo'));
listen('#curve-notes', openCurvePanel);
listen('#curve-trajectory', () => { curveEditorOpen = false; trajectoryPanel.open(); });
listen('#text-lines-tool', () => {
  if (globalEvents.active) globalEvents.close();
  if (noiseEditor.active) noiseEditor.close();
  timeline.cancelPlacement(); batchControls.cancel(); pasteGesture.cancel(); curveEditorOpen = false; textLinesPanel.open();
});
listen('#noise-fit-tool', () => {
  if (globalEvents.active) globalEvents.close();
  if (noiseEditor.active) noiseEditor.close();
  timeline.cancelPlacement(); batchControls.cancel(); pasteGesture.cancel(); curveEditorOpen = false; noiseFitPanel.open();
});
listen('#noise-tracking-tool', () => {
  if (globalEvents.active) globalEvents.close();
  if (noiseEditor.active) noiseEditor.close();
  timeline.cancelPlacement(); batchControls.cancel(); pasteGesture.cancel(); clearNoteSourceToast(); curveEditorOpen = false; noiseTrackingPanel.open();
});
listen('#curve-start', () => captureCurve(false));
listen('#curve-end', () => captureCurve(true));
function switchNoteView() {
  if (session.multiLineActive || noiseEditor.active || globalEvents.active) return;
  timeline.cancelPlacement(); timeline.hoverArea = 'notes'; session.focus = 'notes';
  activatePane('notes');
  editorPreferences.notesOnly = !timeline.notesOnly;
  applyDisplaySettings(); persistEditor(); session.notify();
}
function resetCamera(resetPreview = false) {
  editorPreferences.cameraX = 0;
  if (resetPreview) editorPreferences.viewDivisor = 1;
  applyDisplaySettings(); persistEditor();
}
function captureCurve(end) {
  if (preview.visible) return;
  if (!curveEditorOpen) openCurvePanel();
  curveAnchorMode = end ? 'end' : 'start';
  if (end && !curveStart) { curveAnchorMode = null; throw new Error(t('app.se232390')); }
  element('#curve-start')?.classList.toggle('active', !end);
  element('#curve-end')?.classList.toggle('active', end);
  status(end ? t('app.s6737539') : t('app.s96cf478'));
}
listen('#notes-only', switchNoteView);
listen('#reset-camera', () => resetCamera(true));
listen('#game-ui', () => { editorPreferences.showGameUI = !preview.showGameUI; applyDisplaySettings(); persistEditor(); });
element('#preview-ratio').onchange = event => {
  [editorPreferences.ratioWidth, editorPreferences.ratioHeight] = event.target.value.split(':').map(Number);
  applyDisplaySettings(); persistEditor();
};
for (const [id, key] of [['camera-x', 'cameraX'], ['view-divisor', 'viewDivisor']]) element(`#${id}`).onchange = event => {
  if (!event.target.value.trim() || !event.target.validity.valid) { applyDisplaySettings(); return; }
  editorPreferences[key] = Number(event.target.value); applyDisplaySettings(); persistEditor();
};
element('#toolbar-mode').onclick = () => {
  const modes = ['compact', 'icons', 'wide'];
  const current = editorPreferences.toolbarMode ?? 'compact';
  editorPreferences.toolbarMode = modes[(modes.indexOf(current) + 1) % modes.length];
  applyDisplaySettings(); persistEditor();
};
function copySelection() {
  if (globalEvents.active) { globalEvents.copy(); return; }
  if (noiseEditor.active) { noiseEditor.copy(); return; }
  const count = copyObjects(session);
  if (count) { clipboardHistory.remember(session); status(t('app.s44cef9c', { p0: count })); }
  invalidate();
}
function deleteSelection() { if (globalEvents.active) { globalEvents.safely(() => globalEvents.remove()); return; } if (noiseEditor.active) { noiseEditor.remove(); return; } deleteObjects(session); }
function cutSelection() { if (globalEvents.active) { globalEvents.safely(() => globalEvents.copy(true)); return; } if (noiseEditor.active) { noiseEditor.copy(true); return; } if (cutObjects(session)) clipboardHistory.remember(session); invalidate(); }
function pasteSelection(mirror = false, keepTime = false) {
  if (globalEvents.active) { globalEvents.safely(() => globalEvents.paste(keepTime)); return; }
  if (noiseEditor.active) { noiseEditor.action(keepTime ? 'KeepTimePaste' : 'Paste'); return; }
  timeline.clipboardMode = { mirror, keepTime };
  pasteObjects(session, clipboardBeat(timeline), { ...timeline.clipboardMode, targetLineIndex: clipboardTargetLine() });
}
listen('#copy', copySelection);
listen('#cut', cutSelection);
listen('#paste', () => pasteSelection());
for (const [name, description] of BATCH_ACTIONS) {
  const option = new Option(name, name); option.title = description; element('#batch-action').append(option);
}
element('#batch-action').onchange = () => { element('#batch-run').title = BATCH_ACTIONS.find(([name]) => name === element('#batch-action').value)[1]; };
element('#batch-action').onchange();
listen('#batch-run', () => applyBatchAction(session, element('#batch-action').value, timeline.gridCount));
listen('#delete', deleteSelection);
listen('#mirror', () => {
  if (session.focus === 'events') transformEvents(session, t('app.sd39cfc6'), (event, type) => ['moveXEvents', 'rotateEvents'].includes(type) ? { ...event, start: -event.start, end: -event.end } : event);
  else session.transformSelection(t('app.sd8373bc'), note => ({ ...note, positionX: -note.positionX }));
});
function syncProjectFolderButton() {
  const button = element('#open-project-folder');
  button.hidden = !nativeStorage;
  button.disabled = !nativeStorage || !libraryProject?.id;
  button.title = libraryProject?.id ? t('app.s5cf10e1') : t('app.s265de32');
}
listen('#metadata', () => { activatePane('metadata'); renderMetadataPanel(session, element('#metadata-editor'), () => { activatePane('chart'); renderSession(); }); });
listen('#open-project-folder', async () => {
  if (!nativeStorage || !libraryProject?.id) return;
  await nativeStorage.call('openProjectFolder', libraryProject.id);
});
listen('#bpm', () => { activatePane('bpm'); renderBpmPanel(session, element('#bpm-editor')); });
listen('#audio-leading-silence', prependAudioSilence);
listen('#assets', () => { activatePane('assets'); assetLibrary.render(); });
listen('#audio-analysis-tool', () => {
  audioAnalysis.enabled = true; activatePane('audio-analysis'); audioAnalysis.render(element('#audio-analysis-panel')); audioAnalysis.draw(offsetSeconds()); persistEditor();
});
function renderHistoryPanel() {
  const host = element('#history-results'); if (!host) return;
  host.replaceChildren();
  const history = session.history; const current = history.undoStack.length;
  const entries = [{ label: t('app.sc43a712'), index: 0 }, ...history.undoStack.map((command, index) => ({ label: command.label, index: index + 1 })), ...history.redoStack.toReversed().map((command, index) => ({ label: command.label, index: current + index + 1 }))];
  for (const entry of entries) {
    const button = document.createElement('button'); button.type = 'button'; button.className = entry.index === current ? 'active' : ''; button.textContent = `${entry.index === current ? '● ' : ''}${entry.index} · ${entry.label}`;
    button.onclick = () => { const direction = entry.index < current ? 'undo' : 'redo'; for (let count = 0; count < Math.abs(entry.index - current); count++) travel(direction, true); renderHistoryPanel(); notify(t('app.sf2d283b', { p0: entry.index }), 'success', 1800); };
    host.append(button);
  }
}
listen('#history-panel', () => { activatePane('history'); renderHistoryPanel(); });
listen('#version-control-tool', () => activatePane('version-control'));
listen('#clear-clipboard', () => { if (globalEvents.active) { globalEvents.document.editor.eventClipboard = []; globalEvents.document.editor.clipboardVisible = false; invalidate(); return; } noiseEditor.clipboard = null; clipboardHistory.clearCurrent(session); timeline.clipboardMode = {}; invalidate(); });
const clipboardButton = document.createElement('button'); clipboardButton.id = 'clipboard-history'; clipboardButton.textContent = t('app.sb377bb5'); clipboardButton.title = t('app.s4c6bff4');
element('[data-panel="chart"] .action-grid').append(clipboardButton);
function renderClipboardPanel() {
  renderClipboardHistory(element('#clipboard-results'), clipboardHistory, {
    use: id => { clipboardHistory.use(session, id); invalidate(); },
  });
}
function toggleClipboardPanel() {
  if (!clipboardHistory.enabled) return;
  activatePane(activePaneName === 'clipboard' ? 'chart' : 'clipboard'); renderClipboardPanel();
}
listen('#clipboard-history', toggleClipboardPanel);
listen('#clear-clipboard-history', () => clipboardHistory.clearUnpinned());
let clipboardSave = Promise.resolve();
clipboardHistory.addEventListener('change', event => {
  if (activePaneName === 'clipboard' && event.reason !== 'rename') renderClipboardPanel();
  invalidate();
  if (!event.persist) return;
  const entries = structuredClone(clipboardHistory.entries);
  clipboardSave = clipboardSave.then(() => storeClipboardHistory(entries)).catch(error => status(t('app.s205b4b6', { p0: error.message })));
});
readClipboardHistory().then(entries => clipboardHistory.restore(entries)).catch(error => status(t('app.sbabe9e5', { p0: error.message })));
function deleteDiagnosticIssue(issue) {
  if (issue.path.startsWith('paintEvents[')) {
    session.commit(t('app.s35d1128'), replaceShaderEvents(session.chart, issue.line, shaderEvents(session.chart, issue.line).filter((event, index) => index !== issue.index)));
    notify(t('app.s1788c09'), 'success'); return;
  }
  const chart = structuredClone(session.chart);
  if (issue.noiseArea !== undefined) {
    if (issue.noiseTrack) chart.blockAreaList?.[issue.noiseArea]?.[issue.noiseTrack]?.splice(issue.index, 1);
    else chart.blockAreaList?.splice(issue.noiseArea, 1);
  }
  else if (issue.path.startsWith('notes[') && chart.judgeLineList?.[issue.line]) chart.judgeLineList[issue.line].notes.splice(issue.index, 1);
  else if (issue.path === 'father' && chart.judgeLineList?.[issue.line]) chart.judgeLineList[issue.line].father = -1;
  else if (issue.path.startsWith('BPMList[')) chart.BPMList.splice(issue.index, 1);
  else if (issue.line != null && issue.path.match(/^\w+Events\[/)) {
    const type = issue.path.slice(0, issue.path.indexOf('[')); const line = chart.judgeLineList?.[issue.line];
    const layer = issue.extended ? line?.extended : line?.eventLayers?.[issue.layer];
    if (!layer?.[type]) return;
    layer[type].splice(issue.index, 1);
  }
  else return;
  session.commit(t('app.s634fa27'), chart); notify(t('app.s1788c09'), 'success');
}
function renderDiagnostics() {
  const host = element('#diagnose-results'); if (!host) return;
  host.replaceChildren();
  const issues = diagnose(session.chart); const visible = element('#diagnose-show-low')?.checked !== false;
  const signature = issues.map(issue => `${issue.severity}:${issue.path}:${issue.message}`).sort().join('|');
  if (lastDiagnosticSignature !== null && signature !== lastDiagnosticSignature) {
    const previous = new Set(lastDiagnosticSignature.split('|').filter(Boolean));
    const added = issues.filter(issue => !previous.has(`${issue.severity}:${issue.path}:${issue.message}`));
    if (added.some(issue => issue.severity === 'error')) notify(t('app.s8d9e4b5', { p0: added.filter(issue => issue.severity === 'error').length }), 'error', 4200);
    else if (added.some(issue => issue.severity === 'warning')) notify(t('app.sf801b1e', { p0: added.filter(issue => issue.severity === 'warning').length }), 'warning', 3600);
  }
  lastDiagnosticSignature = signature;
  const category = issue => {
    const top = issue.noiseArea !== undefined ? t('app.s81b3bb2') : issue.path.startsWith('notes[') ? t('app.s7ac3289') : issue.path.match(/Events\[/) ? t('app.s550e328') : t('app.s1a26edf');
    const sub = issue.message.includes(t('app.s53bf944')) ? t('app.sdf2ad20') : issue.message.includes(t('app.s00ddbc0')) ? t('app.s00ddbc0') : issue.message.includes(t('app.s29d0552')) ? t('app.s29d0552') : issue.message.includes(t('app.s2249d71')) ? t('app.s2249d71') : t('app.s1a26edf');
    return [top, sub];
  };
  for (const [severity, title] of [['error', t('app.sb859c7b')], ['warning', t('app.s5521e36')], ['info', t('app.sab3656a')]]) {
    const list = issues.filter(issue => issue.severity === severity && (visible || severity !== 'info'));
    const details = document.createElement('details'); details.className = `diagnose-group ${severity}`; details.open = true;
    const summary = document.createElement('summary'); summary.textContent = `${title}（${list.length}）`; details.append(summary);
    const groupedIssues = new Map();
    for (const issue of list) { const [kind, sub] = category(issue); if (!groupedIssues.has(kind)) groupedIssues.set(kind, new Map()); if (!groupedIssues.get(kind).has(sub)) groupedIssues.get(kind).set(sub, []); groupedIssues.get(kind).get(sub).push(issue); }
    for (const [kind, subgroups] of groupedIssues) {
      const parent = document.createElement('details'); parent.className = 'diagnose-subgroup'; parent.open = true;
      const parentSummary = document.createElement('summary'); parentSummary.textContent = `${kind}（${[...subgroups.values()].reduce((sum, entries) => sum + entries.length, 0)}）`; parent.append(parentSummary);
      for (const [sub, grouped] of subgroups) {
        const subgroup = document.createElement('details'); subgroup.className = 'diagnose-subgroup'; subgroup.open = true;
        const subsummary = document.createElement('summary'); subsummary.textContent = `${sub}（${grouped.length}）`; subgroup.append(subsummary);
        for (const issue of grouped) {
          const row = document.createElement('div'); row.className = `diagnose-item ${severity}`;
          const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = t('app.s42c758e', { p0: issue.noiseArea !== undefined ? t('app.s3a2d2c2') + issue.noiseArea : 'Line ' + issue.line, p1: issue.beat, p2: issue.message });
          locate.onclick = () => { if (issue.noiseArea !== undefined) { openNoisePanel(); noiseEditor.select(issue.noiseArea, issue.noiseTrack ? { type: issue.noiseTrack, index: issue.index } : null); } else session.selectLine(issue.line); seekBeat(issue.beat); };
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('app.s3755f56'); remove.disabled = !issue.path.includes('[') && issue.path !== 'father'; remove.onclick = () => deleteDiagnosticIssue(issue);
          row.append(locate, remove); subgroup.append(row);
        }
        parent.append(subgroup);
      }
      details.append(parent);
    }
    host.append(details);
  }
  if (!issues.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('app.sad38555'); host.append(empty); }
}
listen('#diagnose', () => { activatePane('diagnose'); renderDiagnostics(); });
element('#diagnose-show-low').addEventListener('change', renderDiagnostics);
element('#diagnose-close').addEventListener('click', () => activatePane('chart'));
element('#history-close').addEventListener('click', () => activatePane('chart'));

function curveField(id, label, value, type = 'text', options = []) {
  const row = document.createElement('label'); row.className = 'field'; row.append(label);
  const input = type === 'select' ? document.createElement('select') : document.createElement('input');
  input.id = id;
  if (type === 'select') input.replaceChildren(...options.map(([optionValue, optionLabel]) => new Option(optionLabel, optionValue)));
  else { input.type = type; input.step = 'any'; }
  input.value = value; row.append(input);
  if (type === 'number') numericWheel(input, id === 'curve-density' ? 0.25 : 1, direction => { input.value = Number(input.value) + direction * (id === 'curve-density' ? 0.25 : 1); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return row;
}
function generatedCurveCount() {
  if (!curveStart || !curveEnd) return 0;
  try { return generateCurveNotes({ ...curveValues, division: timeline.division }).length; } catch { return 0; }
}
function updateCurvePanel() {
  if (!curveEditorOpen) return;
  const root = element('#curve-editor');
  if (!root.children.length) {
    root.append(curveField('curve-start-time', t('app.sfb9f6db'), formatBeat(curveValues.startTime)), curveField('curve-end-time', t('app.s1e77861'), formatBeat(curveValues.endTime)),
      curveField('curve-start-x', t('app.sf9dc1c1'), curveValues.startX, 'number'), curveField('curve-end-x', t('app.s908b423'), curveValues.endX, 'number'),
      curveField('curve-density', t('app.sf90554a'), curveValues.density, 'number'), curveField('curve-type', t('app.se4e46c7'), curveValues.type, 'select', [['1', 'Tap'], ['3', 'Flick'], ['4', 'Drag']]), curveField('curve-easing', t('app.s6537c87'), curveValues.easingType, 'number'));
    root.addEventListener('input', () => {
      try {
        curveValues = { startTime: parseBeat(element('#curve-start-time').value), endTime: parseBeat(element('#curve-end-time').value), startX: Number(element('#curve-start-x').value), endX: Number(element('#curve-end-x').value), density: Number(element('#curve-density').value), type: Number(element('#curve-type').value), easingType: Number(element('#curve-easing').value) };
        element('#curve-summary').textContent = t('app.s32e6942', { p0: generatedCurveCount() });
        curveEasingPicker.select(curveValues.easingType);
        invalidate();
      } catch (error) { element('#curve-summary').textContent = error.message; }
    });
    const summary = document.createElement('p'); summary.id = 'curve-summary'; summary.className = 'hint'; root.append(summary);
    curveEasingPicker = createEasingPicker(curveValues.easingType, value => { curveValues.easingType = value; updateCurvePanel(); });
    root.append(curveEasingPicker.element);
  }
  const values = [['#curve-start-time', formatBeat(curveValues.startTime)], ['#curve-end-time', formatBeat(curveValues.endTime)], ['#curve-start-x', curveValues.startX], ['#curve-end-x', curveValues.endX], ['#curve-density', curveValues.density], ['#curve-type', curveValues.type], ['#curve-easing', curveValues.easingType]];
  for (const [selector, value] of values) if (document.activeElement !== element(selector)) element(selector).value = value;
  element('#curve-summary').textContent = t('app.s32e6942', { p0: generatedCurveCount() });
  curveEasingPicker.select(curveValues.easingType);
  invalidate();
}
function openCurvePanel() {
  curveEditorOpen = true; curveStart = null; curveEnd = null; curveAnchorMode = null;
  element('#curve-start')?.classList.remove('active'); element('#curve-end')?.classList.remove('active');
  activatePane('curve'); updateCurvePanel(); status(t('app.sd847adc'));
}
function closeCurvePanel() {
  curveEditorOpen = false; curveStart = null; curveEnd = null; curveAnchorMode = null;
  element('#curve-start')?.classList.remove('active'); element('#curve-end')?.classList.remove('active');
  activatePane('chart'); invalidate();
}
listen('#curve-generate', () => {
  try {
    const notes = generateCurveNotes({ ...curveValues, division: timeline.division });
    if (!notes.length) throw new Error(t('app.s2124d24'));
    session.focus = 'notes'; session.eventSelection.clear(); session.insertNotes(notes, t('app.s7f30a53')); closeCurvePanel(); notify(t('app.sac98de3', { p0: notes.length }), 'success');
  } catch (error) { reportError(error); }
});
listen('#curve-cancel', closeCurvePanel);
listen('#help', () => showDialog(t('app.s066b024'), HELP_TEXT));

let playbackSpaceHeld = false;
let lineSwitchDigits = 0;
window.addEventListener('keydown', event => {
  if (mods?.runtime.locks.size) return;
  if (atHome || !hasDocument || !shortcutMatches(event, preferences.hotkeys.ShowLineInfo) || dialogOpen() || usesNativeTextShortcut(event)) return;
  event.preventDefault();
  if (event.repeat) return;
  lineInfoVisible = !lineInfoVisible;
  updateLineInfo();
}, true);
window.addEventListener('blur', () => { lineInfoVisible = false; element('#line-info-overlay')?.setAttribute('hidden', ''); });
window.addEventListener('keydown', event => {
  if (mods?.runtime.locks.size) return;
  if (atHome || !hasDocument || dialogOpen() || usesNativeTextShortcut(event) || isTextEntry(event.target) || !shortcutMatches(event, preferences.hotkeys.Pause)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  playbackSpaceHeld = true;
  if (!event.repeat) togglePlayback().catch(reportError);
}, true);
window.addEventListener('keyup', event => {
  if (mods?.runtime.locks.size) return;
  if (!shortcutReleased(event, preferences.hotkeys.Pause) || !playbackSpaceHeld) return;
  event.preventDefault(); event.stopImmediatePropagation(); playbackSpaceHeld = false;
}, true);
window.addEventListener('blur', () => { playbackSpaceHeld = false; });
function lineSwitchModifierMatches(event) {
  const binding = String(preferences.hotkeys.SwitchLine ?? 'LEFTCTRL').toUpperCase();
  const parts = binding.split(/[&+]/).filter(Boolean).map(part => part.replace(/^(LEFT|RIGHT)/, ''));
  if (!parts.length || parts.some(part => !['CTRL', 'SHIFT', 'ALT'].includes(part))) return false;
  const required = new Set(parts);
  return Boolean(event.ctrlKey) === required.has('CTRL') && Boolean(event.shiftKey) === required.has('SHIFT') && Boolean(event.altKey) === required.has('ALT') && !event.metaKey;
}
window.addEventListener('keydown', event => {
  if (mods?.runtime.locks.size || atHome || !hasDocument || preview.visible || dialogOpen() || usesNativeTextShortcut(event) || event.isComposing || !/^\d$/.test(event.key) || !lineSwitchModifierMatches(event)) return;
  if (shortcutMatches(event, preferences.hotkeys.Paste) || shortcutMatches(event, preferences.hotkeys.PasteMirror)) return;
  lineSwitchDigits = appendLineShortcutDigit(lineSwitchDigits, session.chart.judgeLineList?.length ?? 0, Number(event.key));
  event.preventDefault(); event.stopImmediatePropagation();
  selectOverviewLine(lineSwitchDigits);
}, true);
window.addEventListener('keyup', event => { if (!lineSwitchModifierMatches(event)) lineSwitchDigits = 0; }, true);
window.addEventListener('blur', () => { lineSwitchDigits = 0; });
window.addEventListener('keydown', async event => {
  if (mods?.runtime.locks.size) return;
  const target = event.target;
  if (atHome || !hasDocument || dialogOpen() || usesNativeTextShortcut(event)) return;
  if (batchControls.active) { event.preventDefault(); return; }
  const area = globalEvents.active ? 'events' : timeline.hoverArea ?? session.focus;
  const hasMultiSelection = [...(session.multiLineSelection?.values() ?? [])].some(values => values.size) || [...(session.multiEventSelection?.values() ?? [])].some(values => values.size);
  const hasSelection = globalEvents.active ? globalEvents.selection.size > 0 : noiseEditor.active ? noiseEditor.selection.size > 0 : Boolean(session.selection.size || session.eventSelection.size || hasMultiSelection);
  const action = shortcutAction(event, preferences, area, { hasSelection: hasSelection && !preview.visible });
  if (globalEvents.active) {
    try { if (globalEvents.action(action, event)) { event.preventDefault(); event.stopImmediatePropagation(); return; } }
    catch (error) { event.preventDefault(); reportError(error); return; }
  }
  if (noiseFitPanel.action(action)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (noiseTrackingPanel.action(action)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (noiseEditor.active && (!preview.visible || noiseEditor.sampleMode)) {
    try { if (noiseEditor.action(action)) { event.preventDefault(); event.stopImmediatePropagation(); return; } }
    catch (error) { event.preventDefault(); reportError(error); return; }
  }
    if (action || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) releaseShortcutFocus(target);
  if (pasteGesture.pending && action !== 'Paste') pasteGesture.cancel();
    if (action === 'Paste' && clipboardHistory.enabled && !preview.visible && shortcutMatches(event, preferences.hotkeys.ClipboardHistory ?? DEFAULT_HOTKEYS.ClipboardHistory)) {
    pasteGesture.down(event, { session, chart: session.chart, lineIndex: session.lineIndex, targetLineIndex: clipboardTargetLine(), layer: timeline.layer, beat: clipboardBeat(timeline) }); return;
  }
  let handled = true;
  try {
    if (event.repeat && ['NumberMirror', 'NumberFill', 'Pause', 'AddHold', 'AddEvent', 'AddTap', 'StartView', 'EndView', 'JumpView', 'ReplayView', 'StartView_HOLD', 'JumpView_HOLD', 'ToggleMultiLine', 'SwitchMultiLineMode', 'SwitchLock', 'StickNext', 'TimeAttach'].includes(action)) { event.preventDefault(); return; }
    if (action === 'TimeAttach') seekBeat(Math.round(currentBeat() * timeline.division) / timeline.division);
    else if (!preview.visible && action?.startsWith('Page')) nudgeSelection(session, { PageLeft: 'ArrowLeft', PageRight: 'ArrowRight', PageUp: 'ArrowUp', PageDown: 'ArrowDown' }[action], timeline.division, timeline.gridCount);
    else if (timeline.eventInteraction.pending && /^[0-9]$/.test(event.key) && !event.ctrlKey && !event.altKey) timeline.eventInteraction.place(undefined, undefined, Number(event.key) || 10);
    else if (action === 'Save') { event.preventDefault(); await save(); }
    else if (action === 'Undo') travel('undo');
    else if (action === 'Redo') travel('redo');
    else if (action === 'SelectAll') {
      if (session.focus === 'events') selectAllEvents(session, timeline.eventTypes);
      else if (session.multiLineActive && session.multiLineMode === 'notes') {
        session.multiLineSelection = new Map(session.targetLineIndices.map(lineIndex => [lineIndex, new Set((session.chart.judgeLineList?.[lineIndex]?.notes ?? []).map((note, index) => index))]));
        session.selection = new Set(session.multiLineSelection.get(session.lineIndex) ?? []);
      } else session.selection = new Set(session.notes.map((note, index) => index));
      session.notify();
    }
    else if (action === 'Copy') copySelection();
    else if (action === 'Shear') cutSelection();
    else if (action === 'ClipboardHistory') toggleClipboardPanel();
    else if (!preview.visible && ['NumberMirror', 'NumberFill'].includes(action)) applyNumberShortcut(session, action);
    else if (['Paste', 'PasteMirror', 'KeepTimePaste', 'KeepTimePasteMirror'].includes(action)) pasteSelection(action.endsWith('Mirror'), action.startsWith('KeepTime'));
    else if (action === 'Pause') { event.preventDefault(); await togglePlayback(); }
    else if (['StartView', 'ReplayView', 'StartView_HOLD', 'JumpView_HOLD'].includes(action)) {
      if (action.endsWith('_HOLD')) heldPreview = { action, code: event.code };
      togglePreview(true, false, action === 'ReplayView');
    }
    else if (action === 'EndView') togglePreview(false);
    else if (action === 'JumpView') togglePreview(false, true);
    else if (action === 'SwitchUI') switchNoteView();
    else if (action === 'ResetCamera') resetCamera();
    else if (action === 'ToggleMultiLine') {
      const enabling = !session.multiLineEnabled;
      session.setMultiLineEnabled(enabling, session.focus === 'events' ? 'events' : 'notes');
      if (enabling) openMultiLinePanel();
    }
    else if (action === 'SwitchMultiLineMode' && session.multiLineActive) session.setMultiLineMode(session.multiLineMode === 'events' ? 'notes' : 'events');
    else if (action === 'CurveBegin' || action === 'CurveEnd') captureCurve(action === 'CurveEnd');
    else if (action === 'SwitchLock') {
      if (!noiseEditor.active && !globalEvents.active && session.focus === 'events') toggleSingleEventLock(session);
    }
    else if (action === 'StickNext') {
      if (!noiseEditor.active && !globalEvents.active && session.focus === 'events' && selectedEventEntries(session).length === 1) stickSelectedEventToNext(session);
    }
    else if (preview.visible && ['AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action)) handled = false;
    else if (area === 'events' && ['AddTap', 'AddEvent'].includes(action)) handled = timeline.eventInteraction.place(undefined, undefined, undefined, action === 'AddTap');
    else if (['AddTap', 'AddDrag', 'AddFlick', 'AddHold'].includes(action)) handled = timeline.addAtCursor({ AddTap: 1, AddDrag: 4, AddFlick: 3, AddHold: 2 }[action]);
    else if (action === 'Delete') deleteSelection();
    else if (action === 'QuickDelete') {
      const selected = captureSelection(session);
      if (selected.notes.length + selected.events.length > 1) deleteSelection();
      else if (area === 'events' && timeline.eventCursor) {
        const hit = timeline.eventInteraction.hit(timeline.eventCursor);
        if (hit) { selectEvent(session, hit.lineIndex ?? session.lineIndex, hit.type, hit.index, { replace: true }); deleteEvents(session); }
      } else if (area === 'notes' && timeline.cursor) {
        const hit = timeline.hit(timeline.cursor);
        if (hit) { if (session.multiLineActive && session.multiLineMode === 'notes') session.multiLineSelection = new Map([[hit.lineIndex, new Set([hit.index])]]); session.selection = new Set([hit.index]); deleteSelection(); }
      }
    } else if (['LastBeat', 'NextBeat'].includes(action)) seekBeat(Math.max(0, currentBeat() + (action === 'LastBeat' ? -1 : 1) / timeline.division));
    else if (action === 'Esc') { session.clipboardVisible = false; session.selection.clear(); session.eventSelection.clear(); session.multiLineSelection?.clear(); session.multiEventSelection?.clear(); timeline.cancelPlacement(); curveAnchorMode = null; curveStart = null; curveEnd = null; curveEditorOpen = false; togglePreview(false); activatePane('chart'); session.notify(); }
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  } catch (error) { event.preventDefault(); reportError(error); }
}, true);
window.addEventListener('keyup', event => {
  if (mods?.runtime.locks.size) return;
  pasteGesture.up(event);
  if (timeline.clipboardMode?.mirror || timeline.clipboardMode?.keepTime) { timeline.clipboardMode = {}; invalidate(); }
  if (heldPreview && (event.code === heldPreview.code || shortcutReleased(event, preferences.hotkeys[heldPreview.action]))) {
    togglePreview(false, heldPreview.action === 'JumpView_HOLD'); heldPreview = null;
  }
}, true);
window.addEventListener('blur', () => { if (heldPreview) { togglePreview(false); heldPreview = null; } });

window.addEventListener('beforeunload', event => { if (hasDocument && (session.history.dirty || assetDirty)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', invalidate);
element('#modal').addEventListener('close', () => { if (atHome) home.refresh().catch(reportError); });
const markerResizeObserver = new ResizeObserver(() => { renderTimelineMarkers(); invalidate(); });
markerResizeObserver.observe(element('.stage'));
markerResizeObserver.observe(element('.scrubber-wrap'));
let lastPaint = 0;
let lastInfoTick = 0;
const frameLimiter = new FrameLimiter();
let frameSampleStart = 0;
let frameSampleCount = 0;
let measuredFps = 0;
let lastTick = 0;
function frame(timestamp) {
  const elapsed = lastTick ? (timestamp - lastTick) / 1000 : 0; lastTick = timestamp;
  audio.update();
  mods?.runtime.tick({timestamp,elapsed,chartSeconds:chartSeconds(),musicSeconds:audio.time,playing:audio.playing});
  batchControls.sync();
  lineSwitcher.draw(timestamp);
  if (!atHome) { if (globalEvents.active) globalEvents.autoScroll(elapsed); else if (noiseEditor.active) noiseEditor.autoScroll(elapsed); else timeline.autoScroll(elapsed); }
  if (timestamp - frameSampleStart >= 500) { measuredFps = frameSampleCount * 1000 / (timestamp - frameSampleStart); frameSampleStart = timestamp; frameSampleCount = 0; }
  advanceEditClock(timestamp);
  if (hasDocument && !atHome && timestamp - lastInfoTick > 500) {
    const info = element('#chart-info dd');
    if (info && !element('#chart-info').hidden) info.textContent = info.textContent.replace(/Time: .*$/, `Time: ${formatEditTime(editTimeSeconds)}  FPS: ${measuredFps.toFixed(1)}`);
    lastInfoTick = timestamp;
  }
  if (hasDocument && !atHome && !document.hidden) {
    const interval = editorPreferences.autoSaveSeconds ?? preferences.settings.autoSaveSeconds;
    // Compare media only when a backup is due, not on every animation frame.
    const mediaDirty = assetDirty && !autoSave.pending && timestamp - autoSave.last >= interval * 1000
      && (assets.size !== lastDraftAssets.length || lastDraftAssets.some(([name, bytes]) => assets.get(name) !== bytes)
        || assetFolders.size !== lastDraftFolders.length || lastDraftFolders.some(folder => !assetFolders.has(folder)));
    autoSave.tick(timestamp, editorPreferences.autoSave ?? preferences.settings.autoSave, interval, session.history.dirty && session.chart !== lastDraftDocument || mediaDirty);
  }
  if (audio.playing && !mods?.runtime.locks.size && loop && currentBeat() >= loop.end) seekBeat(loop.start, false);
  if (audio.playing && audio.time >= audio.duration) { audio.pause(); invalidate(); }
  hitSounds.tick(session.chart, tempo, session.lineIndex);
  if (!atHome && (audio.playing || dirtyFrame || eventSampler.looping || trajectoryPanel.active || noiseTrackingPanel.active && noiseTrackingPanel.animating || noiseFitPanel.active && noiseFitPanel.options.animate && noiseFitPanel.options.show && noiseFitPanel.previewChart && !noiseFitPanel.fullPreview) && frameLimiter.shouldRender(timestamp, editorPreferences.fpsLimit ?? preferences.settings.fpsLimit)) {
    frameSampleCount++;
    const start = performance.now();
    const beat = currentBeat();
    session.editSeconds = Math.max(0, chartSeconds());
    updateLineInfo();
    timeline.origin = beat;
    if (!preview.visible && !noiseEditor.active && !globalEvents.active && !noiseFitPanel.active && !noiseTrackingPanel.previewing) {
      timeline.draw(beat);
      multiEdit.drawTimeline();
      selectionOverlay.draw();
      drawTimelineStrips();
      updateLayerButtons();
      audioAnalysis.draw(offsetSeconds());
    }
    if (noiseEditor.active) noiseEditor.draw();
    if (globalEvents.active) globalEvents.draw(beat);
    preview.duration = realtimePreview.duration = audio.duration;
    preview.selectedNoiseArea = realtimePreview.selectedNoiseArea = noiseEditor.active ? noiseEditor.selected : -1;
    const viewSession = timeline.getSession();
    const trajectoryView = trajectoryPanel.tick(timestamp, chartSeconds(), audio.playing, realtimePreview);
    const noiseView = noiseEditor.active ? noiseEditor.previewState() : null;
    const eventSampleView = eventSampler.previewState();
    const textView = textLinesPanel.view();
    const noiseFitView = noiseFitPanel.tick(timestamp, chartSeconds(), audio.playing, realtimePreview);
    const trackingView = noiseTrackingPanel.tick(timestamp, chartSeconds(), audio.playing);
    const modView=emitModHook('preview:before',{chart:trackingView?.chart ?? noiseView?.chart ?? eventSampleView?.chart ?? noiseFitView?.chart ?? textView?.chart ?? trajectoryView?.chart ?? (multiEdit.active && multiEdit.previewHovered && multiEdit.previewEnabled.checked && multiEdit.result ? multiEdit.result.chart : viewSession.chart),seconds:trackingView?.seconds ?? noiseView?.seconds ?? eventSampleView?.seconds ?? noiseFitView?.seconds ?? textView?.seconds ?? trajectoryView?.seconds ?? chartSeconds(),lineIndex:viewSession.lineIndex});
    const viewChart = modView.chart;
    const viewSeconds = modView.seconds;
    const previewAllLines = preview.allLines; const previewEffects = preview.showHitEffects;
    const previewNumbers = preview.lineNumbers; const previewArrows = preview.lineArrows;
    const forcedLineOpacity = preview.forceLineOpacity;
    preview.forceLineOpacity = Boolean(trackingView?.forceLineOpacity);
    if (trackingView) { preview.allLines = true; preview.showHitEffects = false; }
    if (textView || noiseFitView) { preview.allLines = true; preview.showHitEffects = false; preview.lineNumbers = false; preview.lineArrows = false; }
    preview.draw(viewChart, tempo, viewSeconds, modView.lineIndex);
    if(preview.visible)mods?.runtime.draw(preview,{target:'preview',chart:viewChart,tempo,seconds:viewSeconds,timestamp});
    preview.allLines = previewAllLines; preview.showHitEffects = previewEffects;
    preview.lineNumbers = previewNumbers; preview.lineArrows = previewArrows;
    preview.forceLineOpacity = forcedLineOpacity;
    if (!preview.visible) {
      const visible = realtimePreview.visible;
      if (trackingView || trajectoryView || textView || noiseFitView || noiseEditor.sampleMode || eventSampler.active) realtimePreview.visible = true;
      element('#realtime-preview').hidden = !realtimePreview.visible;
      const opacity = realtimePreview.opacity;
      const allLines = realtimePreview.allLines;
      const lineNumbers = realtimePreview.lineNumbers; const lineArrows = realtimePreview.lineArrows;
      const forcedLineOpacity = realtimePreview.forceLineOpacity;
      realtimePreview.forceLineOpacity = Boolean(trackingView?.forceLineOpacity);
      if (trackingView) realtimePreview.allLines = true;
      if (textView || noiseFitView) { realtimePreview.allLines = true; realtimePreview.lineNumbers = false; realtimePreview.lineArrows = false; }
      if (trackingView || noiseEditor.sampleMode || eventSampler.active || noiseFitView) realtimePreview.opacity = 1;
      realtimePreview.draw(viewChart, tempo, viewSeconds, modView.lineIndex);
      if(realtimePreview.visible)mods?.runtime.draw(realtimePreview,{target:'realtime',chart:viewChart,tempo,seconds:viewSeconds,timestamp});
      realtimePreview.opacity = opacity;
      realtimePreview.allLines = allLines;
      realtimePreview.lineNumbers = lineNumbers; realtimePreview.lineArrows = lineArrows;
      realtimePreview.forceLineOpacity = forcedLineOpacity;
      realtimePreview.visible = visible;
    }
    noiseEditor.drawSample();
    eventSampler.draw();
    element('#play').textContent = audio.playing ? t('app.s87aecc9') : t('app.sb410f77');
    element('#play').dataset.playing = String(audio.playing);
    const skinBeat = Math.floor(beat);
    if (audio.playing && document.documentElement.dataset.rpenBeat !== String(skinBeat)) editorSkinSignal('beat');
    editorSkinState({ playing: audio.playing, beat: skinBeat, dirty: session.history.dirty || assetDirty, location: atHome ? 'home' : preview.visible ? 'preview' : 'editor' });
    element('#play').title = audio.playing ? t('app.s130448b') : t('app.s2192535');
    timeReadouts.update(chartSeconds(), audio.duration, beat);
    element('#scrubber').value = audio.time;
    const tempoPoint = tempo.points[Math.max(0, upperBound(tempo.points, beat, point => point.beat) - 1)];
    const lineTimeFactor = noiseEditor.active || globalEvents.active ? 1 : session.line?.bpmfactor ?? 1;
    element('#bpm-display').textContent = `${(60 / (tempoPoint.secondsPerBeat * lineTimeFactor)).toFixed(2)} BPM`;
    const draggedLineIndex = Number.isInteger(timeline.drag?.lineIndex) ? timeline.drag.lineIndex : session.lineIndex;
    const draggedSource = session.chart.judgeLineList?.[draggedLineIndex]?.notes?.[timeline.drag?.anchor];
    const draggedNote = ['move', 'startTime', 'endTime'].includes(timeline.drag?.kind) ? timeline.movedNote(draggedSource) : null;
    const positionInput = element('#properties input[aria-label="X 坐标"]');
    if (draggedNote && positionInput && document.activeElement !== positionInput) positionInput.value = Number(draggedNote.positionX).toFixed(2);
    element('#cursor-position').textContent = draggedNote ? t('app.sd67248b', { p0: draggedNote.positionX.toFixed(2), p1: beatValue(draggedNote.startTime).toFixed(3) }) : timeline.cursor ? t('app.sa1e6c17', { p0: timeline.positionAt(timeline.cursor.x).toFixed(2), p1: timeline.snappedBeat(timeline.cursor.y).toFixed(3) }) : '';
    if (timestamp - lastPaint > 400) {
      element('#performance').textContent = t('app.s274ea37', { p0: (performance.now() - start).toFixed(1) });
      lastPaint = timestamp;
    }
    dirtyFrame = false;
  }
  requestAnimationFrame(frame);
}
applyPreferences(preferences);
setHome(true);
requestAnimationFrame(frame);

function applyPreferences(next) {
  next = { ...next, hotkeys: { ...DEFAULT_HOTKEYS, ...next.hotkeys } };
  preferences = next;
  // Migrated RPE settings carry an interface language; honour it unless the
  // user already picked one explicitly in this editor.
  if (!readLocalePreference()) {
    for (const candidate of localeCandidates(next.originalSettings)) {
      const applied = setLocale(candidate);
      if (applied.locale) { document.documentElement.lang = applied.locale; break; }
    }
  }
  audio.setVolume(editorPreferences.volume ?? next.settings.volume);
  element('#volume').value = audio.volume;
  hitSounds.setVolume(editorPreferences.hitVolume ?? next.settings.hitVolume);
  element('#hit-volume').value = hitSounds.volume;
  preview.noteSize = realtimePreview.noteSize = editorPreferences.noteSize ?? next.settings.noteSize;
  preview.lineScale = realtimePreview.lineScale = editorPreferences.lineScale ?? next.settings.lineScale;
  preview.backgroundAlpha = realtimePreview.backgroundAlpha = next.settings.backgroundAlpha;
  timeline.noteScale = (editorPreferences.noteSize ?? next.settings.noteSize) / 175;
  timeline.gridCount = editorPreferences.gridCount ?? next.settings.gridCount;
  timeline.scale = editorPreferences.scale ?? 500;
  timeline.division = editorPreferences.division ?? 4;
  timeline.snapX = editorPreferences.snapX ?? true;
  timeline.multiLineWidth = editorPreferences.multiLineWidth ?? 0;
  timeline.multiLineEventWidth = editorPreferences.multiLineEventWidth ?? 0;
  timeline.multiLineWidthExplicit = Number.isFinite(editorPreferences.multiLineWidth);
  timeline.multiLineEventWidthExplicit = Number.isFinite(editorPreferences.multiLineEventWidth);
  element('#grid-count').value = timeline.gridCount; element('#division').value = timeline.division; element('#y-scale').value = timeline.scale; element('#snap-x').checked = timeline.snapX;
  element('#y-scale-slider').value = timeline.scale;
  realtimePreview.visible = editorPreferences.realtime ?? true;
  element('#realtime-enabled').checked = realtimePreview.visible; element('#realtime-preview').hidden = !realtimePreview.visible;
  element('#realtime-alpha').value = editorPreferences.realtimeAlpha ?? next.settings.realtimeAlpha;
  realtimePreview.opacity = Number(element('#realtime-alpha').value);
  audioAnalysis.enabled = editorPreferences.analysisEnabled ?? false;
  audioAnalysis.mode = editorPreferences.analysisMode === 'spectrum' ? 'spectrum' : 'waveform';
  audioAnalysis.alpha = Number.isFinite(Number(editorPreferences.analysisAlpha)) ? Number(editorPreferences.analysisAlpha) : 0.2;
  audioAnalysis.width = Number.isFinite(Number(editorPreferences.analysisWidth)) ? Number(editorPreferences.analysisWidth) : 0.62;
  hitSounds.enabled = editorPreferences.hitEnabled ?? true; element('#hit-enabled').checked = hitSounds.enabled;
  preview.allLines = realtimePreview.allLines = editorPreferences.allLines ?? true; element('#preview-mode').value = preview.allLines ? 'all' : 'current';
  timeline.scrollSpeed = next.settings.scrollSpeed / 5;
  session.history.limit = next.settings.historyLimit;
  element('#hotkey-help').hidden = !next.settings.showHotkey;
  element('#hotkey-help').textContent = t('app.s3789316', { p0: next.hotkeys.AddTap, p1: next.hotkeys.AddDrag, p2: next.hotkeys.AddFlick, p3: next.hotkeys.AddHold, p4: next.hotkeys.AddEvent, p5: next.hotkeys.Pause, p6: next.hotkeys.StartView, p7: next.hotkeys.EndView, p8: next.hotkeys.JumpView, p9: next.hotkeys.StartView_HOLD, p10: next.hotkeys.JumpView_HOLD, p11: next.hotkeys.SwitchUI, p12: next.hotkeys.ResetCamera, p13: next.hotkeys.CurveBegin, p14: next.hotkeys.CurveEnd });
  applyDisplaySettings();
  renderSession();
}

function applyMigratedPreferences(next) {
  editorPreferences = { ...editorPreferences, volume: next.settings.volume, hitVolume: next.settings.hitVolume, gridCount: next.settings.gridCount, realtimeAlpha: next.settings.realtimeAlpha,
    fpsLimit: next.settings.fpsLimit,
    noteSize: next.settings.noteSize,
    lineScale: next.settings.lineScale,
    ratioWidth: next.settings.ratioWidth, ratioHeight: next.settings.ratioHeight, barWidth: next.settings.barWidth, barAlpha: next.settings.barAlpha,
    autoSave: next.settings.autoSave, autoSaveSeconds: next.settings.autoSaveSeconds, autoSaveLimit: next.settings.autoSaveLimit, autoplayView: next.settings.autoplayView, highlight: next.settings.highlight, showGameUI: next.settings.showGameUI };
  applyPreferences(next); persistEditor();
}

listen('#migrate', async () => {
  const content = showDialog(t('app.sa14179a'), t('app.s0d0658f'));
  if (window.showDirectoryPicker) {
    const select = document.createElement('button'); select.type = 'button'; select.className = 'primary'; select.textContent = t('app.s1da6c74');
    select.onclick = async () => {
      try {
        const directory = await window.showDirectoryPicker({ mode: 'read' });
        status(t('app.s6f10570'));
        const entries = await directoryEntries(directory);
        migrationDialog(await scanMigration(entries, directory.name, fileOptions()), applyMigratedPreferences);
      } catch (error) { if (error.name !== 'AbortError') reportError(error); }
    };
    content.append(select);
  }
  const fallback = document.createElement('button'); fallback.type = 'button'; fallback.textContent = t('app.s92f35bf');
  fallback.onclick = () => element('#directory-input').click(); content.append(fallback);
});
element('#directory-input').addEventListener('change', async event => {
  try {
    if (!event.target.files.length) return;
    status(t('app.s6f10570'));
    const entries = uploadedEntries(event.target.files);
    const name = event.target.files[0].webkitRelativePath.split('/')[0];
    migrationDialog(await scanMigration(entries, name, fileOptions()), applyMigratedPreferences);
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
listen('#library', () => {
  if (atHome) return;
  noiseEditor.flush();
  playback.pause();
  if (!session.history.dirty && !assetDirty) { setHome(true); return; }
  choose(t('app.s6ae650b'), t('app.s873b360'), [t('app.s78b733b'), t('app.s09bc228')], value => value, async value => {
    if (value === t('app.s78b733b')) {
      await save();
      if (session.history.dirty || assetDirty) throw new Error(t('app.sec16507'));
    }
    else { hasDocument = false; session.history.markSaved(); assetDirty = false; }
    setHome(true);
  });
});
listen('#preferences', () => settingsDialog.showModal());
listen('#advanced-preferences', () => {
  settingsDialog.close();
  pasteGesture.cancel();
  showHotkeySettings(preferences, async next => { await storePreferences(next); applyPreferences(next); });
});
readPreferences().then(saved => {
  if (saved) applyPreferences(migratePreferences(JSON.stringify(saved.originalSettings), Object.entries(saved.originalHotkeys).map(([key, value]) => `${key} ${value}`).join('\n'), saved.originalUI));
}).catch(error => status(t('app.s01610aa', { p0: error.message })));

function applyDisplaySettings() {
  const fpsLimit = editorPreferences.fpsLimit ?? preferences.settings.fpsLimit;
  element('#fps-unlimited').checked = !fpsLimit;
  element('#fps-limit').disabled = !fpsLimit;
  if (fpsLimit) element('#fps-limit').value = fpsLimit;
  element('#fps-limit').setCustomValidity('');
  element('#fps-limit-error').hidden = true;
  for (const [id, key, fallback] of displayFields) {
    const control = element(`#${id}`); const value = editorPreferences[key] ?? preferences.settings[key] ?? fallback;
    if (control.type === 'checkbox') control.checked = value; else control.value = value;
  }
  const ratioWidth = editorPreferences.ratioWidth ?? preferences.settings.ratioWidth;
  const ratioHeight = editorPreferences.ratioHeight ?? preferences.settings.ratioHeight;
  setRatioOptions(element('#preview-ratio'), ratioWidth, ratioHeight);
  preview.aspectRatio = realtimePreview.aspectRatio = ratioWidth / ratioHeight;
  preview.noteSize = realtimePreview.noteSize = Number(element('#note-size').value);
  timeline.noteScale = preview.noteSize / 175;
  applyViewControls({ ...editorPreferences, showGameUI: editorPreferences.showGameUI ?? preferences.settings.showGameUI }, timeline, [preview, realtimePreview]);
  for (const renderer of [preview, realtimePreview]) for (const key of ['lineNumbers', 'lineArrows', 'lineTint', 'mergeLineNumbers', 'pickPreviewLines', 'pickPreviewNoiseAreas']) renderer[key] = editorPreferences[key] ?? true;
  for (const renderer of [preview, realtimePreview]) {
    renderer.noisePreview.seamless = editorPreferences.seamlessNoiseAreas ?? true;
    if (renderer.noisePreview.forceSimple !== (editorPreferences.forceSimpleNoise ?? false)) { renderer.noisePreview.gpu?.reset(); renderer.overflowNoisePreview?.gpu?.reset(); }
    renderer.noisePreview.forceSimple = editorPreferences.forceSimpleNoise ?? false;
    renderer.noisePreview.getAssets = () => assets;
    renderer.noisePreview.invalidate = invalidate;
    renderer.noisePreview.report = message => notify(message + t('app.s9c427ae'), 'error');
  }
  const toolbarMode = editorPreferences.toolbarMode ?? 'icons';
  element('.editor-toolbar').classList.remove('mode-compact', 'mode-icons', 'mode-wide');
  element('.editor-toolbar').classList.add(`mode-${toolbarMode}`);
  element('#toolbar-mode').title = t('app.sdb02ef4', { p0: toolbarMode === 'icons' ? t('app.s1f24c1e') : toolbarMode === 'wide' ? t('app.s6e6e581') : t('app.sc837edc') });
  timeline.barWidth = Number(element('#bar-width').value); timeline.barAlpha = Number(element('#bar-alpha').value); timeline.judgementOffset = Number(element('#judgement-offset').value);
  timeline.judgementColor = element('#judgement-color').value;
  timeline.eventValueFontSize = Number(element('#event-value-size').value); timeline.eventValueThreshold = Number(element('#event-value-threshold').value); timeline.eventCurveThreshold = Number(element('#event-curve-threshold').value); timeline.eventOpacity = Number(element('#event-opacity').value); timeline.eventBarWidth = Number(element('#event-bar-width').value);
  timeline.seamlessEvents = element('#seamless-events').checked;
  timeline.drawEventCurves = element('#draw-event-curves').checked;
  timeline.selectionInterval = globalEvents.timeline.selectionInterval = Number(element('#selection-interval').value);
  selectionIntervalPanel.sync();
  session.cutDensity = Number(element('#event-cut-density').value);
  session.dragSensitivity = Number(element('#event-drag-sensitivity').value);
  clipboardHistory.enabled = element('#clipboard-history-enabled').checked;
  lineSwitcher.enabled = element('#line-switcher-enabled').checked;
  if (!lineSwitcher.enabled) lineSwitcher.hide();
  if (!clipboardHistory.enabled) pasteGesture.cancel();
  element('#clipboard-history').hidden = !clipboardHistory.enabled;
  if (!clipboardHistory.enabled && activePaneName === 'clipboard') activatePane('chart');
  preview.backgroundBlur = realtimePreview.backgroundBlur = Number(element('#background-blur').value);
  preview.viewportOverflow = realtimePreview.viewportOverflow = Boolean(element('#viewport-overflow').checked);
  preview.overflowBlur = realtimePreview.overflowBlur = Number(element('#overflow-blur').value);
  preview.overflowDarken = realtimePreview.overflowDarken = Number(element('#overflow-darken').value);
  preview.lineScale = realtimePreview.lineScale = Number(element('#default-line-thickness').value);
  timeline.highlight = preview.highlight = realtimePreview.highlight = element('#highlight-notes').checked;
  audio.setPreservePitch(element('#preserve-pitch').checked);
  hitSounds.setDelays({ tap: Number(element('#hit-tap-delay').value), drag: Number(element('#hit-drag-delay').value), flick: Number(element('#hit-flick-delay').value) });
  rotateTip();
  invalidate();
}
function applyFpsLimit() {
  const input = element('#fps-limit');
  const unlimited = element('#fps-unlimited').checked;
  input.disabled = unlimited;
  const value = unlimited ? 0 : Number(input.value);
  const valid = unlimited || input.value.trim() && value > 10 && validFpsLimit(value);
  input.setCustomValidity(valid ? '' : t('app.sbb9273d'));
  element('#fps-limit-error').hidden = Boolean(valid);
  if (!valid) return;
  editorPreferences.fpsLimit = value;
  persistEditor(); invalidate();
}
document.addEventListener('dragstart', event => {
  if (!editorPreferences.textSelectionDrag && isTextEntry(event.target)) event.preventDefault();
}, true);
element('#fps-limit').addEventListener('input', applyFpsLimit);
element('#fps-unlimited').addEventListener('change', applyFpsLimit);
for (const [id, key] of displayFields.filter(([, key]) => key !== 'selectionInterval')) element(`#${id}`).addEventListener(element(`#${id}`).type === 'number' ? 'change' : 'input', event => {
  const control = event.target;
  if (control.type === 'checkbox') editorPreferences[key] = control.checked;
  else if (control.type === 'color') editorPreferences[key] = control.value;
  else if (control.value.trim() && control.validity.valid && Number.isFinite(Number(control.value))) editorPreferences[key] = Number(control.value);
  else return;
  applyDisplaySettings(); persistEditor();
});
timeline.eventPlacementType = timeline.eventTypes[0];

const modEditor={
  get session(){return session;},get chart(){return session.chart;},get tempo(){return tempo;},get assets(){return assets;},get preferences(){return preferences;},get editorPreferences(){return editorPreferences;},get chartName(){return chartName;},
  get hasDocument(){return hasDocument&&!atHome;},get home(){return atHome;},get activePane(){return activePaneName;},
  get dirty(){return session.history.dirty||assetDirty;},get libraryProject(){return libraryProject;},get loop(){return loop;},set loop(value){loop=value;},
  audio,playback,preview,realtimePreview,timeline,skin,images,hitSounds,editorSkins,noteSkins,noiseEditor,eventSampler,trajectoryPanel,textLinesPanel,noiseFitPanel,noiseTrackingPanel,multiEdit,batchControls,collaboration,globalEvents,globalEventRegistry,openGlobalEvents,versionControl,
  chartSeconds,offsetSeconds,currentBeat,invalidate,render:renderSession,notify,save,activatePane,
  commit:(label,chart)=>session.commit(label,chart),replace:(chart,name=chartName)=>replaceChart(chart,name),
  seek:(seconds,{music=false,pause=true}={})=>{playback.seek(seconds+(music?0:offsetSeconds()),pause);invalidate();},
  seekBeat,selectLine:index=>{session.selectLine(index);renderSession();},setPreview:(visible,options={})=>togglePreview(visible,options.stay??true,false,{autoplay:options.autoplay??false}),
  play:async()=>{if(!audio.playing&&!playback.pending)await togglePlayback();},pause:()=>playback.pause(),
  addAsset:(path,bytes)=>{assets.set(path,bytes);assetDirty=true;images.load(session.chart,assets,chartName);invalidate();},
  removeAsset:path=>{assets.delete(path);assetDirty=true;images.load(session.chart,assets,chartName);invalidate();},
  raw:{get session(){return session;},get chart(){return session.chart;},set chart(value){session.history.document=value;session.notify();},get assets(){return assets;},get tempo(){return tempo;},set tempo(value){tempo=value;timeline.tempo=value;invalidate();},renderSession,replaceChart,activatePane,togglePlayback,togglePreview,save,applyDisplaySettings,persistEditor,setHome},
  beginPreviewSession(){
    if(atHome||!hasDocument)throw Error(t('app.s21c0425'));
    const snapshot={visible:preview.visible,pane:activePaneName,allLines:preview.allLines,lineNumbers:preview.lineNumbers,lineArrows:preview.lineArrows,lineTint:preview.lineTint,cameraX:preview.cameraX,viewDivisor:preview.viewDivisor,collisionGeometry:preview.collisionGeometry};
    playback.pause();timeline.cancelPlacement();batchControls.cancel();pasteGesture.cancel();heldPreview=null;playbackSpaceHeld=false;clearNoteSourceToast();
    eventSampler.finish?.(false);noiseEditor.endSample(false);noiseEditor.flush();noiseTrackingPanel.endSample();activatePane('chart');
    preview.allLines=true;preview.lineNumbers=false;preview.lineArrows=false;preview.lineTint=false;preview.collisionGeometry=true;togglePreview(true,true,false,{autoplay:false});
    let done=false;return()=>{if(done)return;done=true;playback.pause();togglePreview(snapshot.visible,true,false,{autoplay:false});preview.allLines=snapshot.allLines;preview.lineNumbers=snapshot.lineNumbers;preview.lineArrows=snapshot.lineArrows;preview.lineTint=snapshot.lineTint;preview.cameraX=snapshot.cameraX;preview.viewDivisor=snapshot.viewDivisor;preview.collisionGeometry=snapshot.collisionGeometry;activatePane(snapshot.pane);invalidate();};
  },
};
mods=new ModManager(modEditor,{notify,invalidate});
