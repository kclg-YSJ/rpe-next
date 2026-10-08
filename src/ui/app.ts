import { EditorSession } from '../application/session.ts';
import type { EditorSession as EditorSessionClass } from '../application/session.ts';
import { assertChart, createChart, diagnose, EVENT_TYPES, EXTENDED_TYPES, previewLimitations } from '../core/chart.ts';
import { beatValue, parseBeat, formatBeat, fromNumber, upperBound } from '../core/beat.ts';
import { TempoMap } from '../core/tempo.ts';
import { AudioTransport } from '../platform/audio.ts';
import { openFiles, assetBytes, resourceReferences, attachExternalEffects } from '../platform/files.ts';
import { showExportDialog } from './export-dialog.ts';
import { listDrafts, readDraft, saveSnapshot } from '../platform/recovery.ts';
import { Timeline, prepareCanvas } from './timeline.ts';
import type { MoveDrag } from './timeline.ts';
import { Preview } from './preview.ts';
import { renderProperties } from './inspector.ts';
import { showDialog, editJson, choose, confirmAction, dialogOpen } from './dialog.ts';
import { migratePreferences, shortcutAction, shortcutReleased, shortcutMatches, DEFAULT_HOTKEYS } from '../core/preferences.ts';
import { directoryEntries, uploadedEntries, scanMigration } from '../platform/migration.ts';
import { readProject, readPreferences, storePreferences, storeProject, readClipboardHistory, storeClipboardHistory } from '../platform/library.ts';
import { migrationDialog } from './migration-dialog.ts';
import { LinePanel } from './line-panel.ts';
import { AssetLibraryPanel } from './asset-library.ts';
import { HELP_TEXT } from './help.ts';
import { download } from '../platform/files.ts';
import { RpeSkin } from './skin.ts';
import type { RpeSkin as RpeSkinType } from './skin.ts';
import { ProjectImages } from '../platform/images.ts';
import { HitSounds } from '../platform/hitsounds.ts';
import { renderEventInspector } from './event-inspector.ts';
import { eventKey, eventList, deleteEvents, transformEvents } from '../application/event-commands.ts';
import { BATCH_ACTIONS, applyBatchAction, nudgeSelection } from '../application/batch-edit.ts';
import { copyObjects, cutObjects, pasteObjects, deleteObjects } from '../application/clipboard.ts';
import { ClipboardHistory } from '../application/clipboard-history.ts';
import type { ClipboardHistorySession } from '../application/clipboard-history.ts';
/** `EditorSession` viewed with the clipboard-history members the class grows at runtime. */
type EditorClipboardSession = EditorSession & ClipboardHistorySession;
import { renderClipboardHistory } from './clipboard-history.ts';
import { PasteGesture } from './paste-gesture.ts';
import type { PasteContext } from './paste-gesture.ts';
import { SelectionOverlay } from './selection-overlay.ts';
import { LineSwitcher } from './line-switcher.ts';
import { stepLine } from '../core/line-overview.ts';
import { applyNumberShortcut } from '../application/number-shortcuts.ts';
import type { NumberShortcutSession } from '../application/number-shortcuts.ts';
import { BatchControls } from './batch-controls.ts';
import { MultiEditPanel } from './multi-edit.ts';
import { MultiLinePanel } from './multi-line.ts';
import { clipboardBeat } from './clipboard-preview.ts';
import { shaderEvents, replaceShaderEvents, shaderIdentity } from '../core/shader-events.ts';
import { renderMetadataPanel, renderBpmPanel } from './forms.ts';
import { EditorPlayback } from '../application/playback.ts';
import { readEditorPreferences, writeEditorPreferences } from '../platform/editor-preferences.ts';
import { ProjectHome } from './home.ts';
import { createSettingsPanel } from './settings.ts';
import { showHotkeySettings } from './hotkey-settings.ts';
import { AutoSaveClock } from '../application/autosave.ts';
import { ManualSaveQueue } from '../application/manual-save.ts';
import { SPECIAL_TRACKS, MAX_BASE_LAYERS } from '../core/editor-display.ts';
import { lineGroupName, isDefaultLineGroup, lineDisplayLabel } from '../core/line-groups.ts';
import { isPlaybackSpace, isTextEntry, isTypingText, releaseShortcutFocus } from './keyboard.ts';
import type { ShortcutTarget } from './keyboard.ts';
import { setRatioOptions, applyViewControls } from './view-controls.ts';
import { generateCurveNotes } from '../core/curve-notes.ts';
import { createEasingPicker } from './easing-picker.ts';
import { numericWheel } from './numeric-wheel.ts';
import { SceneRuntime } from '../core/scene.ts';
import type { LineTracks } from '../core/scene.ts';
import { TimelineActivity } from '../core/timeline-activity.ts';
import { assetUrl } from '../core/asset-url.ts';
import { AudioAnalysis } from './audio-analysis.ts';
import { TrajectoryPanel } from './trajectory-panel.ts';
import { CollaborationPanel } from './collaboration.ts';
import type { AnyEventType, Beat, Chart, ChartEvent, JudgeLine, Note, NoteType } from '../core/types.ts';
import type { Timeline as TimelineClass, TimelineSession, CursorPosition } from './timeline.ts';
import type { AudioContextLike } from '../platform/audio.ts';
import type { DiagnosticIssue } from '../core/chart.ts';
import type { CurveNoteOptions } from '../core/curve-notes.ts';
import type { EasingPicker } from './easing-picker.ts';
import type { EditorPreferences, ToolbarMode } from '../platform/editor-preferences.ts';
import type { MigratedPreferences, MigratedSettings, DefaultHotkeys } from '../core/preferences.ts';
import type { StoredProject } from '../platform/library.ts';
import type { Draft } from '../platform/recovery.ts';
import type { ChartCandidate } from '../platform/files.ts';
import type { ProjectSummary } from '../platform/library.ts';


/**
 * The audio transport's members this file reads back.
 *
 * `AudioTransport` types `context` as its own structural `AudioContextLike` and the getters
 * (`time`, `clockReady`, …) read through it. `HitSounds` declares the subset it drives against the
 * platform `AudioContext`; the two describe the same object, and the only honest way to state that
 * without an asserted cast is to name the members this file needs. `unknown` would erase the
 * numeric reads below, so the concrete types are listed instead.
 */
interface EditorAudio {
  playing: boolean;
  position: number;
  time: number;
  duration: number;
  volume: number;
  clockReady: boolean;
  playRevision: number;
  /** The playback rate the scheduler scales its hit offsets by. */
  rate: number;
  /** The scheduler's lookahead window; `AudioTransport` reports `Infinity` outside a seek. */
  scheduleHorizon: number;
  /** The live context. `HitSounds` drives it as the platform `AudioContext`. */
  context: AudioContext;
  ensureContext(): AudioContextLike;
  pause(): void;
  clear(): void;
  seek(seconds: number): void;
  update(): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setPreservePitch(enabled: unknown): void;
  load(bytes: ArrayBuffer, name?: string): Promise<boolean>;
}

/**
 * A curve-editor anchor: the two beat/position fields the panel reads back off a picked note.
 *
 * The picked note is a full `Note`, but the panel only ever reads these three members, and the
 * generator below consumes the same shape, so the anchor is declared as its own narrow record.
 */
interface CurveAnchor {
  startTime: Beat;
  positionX: number;
  type: number;
}

/**
 * The curve panel's parameter set; exactly the options `generateCurveNotes` accepts.
 *
 * `generateCurveNotes` declares `type`, `density` and `easingType` optional and defaults them, but
 * this panel's single initialiser always sets all three and every read below expects a value, so they
 * are narrowed to required here rather than defaulted at each use.
 */
type CurveValues = CurveNoteOptions & { startTime: Beat; endTime: Beat; type: NoteType; density: number; easingType: number };

/** The note-density strip frames cached between draws. */
interface StripCache {
  chart: Chart;
  line: number;
  layer: number;
  extended: boolean;
  duration: number;
  width: number;
  historyWidth: number;
  height: number;
  historySignature: string;
  note: HTMLCanvasElement;
  history: HTMLCanvasElement;
}

/** A `createStripCanvas` frame: the offscreen canvas plus its measured logical size. */
interface StripFrame {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

/** One row of the recent-edit history list. */
interface HistoryEntry {
  label: string;
  index: number;
}

/**
 * A candidate chart being opened.
 *
 * `assets` is always passed alongside, so the record carries only what the loader needs; the chart
 * itself arrives from user data and is validated by `assertChart` before it is used.
 *
 * `name` is required because `ChartCandidate` — the shape `openFiles` and `attachExternalEffects`
 * accept — requires it, and both callers below pass one.
 */
interface LoadCandidate {
  chart: Chart;
  name: string;
  info?: Record<string, string>;
  /**
   * The provenance the loader reads back, if the chart came from a stored project or a draft.
   *
   * Typed as {@link CandidateProvenance} — the two fields actually read — rather than as
   * `StoredProject`, because the recovery path has no stored project at all and supplies just a saved
   * scroll position. A `StoredProject` carries neither field directly, so the two are read through the
   * view in both cases.
   */
  project?: CandidateProvenance | null;
  /** The stored project this chart belongs to, when it was opened from the library. */
  libraryProject?: StoredProject | null;
}

/**
 * The provenance the loader reads off a candidate's `project`.
 *
 * `StoredProject` has neither of these fields: the asset folders and the scroll position both live
 * inside the stored document, and the recovery path supplies a literal with only a `viewState`. This
 * is the view the two reads below go through, so a stored project and a draft both type-check.
 */
type CandidateProvenance = { assetFolders?: string[]; viewState?: { lineIndex?: number } };

/**
 * Reads the provenance fields out of a record that may or may not declare them.
 *
 * `StoredProject` is the record the library stores; it declares neither `assetFolders` nor
 * `viewState`, because both live inside the open document rather than beside it. Reading them through
 * this view is what lets a stored project and a draft's `{ viewState }` reach `LoadCandidate.project`
 * without asserting a shape onto either. Fields that are absent stay absent, so the loader's
 * `?? []` / `undefined` fallbacks behave exactly as the original untyped reads did.
 */
function candidateProvenance(source: object | null | undefined): CandidateProvenance | null {
  if (!source) return null;
  const view = source as { assetFolders?: unknown; viewState?: unknown };
  const provenance: CandidateProvenance = {};
  if (Array.isArray(view.assetFolders)) provenance.assetFolders = view.assetFolders.filter((entry): entry is string => typeof entry === 'string');
  const lineIndex = (view.viewState as { lineIndex?: unknown } | null | undefined)?.lineIndex;
  if (Number.isInteger(lineIndex)) provenance.viewState = { lineIndex: lineIndex as number };
  return provenance;
}

/**
 * The note a drag is anchored to, or `undefined` when the drag carries no usable index.
 *
 * `MoveDrag.anchor` is `unknown` because the same drag object also serves the event and stroke
 * gestures; a note drag always stores a numeric note index there, so the `typeof` test accepts exactly
 * the values the original's untyped index expression could use. `movedNote` is declared to take a
 * `Note`, and `timeline.ts` hands it the same possibly-absent lookup from its own drag path, so the
 * `!` at the call site records that invariant; the `undefined` this returns when no drag is anchored
 * is the value the original's index expression produced too.
 */
function draggedAnchorNote(chart: Chart, lineIndex: number, anchor: unknown): Note | undefined {
  if (typeof anchor !== 'number') return undefined;
  return chart.judgeLineList?.[lineIndex]?.notes?.[anchor];
}

/**
 * Whether a string names an event track.
 *
 * `eventList` only accepts the seven track names; this is the guard that lets a string read out of an
 * event-selection key reach it. The two literal arrays are the editor's own track lists, so the test
 * accepts exactly the keys `eventKey` can have produced.
 */
function isEventType(value: string): value is AnyEventType {
  return isBaseEventType(value) || (EXTENDED_TYPES as readonly string[]).includes(value);
}

/** Whether a string names one of the five base track names `JudgeLine.eventLayers` holds. */
function isBaseEventType(value: string): value is (typeof EVENT_TYPES)[number] {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * The event target viewed the way `keyboard.ts` reads it.
 *
 * `keyboard.ts` probes every member (`isContentEditable`, `closest`, `blur`) before use, so this is
 * just its exported structural view named at the call site — `keyboard.ts`'s own `isPlaybackSpace`
 * casts `event.target` to the same type.
 */
type ShortcutTargetArg = ShortcutTarget;

/** The open timeline context menu, or `null` when it is closed. */
interface PendingTimelineMenu {
  time: number | null;
  markerIndex: number | null;
}

/** What the keyup handler remembers about a held preview shortcut. */
interface HeldPreview {
  /**
   * The preview shortcut being held; one of the two `_HOLD` actions.
   *
   * Typed as a hotkey name because it indexes `preferences.hotkeys` below. Only `StartView_HOLD` and
   * `JumpView_HOLD` are ever stored, both of which the key set includes.
   */
  action: keyof DefaultHotkeys;
  code: string;
}

/** The note-density and history strips' click handler receives a plain click event. */
type StripEvent = MouseEvent;

/**
 * Looks up an element by selector.
 *
 * The markup lives in `index.html` and every selector this file passes is one it provides, so the
 * lookup keeps its existing non-null behaviour (`as T`); the type parameter only names the element
 * kind, so controls can be read and written without a narrowing at each use.
 */
const element = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
/**
 * The settings controls `applyDisplaySettings` writes, as `[element id, preference key, default]`.
 *
 * The key names a member of `EditorPreferences`. Only some of these also exist on `MigratedSettings`
 * (the legacy `Settings.json` keys); the rest are editor-only, which is why the settings-side fallback
 * below reads through a partial view rather than assuming every key is present there.
 */
const displayFields: [string, keyof EditorPreferences, number | boolean][] = [
  ['event-cut-density', 'cutDensity', 4],
  ['judgement-offset', 'judgementOffset', 92],
  ['default-line-thickness', 'lineScale', 1.5],
  ['line-switcher-enabled', 'lineSwitcher', true],
  ['clipboard-history-enabled', 'clipboardHistory', true],
  ['bar-width', 'barWidth', 3], ['bar-alpha', 'barAlpha', 1], ['event-value-size', 'eventValueSize', 13], ['event-value-threshold', 'eventValueThreshold', 30], ['event-curve-threshold', 'eventCurveThreshold', 24], ['event-opacity', 'eventOpacity', 0.25], ['event-bar-width', 'eventBarWidth', 0.82], ['seamless-events', 'seamlessEvents', true],
  ['background-blur', 'backgroundBlur', 10.5], ['scroll-speed', 'scrollSpeed', 5], ['tips-enabled', 'tipsEnabled', true], ['success-notifications', 'successNotifications', true],
  ['line-numbers', 'lineNumbers', true], ['line-arrows', 'lineArrows', true], ['line-tint', 'lineTint', true], ['merge-line-numbers', 'mergeLineNumbers', true], ['pick-preview-lines', 'pickPreviewLines', true],
  ['note-source-hover', 'noteSourceHover', true],
  ['preserve-pitch', 'preservePitch', true], ['autoplay-view', 'autoplayView', true], ['highlight-notes', 'highlight', true],
  ['autosave-enabled', 'autoSave', true], ['autosave-seconds', 'autoSaveSeconds', 60], ['autosave-limit', 'autoSaveLimit', 10],
];
const settingsDialog = createSettingsPanel();
let session: EditorSession = new EditorSession();
let assets: Map<string, Uint8Array> = new Map();
let assetFolders: Set<string> = new Set();
let assetDirty = false;
let chartName = 'chart.json';
let recoveryId = crypto.randomUUID();
let tempo: TempoMap = new TempoMap(session.chart.BPMList);
let tempoEntries = session.chart.BPMList;
let dirtyFrame = true;
let lastDraftDocument: Chart | undefined;
let preferences: MigratedPreferences = migratePreferences();
let libraryProject: StoredProject | null = null;
const manualSaves = new ManualSaveQueue(storeProject);
let editorPreferences: EditorPreferences = readEditorPreferences();
let atHome = true;
let hasDocument = false;
let previewReturnTime = 0;
let placementContext: string | undefined;
let heldPreview: HeldPreview | null = null;
let curveStart: CurveAnchor | null = null;
let curveEnd: CurveAnchor | null = null;
let curveAnchorMode: 'start' | 'end' | null = null;
let curveEditorOpen = false;
let curveEasingPicker: EasingPicker | undefined;
let curveValues: CurveValues = { startTime: [0, 0, 1], endTime: [4, 0, 1], startX: -405, endX: 405, density: 1, type: 4, easingType: 1 };
let loop: { start: number; end: number } | null = null;
let activePaneName = 'chart';
let lastSelectionSignature = '';
let editTimeSeconds = 0;
let editClockTick = performance.now();
let lastDiagnosticSignature: string | null = null;
const audio = new AudioTransport();
/**
 * `HitSounds` declares the transport it drives as its own structural `HitSoundTransport`
 * (`ensureContext(): AudioContext`). `AudioTransport` is typed against a `AudioContextLike`
 * interface deliberately, so the one place the two meet is named here and the concrete transport is
 * viewed through that shape; `EditorAudio` lists only the members the scheduler and this file use.
 *
 * The bridge is the documented widening cast this file already uses elsewhere: the two interfaces
 * describe the same live object (`AudioTransport` builds a real `AudioContext` and hands back the
 * `AudioContextLike` view of it), and neither module can name the other's type.
 */
const hitsoundTransport: EditorAudio = audio as unknown as EditorAudio;
/**
 * The transport shape `HitSounds` accepts, recovered from its constructor.
 *
 * `HitSoundTransport` is declared but not exported, and its `ensureContext(): AudioContext` differs
 * from `AudioTransport`'s `AudioContextLike` view of the same live object. Naming the parameter type
 * through the constructor keeps the bridge in one place instead of restating the interface.
 */
type HitSoundsTransport = ConstructorParameters<typeof HitSounds>[0];
const hitSounds = new HitSounds(hitsoundTransport as unknown as HitSoundsTransport);
const preview = new Preview(element<HTMLCanvasElement>('#preview'));
const realtimePreview = new Preview(element<HTMLCanvasElement>('#realtime-preview'));
const lineInfoScene = new SceneRuntime();
const timelineActivity = new TimelineActivity();
const invalidate = () => { dirtyFrame = true; };
preview.invalidate = realtimePreview.invalidate = invalidate;
realtimePreview.applyShaders = false;
realtimePreview.showHitEffects = false;
const skin = new RpeSkin(invalidate);
const images = new ProjectImages(invalidate, (message: string) => status(message));
const timelineSession = (): TimelineSession => session;
const timeline = new Timeline(element<HTMLCanvasElement>('#notes'), element<HTMLCanvasElement>('#events'), timelineSession, (...args: unknown[]) => (editEvent as (...parameters: unknown[]) => unknown)(...args), invalidate, reportError, (...args: unknown[]) => (openTimelineContextMenu as (...parameters: unknown[]) => unknown)(...args));
const audioAnalysis = new AudioAnalysis(element<HTMLCanvasElement>('#audio-analysis-overlay'), () => timeline, () => audio, () => persistEditor());
/** The pending note-source hover timer; `null` when no reveal is scheduled. */
let noteHoverTimer: number | ReturnType<typeof globalThis.setTimeout> | null = null;
let noteHoverKey: string | null = null;
function clearNoteSourceToast(): void {
  if (noteHoverTimer) { clearTimeout(noteHoverTimer as number); noteHoverTimer = null; }
  noteHoverKey = null;
  const toast = element<HTMLElement>('#note-source-toast');
  if (toast) { toast.hidden = true; toast.onclick = null; }
}
timeline.onNoteHover = entry => {
  clearTimeout(noteHoverTimer as number); noteHoverTimer = null;
  const toast = element<HTMLElement>('#note-source-toast');
  const hoverEnabled = editorPreferences.noteSourceHover ?? preferences.settings.noteSourceHover ?? true;
  if (!hoverEnabled) { clearNoteSourceToast(); return; }
  if (!entry || atHome || !preview.visible || session.multiLineActive || !toast) { clearNoteSourceToast(); return; }
  const key = `${entry.lineIndex}:${entry.index}`;
  if (key === noteHoverKey && !toast.hidden) return;
  noteHoverKey = key; toast.hidden = true;
  noteHoverTimer = setTimeout(() => {
    // The entry is re-read from the key rather than captured: a chart edit replaces the document, so
    // the captured object would be stale by the time the timer fires.
    if (noteHoverKey !== key || !entry?.lineIndex && entry?.lineIndex !== 0) return;
    const line = session.chart.judgeLineList?.[entry.lineIndex];
    if (!line) return;
    toast.textContent = `该音符来自 ${entry.lineIndex} 号线 · 点击切换`;
    toast.hidden = false;
    toast.onclick = () => { session.selectLine(entry.lineIndex); clearNoteSourceToast(); invalidate(); };
  }, 1000);
};
timeline.multiLineLabels = element('#multi-line-labels');
timeline.multiLineScrollElement = element<HTMLInputElement>('#multi-line-scroll');
const multiLineScrollElement = timeline.multiLineScrollElement as HTMLInputElement;
multiLineScrollElement.addEventListener('input', event => {
  const area = session.multiLineMode === 'events' ? 'events' : 'notes';
  if (typeof timeline.multiLineScroll === 'number') timeline.multiLineScroll = { notes: timeline.multiLineScroll, events: timeline.multiLineScroll };
  timeline.multiLineScroll[area] = Number((event.target as HTMLInputElement).value) || 0;
  invalidate();
});
let draggingMultiLineScroll = false;
function updateMultiLineScrollFromPointer(event: PointerEvent) {
  const range = multiLineScrollElement;
  const rectangle = range.getBoundingClientRect();
  if (!rectangle.width) return;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rectangle.left) / rectangle.width));
  range.value = String(Number(range.max || 0) * ratio);
  range.dispatchEvent(new Event('input', { bubbles: true }));
}
multiLineScrollElement.addEventListener('pointerdown', event => {
  event.preventDefault(); event.stopPropagation(); draggingMultiLineScroll = true;
  multiLineScrollElement.setPointerCapture?.(event.pointerId);
  updateMultiLineScrollFromPointer(event);
});
multiLineScrollElement.addEventListener('pointermove', event => {
  if (!draggingMultiLineScroll) return;
  event.preventDefault(); event.stopPropagation(); updateMultiLineScrollFromPointer(event);
});
const stopMultiLineScrollDrag = (event?: Event) => {
  if (!draggingMultiLineScroll) return;
  draggingMultiLineScroll = false; event?.stopPropagation?.();
};
multiLineScrollElement.addEventListener('pointerup', stopMultiLineScrollDrag);
multiLineScrollElement.addEventListener('pointercancel', stopMultiLineScrollDrag);
multiLineScrollElement.addEventListener('lostpointercapture', stopMultiLineScrollDrag);
const batchControls = new BatchControls(element('.stage'), timeline, () => session, () => !atHome && !preview.visible, reportError);
const multiEdit = new MultiEditPanel(element('#multi-editor'), () => session, timeline, {
  close: () => activatePane('chart'), invalidate, notify,
});
const trajectoryPanel = new TrajectoryPanel(element('#trajectory-editor'), () => ({ session, timeline, tempo, previewVisible: preview.visible }), { invalidate, notify, activate: activatePane });
const multiLinePanel = new MultiLinePanel(element('#multi-line-editor'), () => session, { timeline, render: renderSession, notify, persist: persistEditor });
const linePanel = new LinePanel(element('#line-panel'), () => session, { render: renderSession, notify, getAssets: () => assets, afterTexture: () => { images.load(session.chart, assets, chartName); } });
const assetLibrary = new AssetLibraryPanel(element('#asset-library'), () => ({ assets, folders: assetFolders, chart: session.chart, chartName }), {
  notify,
  onChange: (nextAssets: Map<string, Uint8Array>, nextFolders?: Iterable<string>) => {
    assets = nextAssets; assetFolders = new Set(nextFolders ?? []); images.load(session.chart, assets, chartName); assetDirty = true; status('素材库已修改，请保存谱面以保留资源'); renderSession();
  },
  onTexture: (oldName: string, newName: string = oldName) => {
    const lines = [...session.chart.judgeLineList];
    if (newName !== oldName) {
      let changed = false; for (let index = 0; index < lines.length; index++) if (lines[index]?.Texture === oldName) { lines[index] = { ...lines[index], Texture: newName }; changed = true; }
      if (changed) session.commit('同步重命名判定线贴图', { ...session.chart, judgeLineList: lines });
      images.load(session.chart, assets, chartName);
      return;
    }
    const index = session.lineIndex; if (!lines[index]) return;
    lines[index] = { ...lines[index], Texture: newName }; session.commit('更改判定线贴图', { ...session.chart, judgeLineList: lines });
    images.load(session.chart, assets, chartName);
  },
});
const clipboardHistory = new ClipboardHistory();
const selectionOverlay = new SelectionOverlay(element('.stage'), timeline);
const lineSwitcher = new LineSwitcher(element('.stage'), () => ({
  chart: session.chart, tempo, seconds: chartSeconds(), selected: session.lineIndex,
  layer: timeline.layer, extended: timeline.extended,
  start: timeline.timeAt(timeline.viewHeight()), end: timeline.timeAt(0),
  visible: hasDocument && !atHome && !preview.visible && !dialogOpen(),
}), { select: (index: number) => selectOverviewLine(index) });
function clipboardTargetLine() {
  return timeline.hoverArea === 'events'
    ? timeline.lineIndexAt(timeline.eventCursor?.x ?? 0, timeline.eventsCanvas.clientWidth, 'events')
    : timeline.lineIndexAt(timeline.cursor?.x ?? 0, timeline.notesCanvas.clientWidth, 'notes');
}
const pasteGesture = new PasteGesture({
  paste: (context: PasteContext) => { try { pasteObjects(session, context.beat, { ...timeline.clipboardMode, targetLineIndex: clipboardTargetLine() }); } catch (error) { reportError(error as Error); } },
  open: () => { activatePane('clipboard'); renderClipboardPanel(); },
  reportError: (error: Error) => notify(`剪贴板历史：${error.message}`, 'error'),
  valid: (context: PasteContext) => context.session === session && context.chart === session.chart && context.layer === timeline.layer && !atHome && !preview.visible && !dialogOpen() && !isTextEntry(document.activeElement),
});
window.addEventListener('blur', () => pasteGesture.cancel());
let stripCache: StripCache | undefined;
function createStripCanvas(width: number, height: number): StripFrame {
  const canvas = document.createElement('canvas'); const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const context = (canvas.getContext('2d') as CanvasRenderingContext2D); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  return { canvas, context, width, height };
}
function drawTimelineStrips() {
  const height = timeline.notesCanvas.clientHeight; const densityCanvas = element<HTMLCanvasElement>('#note-density') as HTMLCanvasElement; const historyCanvas = element<HTMLCanvasElement>('#history-strip') as HTMLCanvasElement;
  const width = densityCanvas.clientWidth; if (!height || !width) return;
  timelineActivity.compile(session.chart, tempo);
  const duration = Math.max(0.001, audio.duration > 0 ? audio.duration : timelineActivity.duration);
  const historyEntries = session.recentEdits ?? [];
  const historySignature = `${historyEntries.length}:${historyEntries.at(-1)?.start ?? ''}:${historyEntries.at(-1)?.end ?? ''}:${historyEntries.at(-1)?.label ?? ''}`;
  const key = { chart: session.chart, line: session.lineIndex, layer: timeline.layer, extended: timeline.extended, duration, width, historyWidth: historyCanvas.clientWidth, height, historySignature };
  const cached = stripCache;
  if (!cached || Object.keys(key).some(name => (cached as unknown as Record<string, unknown>)[name] !== (key as unknown as Record<string, unknown>)[name])) {
    const noteFrame = createStripCanvas(width, height); const historyFrame = createStripCanvas(historyCanvas.clientWidth, height);
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
  noteFrame.context.drawImage((stripCache as StripCache).note, 0, 0, width, height);
  historyFrame.context.drawImage((stripCache as StripCache).history, 0, 0, historyCanvas.clientWidth, height);
  const markerY = height - Math.max(0, Math.min(duration, chartSeconds())) / duration * height;
  for (const frame of [noteFrame, historyFrame]) { frame.context.strokeStyle = '#f5e59a'; frame.context.lineWidth = 1; frame.context.beginPath(); frame.context.moveTo(0, markerY + .5); frame.context.lineTo(frame.width, markerY + .5); frame.context.stroke(); }
}
function seekFromStrip(event: StripEvent) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  timelineActivity.compile(session.chart, tempo);
  const duration = audio.duration > 0 ? audio.duration : timelineActivity.duration; playback.seek((1 - ratio) * duration + offsetSeconds());
}
element<HTMLCanvasElement>('#note-density').addEventListener('click', seekFromStrip);
element<HTMLCanvasElement>('#history-strip').addEventListener('click', seekFromStrip);
/**
 * Handles a note clicked while the curve editor is picking an anchor.
 *
 * `Timeline.curvePick` is declared as a data bag (an earlier revision stored the picked indices
 * there) while the only call site, `this.curvePick?.(note)`, treats it as a function. The handler is
 * written as a standalone function and the field is assigned through the same shape the property
 * declares, so no cast is needed at the assignment.
 */
const curvePickHandler = (note: Note): boolean => {
  if (!curveAnchorMode) return false;
  const anchor: CurveAnchor = { startTime: [...note.startTime], positionX: note.positionX, type: note.type };
  if (curveAnchorMode === 'start') {
    curveStart = anchor;
    curveAnchorMode = null;
    element<HTMLButtonElement>('#curve-start')?.classList.remove('active');
    curveValues.startTime = anchor.startTime; curveValues.startX = anchor.positionX; updateCurvePanel();
    status('曲线起点已选择；请选择终点音符');
    invalidate();
    return true;
  }
  if (!curveStart) { curveAnchorMode = null; status('请先选择曲线起点'); return true; }
  curveEnd = anchor;
  curveAnchorMode = null;
  element<HTMLButtonElement>('#curve-end')?.classList.remove('active');
  curveValues.endTime = anchor.startTime; curveValues.endX = anchor.positionX; updateCurvePanel();
  status('曲线终点已选择，可在右侧调整参数并生成');
  return true;
};
Object.assign(timeline, { curvePick: curvePickHandler });
timeline.curveGhost = () => {
  if (!curveEditorOpen || !curveStart) return [];
  const exists = (anchor: CurveAnchor) => session.notes.some(note => note.positionX === anchor.positionX && beatValue(note.startTime) === beatValue(anchor.startTime));
  const anchors: (Note | undefined)[] = [{ startTime: [...curveValues.startTime], positionX: curveValues.startX, type: curveValues.type, anchor: exists(curveStart) && curveValues.startX === curveStart.positionX && beatValue(curveValues.startTime) === beatValue(curveStart.startTime) } as unknown as Note];
  if (!curveEnd) return anchors as Note[];
  const end = { startTime: [...curveValues.endTime], positionX: curveValues.endX, type: curveValues.type, anchor: exists(curveEnd) && curveValues.endX === curveEnd.positionX && beatValue(curveValues.endTime) === beatValue(curveEnd.startTime) } as unknown as Note;
  try {
    return [...(anchors as Note[]), ...generateCurveNotes({ ...curveValues, division: timeline.division }), end];
  } catch { return [...(anchors as Note[]), end]; }
};
timeline.skin = skin; preview.skin = skin; preview.images = images;
realtimePreview.skin = skin; realtimePreview.images = images;
skin.load();
document.fonts.load('35px RPEGame').then(invalidate);
const status = (message: string) => { element('#status').textContent = message; };
/** Narrows a caught value to its message; `catch` binds `unknown` under `strict`. */
function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
/**
 * Reports a failure to the user.
 *
 * The parameter is `unknown` because every caller is a `catch` binding, which `strict` types as
 * `unknown`; `failureMessage` produces the same string an `Error` argument always did.
 *
 * Declared as a function rather than a `const` so it hoists: the timeline and batch controls are
 * constructed above this line and receive it as their error hook, and a `const` would be in its
 * temporal dead zone at that point.
 */
function reportError(failure: unknown) {
  const message = failureMessage(failure); status(message); notify(message, 'error', 5000); showDialog('操作未完成', message);
}
const notificationTimers = new Set<ReturnType<typeof setTimeout>>();
/**
 * Shows a transient notification.
 *
 * The message is optional to match `Timeline`'s declared `notify!: (message?: string, level?: string)`
 * hook — a callback with a required first parameter is not assignable to it. Every call site in this
 * file passes a message, so the default is never used; it only makes the assignment legal.
 */
function notify(message = '', level = 'success', duration = 2800) {
  if (level === 'success' && editorPreferences.successNotifications === false) return;
  const host = element('#notifications'); if (!host) return;
  const item = document.createElement('div'); item.className = `editor-notification ${level}`; item.textContent = message; host.append(item);
  requestAnimationFrame(() => item.classList.add('visible'));
  const timer = setTimeout(() => { item.classList.add('leaving'); setTimeout(() => item.remove(), 260); notificationTimers.delete(timer); }, duration); notificationTimers.add(timer);
}
timeline.notify = (message = '', level = 'warning') => notify(message, level);
const tips = [
  'Tips: 坐标系范围为 [-675,675]x[-450,450]', 'Tips: 速度为10表示每秒移动 1200 像素~', 'Tips: 编辑器的分辨率正比于 1920*1080', 'Tips: 很多金色的组件都是可以被点击的',
  'Tips: 谱面名可不为英文，但标识名只能是一串数字', 'Tips: 添加资源文件时闪退可能是其损坏，常见于直接改后缀名', 'Tips: CTRL+滚轮 可以快速切换线',
  'Tips: 选中事件 CTRL+滚轮 可以微调事件数值', 'Tips: 善用多音符和多事件编辑能在几步内做出大量常用效果', 'Tips: 开启实时显示预览可能会降低帧率',
  'Tips: 如果帧率过低，可以试试降低分辨率哦', 'Tips: 请务必安装 /Resources/fonts 中的字体！', 'Tips: 按住 Z键 用鼠标左右键可以拖动音符和事件的头或尾',
  'Tips: 速度事件只能线性变化', 'Tips: 按住 T 和 Y 可以分别进行两种预览', 'Tips: UIOP 键对应左上角的四个预览相关按钮',
  'Tips: 最好让右上部的两条横线时刻保持绿色（认真', 'Tips: .pez就是压缩文件', 'Tips: 右上部第一条线为红色代表很可能有严重错误，看看纠错！',
  'Tips: 按住 CTRL键 并按下数字可以跳转所在线号', 'Tips: 按住 CTRL 并点击可以进行单击多选', 'Tips: 按住 SHIFT键 点击并移动鼠标，再次点击鼠标以进行框选',
  'Tips: 按下 D键和鼠标右键 可以删除选中的内容', 'Tips: 常看谱面纠错是个好习惯', 'Tips: Error尽量改，Warning仔细看，Caution作参考',
  'Tips: 自动保存会表明每个文件保存的时间', 'Tips: 不要调戏音频库————', 'Tips: 新建的线会放入一个各类事件来垫底，不应该被删除',
  'Tips: 编辑器配置在 Settings.json 中存储', 'Tips: 编辑器热键在 Hotkey.txt 中存储', 'Tips: 编辑器UI在 UI.txt 中存储',
  'Tips: 试试在曲线填充中用 CTRL+F/G', 'Tips: 有很多东西可以在设置中调整', 'Tips: BPM 列表过长的时候可以用滚轮或方向键操作',
  'Tips: 移动和旋转事件最好不要全用线性变化', 'Tips: 慎用音符差速', 'Tips: 竖线不宜调太多或太少', 'Tips: 不确定采音的时候，试试倍速！',
  'Tips: 判定线遮罩属性指是否显示线下方的音符', 'Tips: 每条判定线可以更改贴图，需将贴图放在 /Resources下', 'Tips: 判定线 Z轴属性 用来控制线之间的遮挡关系',
  'Tips: 即使开了自动保存，多保存依然是好习惯', 'Tips: Tip大概每 10 秒切换一次', 'Tips: 事件编辑窗下方的按钮用来切换层级',
  'Tips: 实时预览帧率过低时可以降低分辨率', 'Tips: 密度条显示音符和当前事件层的分布',
  'Tips: 次透明化控制选中线以外的音符透明度，试试置为负数？', 'Tips: 选中音符按住 CTRL键 使用滚轮可以调整音符宽度', 'Tips: 线上标注的数字可以在设置中关闭',
  'Tips: 粘合会将事件的初始数值置为前一个的结束数值', 'Tips: 下方的状态栏会显示一些有用的信息', 'Tips: 不限量的判定线！',
  'Tips: 如果太多音符闪退，或许是电脑内存不够用', 'Tips: 你无法删除所有线', 'Tips: 开始框选后松开 SHIFT，就可以随意调整时刻',
  'Tips: 研究表明，对自己谱面的喜爱程度随时间而快速下降', 'Tips: 不支持脑内想法投射', 'Tips: 据说演出应该锦上添花而不是雪中送碳',
  'Tips: 集齐所有Tips召唤神龙', 'Tips: 世界是离散的', 'Tips: 怎么也飞不出，花花的世界', 'Tips: 没有 tips 就是最好的 tips',
  'Tips: 不要弄错你的目标判定线哦～', 'Tips: 长时间使用电脑要注意保持正确姿势哦', 'Tips: Re:Phiedit 被玩坏了！这绝对不是 Re:Phiedit 的错，绝对不是！'
];
let tipIndex = 0;
function rotateTip() { const target = element('#tips'); if (!target || editorPreferences.tipsEnabled === false || atHome) { if (target) target.textContent = ''; return; } target.textContent = tips[tipIndex++ % tips.length]; }
setInterval(rotateTip, 10000);
const offsetSeconds = () => Number(session.chart.META.offset ?? 0) / 1000;
const chartSeconds = () => audio.time - offsetSeconds();
const resetEditClock = (chart: Chart) => {
  editTimeSeconds = 0;
  editClockTick = performance.now();
};
const advanceEditClock = (timestamp: number) => {
  const elapsed = Math.max(0, (timestamp - editClockTick) / 1000);
  if (hasDocument && !atHome && !document.hidden) editTimeSeconds += elapsed;
  editClockTick = timestamp;
};
const formatEditTime = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')} h, ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')} m, ${String(Math.floor(seconds) % 60).padStart(2, '0')} s`;
const currentBeat = () => tempo.beat(chartSeconds(), session.line?.bpmfactor ?? 1);
let collaborationJoining = false;
const collaborationTool = document.createElement('button'); collaborationTool.id = 'collaboration-tool'; collaborationTool.textContent = '联机协作'; element('[data-panel="chart"] .action-grid').append(collaborationTool);
const collaboration = new CollaborationPanel(element('#collaboration-panel'), () => ({
  session, timeline, interactionBusy: Boolean(batchControls.active), seconds: chartSeconds(), offset: offsetSeconds(), duration: Number(element<HTMLInputElement>('#scrubber').max) || 600,
  seek: seconds => playback.seek(seconds + offsetSeconds()),
  sharedAssets: () => {
    const references = resourceReferences(session.chart, assets, chartName);
    const names = new Set([references.song, references.background, session.chart.META.background, ...session.chart.judgeLineList.map(line => line.Texture)].filter(Boolean));
    return [...names].flatMap(name => { const bytes = assetBytes(assets, name, chartName); return bytes ? [[name, bytes]] : []; });
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
  preview.effectsSince = realtimePreview.effectsSince = chartSeconds();
  invalidate();
});
timeline.onDragScroll = (seconds: number) => playback.seek(audio.time + seconds);
const autoSave = new AutoSaveClock(async () => {
  const current = session; const snapshot = { ...current.chart }; delete snapshot.chartTime;
  await saveSnapshot(libraryProject?.id ?? recoveryId, chartName, snapshot, new Map(assets), Number(editorPreferences.autoSaveLimit ?? preferences.settings.autoSaveLimit), { lineIndex: current.lineIndex });
  if (current === session) { lastDraftDocument = current.chart; status('自动备份已保存（包含音乐、曲绘与编辑位置）'); notify('自动备份已保存', 'success'); }
}, failure => status(`自动保存失败：${failureMessage(failure)}，请手动保存或导出 PEZ`));
timeline.onWheel = (event: WheelEvent) => {
  if (event.ctrlKey) {
    if (event.deltaY) {
      if (lineSwitcher.enabled) { lineSwitcher.step(event.deltaY); lineSwitcher.show(); }
      else switchLine(event.deltaY);
    }
  } else playback.wheel(event, { ...preferences.settings, scrollSpeed: Number(editorPreferences.scrollSpeed ?? preferences.settings.scrollSpeed) }, performance.now() / 1000);
};
function switchLine(direction: number) {
  const index = stepLine(session.lineIndex, direction, session.chart.judgeLineList?.length ?? 0);
  return selectOverviewLine(index);
}
function selectOverviewLine(index: number | null) {
  // `stepLine` returns an integer index, but its declared result is nullable; the added `null` test
  // is a no-op for every value the original could receive and keeps the index narrowing honest.
  if (index === null || !Number.isInteger(index) || !session.chart.judgeLineList?.[index]) return false;
  batchControls.cancel(); pasteGesture.cancel(); timeline.cancelPlacement(); session.selectLine(index); return true;
}
const previewWheel = (event: WheelEvent) => {
  event.preventDefault();
  playback.wheel(event, { ...preferences.settings, scrollSpeed: Number(editorPreferences.scrollSpeed ?? preferences.settings.scrollSpeed) }, performance.now() / 1000);
};
element('.preview-wrap').addEventListener('wheel', previewWheel, { passive: false });
const pickPreviewLine = (renderer: Preview, event: MouseEvent) => {
  const index = renderer.pick(event.clientX, event.clientY);
  if (index === null) return false;
  timeline.cancelPlacement(); session.selectLine(index); return true;
};
element<HTMLCanvasElement>('#preview').addEventListener('click', (event: MouseEvent) => {
  if (!preview.visible) return;
  // A note drawn in the preview wins over the line guide behind it, so the note hit test runs first.
  const noteLine = preview.pickNote(event.clientX, event.clientY);
  if (noteLine !== null) { timeline.cancelPlacement(); session.selectLine(noteLine); clearNoteSourceToast(); invalidate(); return; }
  pickPreviewLine(preview, event);
});
element<HTMLCanvasElement>('#preview').addEventListener('pointermove', (event: PointerEvent) => {
  if (!preview.visible || (editorPreferences.noteSourceHover ?? preferences.settings.noteSourceHover ?? true) === false) { clearNoteSourceToast(); return; }
  const lineIndex = preview.pickNote(event.clientX, event.clientY);
  if (lineIndex === null) { clearNoteSourceToast(); return; }
  const key = `preview:${lineIndex}`;
  clearTimeout(noteHoverTimer as number); noteHoverTimer = null;
  if (key === noteHoverKey && !element<HTMLElement>('#note-source-toast')?.hidden) return;
  noteHoverKey = key;
  const toast = element<HTMLElement>('#note-source-toast'); if (!toast) return;
  toast.hidden = true;
  noteHoverTimer = setTimeout(() => {
    if (noteHoverKey !== key || !preview.visible) return;
    toast.textContent = `该音符来自 ${lineIndex} 号线 · 点击切换`;
    toast.hidden = false;
    toast.onclick = () => { session.selectLine(lineIndex); clearNoteSourceToast(); invalidate(); };
  }, 1000);
});
element<HTMLCanvasElement>('#preview').addEventListener('pointerleave', (event: PointerEvent) => { if (!element<HTMLElement>('#note-source-toast')?.contains(event.relatedTarget as Node | null)) clearNoteSourceToast(); });
timeline.previewPick = () => false;
const home = new ProjectHome(async id => {
  const project = await readProject(id);
  if (!project) throw new Error('此项目不存在');
  // A stored project carries neither provenance field directly — both live inside the stored document,
  // and `StoredProject` does not declare them — so the two are read through `candidateProvenance`
  // below, which returns nothing for a record that has neither. `libraryProject` keeps the whole
  // stored record so the editor can still write back to it.
  guardReplace(() => loadCandidate({ chart: project.chart, name: project.chartName, info: project.info, project: candidateProvenance(project), libraryProject: project }, new Map(project.assets)).catch(reportError));
}, reportError, project => {
  if (libraryProject?.id === project.id) {
    const renamed = libraryProject.chart.META.name !== project.chart.META.name;
    libraryProject = project;
    if (!session.history.dirty) {
      session.commit('更新项目信息', project.chart); session.history.markSaved(); renderSession();
    } else if (renamed) session.commit('更新项目名称', { ...session.chart, META: { ...session.chart.META, name: project.chart.META.name } });
  }
});

function setHome(visible: boolean) {
  if (visible && collaboration.client.active) collaboration.client.leave();
  atHome = visible;
  if (visible) clearNoteSourceToast();
  if (visible) { lineSwitcher.reset(); hitSounds.onlyCurrentLine = false; element<HTMLButtonElement>('#mute-current-line')?.setAttribute('aria-pressed', 'false'); element<HTMLButtonElement>('#mute-current-line')?.classList.remove('active'); }
  if (visible) { lineInfoVisible = false; element('#line-info-overlay')?.setAttribute('hidden', ''); }
  element('#document-name').textContent = visible ? '谱面库' : `${session.history.dirty ? '● ' : ''}${session.chart.META.name ?? chartName}`;
  element('#home').hidden = !visible;
  element('.workspace').hidden = visible;
  element('.transport').hidden = visible;
  element('#resume-editor').hidden = !hasDocument;
  for (const selector of ['#save', '#export']) element<HTMLButtonElement>(selector).disabled = !hasDocument;
  if (visible) { playback.pause(); timeline.cancelPlacement(); home.refresh().catch(reportError); }
  invalidate();
}

let pendingTimelineMenu: PendingTimelineMenu | null = null;
/**
 * The chart's time markers, filtered to the ones the strip can draw.
 *
 * `markers` is an optional user-data field, so it is read as `unknown` and narrowed with
 * `Array.isArray`; the filter keeps the same truthiness test the original used.
 */
function timelineMarkers() {
  return Array.isArray(session.chart?.markers)
    ? session.chart.markers.filter(marker => Number.isFinite(Number(marker?.time)) && String(marker?.name ?? '').trim())
    : [];
}
function renderTimelineMarkers() {
  const root = element('#timeline-markers'); if (!root) return;
  root.replaceChildren();
  const width = root.clientWidth || element<HTMLInputElement>('#scrubber')?.clientWidth || 1;
  const duration = Math.max(0.001, audio.duration > 0 ? audio.duration : timelineActivity.duration || 1);
  for (const [index, marker] of timelineMarkers().entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'timeline-marker'; button.textContent = String(marker.name).trim();
    const ratio = Math.max(0, Math.min(1, Number(marker.time) / duration));
    button.style.left = `${ratio * width}px`; button.style.width = 'max-content'; button.style.maxWidth = '160px'; button.style.whiteSpace = 'nowrap'; button.title = `${marker.name} · ${Number(marker.time).toFixed(3)} s`;
    button.onclick = () => playback.seek(Number(marker.time) + offsetSeconds());
    button.oncontextmenu = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); openTimelineContextMenu(event, null, index); };
    root.append(button);
  }
}
function openTimelineContextMenu(event: MouseEvent, canvas: HTMLCanvasElement | null = null, markerIndex: number | null = null) {
  const menu = element('#timeline-context-menu'); if (!menu) return;
  const point = canvas ? timeline.point(event, canvas) : null;
  pendingTimelineMenu = { time: point ? timeline.timeAt(point.y) : null, markerIndex };
  element<HTMLButtonElement>('#timeline-add-marker').hidden = !canvas;
  element<HTMLButtonElement>('#timeline-delete-marker').hidden = markerIndex === null;
  // The split action only applies to a single selected whole-curve trajectory on the events canvas,
  // so the selection is resolved back to its event before the button is shown.
  const selections = session.multiLineActive && session.multiLineMode === 'events'
    ? [...session.multiEventSelection].flatMap(([lineIndex, keys]) => [...keys].map(key => ({ lineIndex, key })))
    : [...session.eventSelection].map(key => ({ lineIndex: session.lineIndex, key }));
  const selection = selections.length === 1 ? selections[0] : null;
  const [type, index] = selection?.key.split(':') ?? [];
  const selected = type === 'moveXEvents' && selection ? session.chart.judgeLineList[selection.lineIndex]?.eventLayers?.[timeline.layer]?.moveXEvents?.[Number(index)] ?? null : null;
  const split = element<HTMLButtonElement>('#trajectory-context-split'); split.hidden = !selected?.trajectory || canvas !== timeline.eventsCanvas;
  split.onclick = () => { closeTimelineContextMenu(); if (!selected || !selection) return; trajectoryPanel.open(selected, selection.lineIndex, timeline.layer); trajectoryPanel.split(); };
  menu.style.left = `${Math.max(4, Math.min(window.innerWidth - 190, event.clientX))}px`;
  menu.style.top = `${Math.max(4, Math.min(window.innerHeight - 90, event.clientY))}px`;
  menu.hidden = false;
}
function closeTimelineContextMenu() { const menu = element('#timeline-context-menu'); if (menu) menu.hidden = true; pendingTimelineMenu = null; }
function addTimelineMarker() {
  const pending = pendingTimelineMenu; closeTimelineContextMenu();
  // `Number.isFinite` rejects `null`, so the binding below is the same value the original used; the
  // explicit test only records that fact for the two reads that follow.
  if (!pending || pending.time === null || !Number.isFinite(pending.time)) return;
  const markerTime = pending.time;
  const content = showDialog('添加时间标记', `将在 ${markerTime.toFixed(3)} 秒处添加标记。`);
  const input = document.createElement('input'); input.type = 'text'; input.placeholder = '例如：副歌开始'; input.setAttribute('aria-label', '标记名称'); content.append(input);
  const apply = element<HTMLButtonElement>('#modal-apply'); apply.hidden = false; apply.onclick = () => {
    const name = String(input.value ?? '').trim(); if (!name) { element<HTMLElement>('#modal-error').textContent = '请输入标记名称'; return; }
    const markers = [...timelineMarkers(), { time: markerTime, name }].sort((left, right) => left.time - right.time);
    session.commit('添加时间标记', { ...session.chart, markers }); element<HTMLDialogElement>('#modal').close();
  }; input.focus();
}
function deleteTimelineMarker() {
  const pending = pendingTimelineMenu; closeTimelineContextMenu(); if (!pending || pending.markerIndex === null) return;
  const markers = timelineMarkers().filter((unused, index) => index !== pending.markerIndex);
  session.commit('删除时间标记', { ...session.chart, markers });
}
window.addEventListener('pointerdown', event => { const menu = element('#timeline-context-menu'); if (menu && !menu.contains(event.target as Node | null)) closeTimelineContextMenu(); }, true);
element<HTMLButtonElement>('#timeline-add-marker').addEventListener('click', addTimelineMarker);
element<HTMLButtonElement>('#timeline-delete-marker').addEventListener('click', deleteTimelineMarker);

function persistEditor() {
  editorPreferences = { ...editorPreferences, scale: timeline.scale, division: timeline.division, gridCount: timeline.gridCount, snapX: timeline.snapX, judgementOffset: timeline.judgementOffset, multiLineWidth: timeline.multiLineWidth || undefined, multiLineEventWidth: timeline.multiLineEventWidth || undefined,
    realtime: realtimePreview.visible, realtimeAlpha: Number(element<HTMLInputElement>('#realtime-alpha').value), volume: audio.volume, hitVolume: hitSounds.volume,
    hitEnabled: hitSounds.enabled, allLines: preview.allLines, toolbarMode: editorPreferences.toolbarMode ?? 'icons',
    analysisEnabled: audioAnalysis.enabled, analysisMode: audioAnalysis.mode, analysisAlpha: audioAnalysis.alpha, analysisWidth: audioAnalysis.width };
  try { writeEditorPreferences(editorPreferences); } catch (failure) { status(`设置保存失败：${failureMessage(failure)}`); }
}

function activatePane(name: string) {
  if (name !== 'multi') multiEdit.hide();
  if (name !== 'trajectory') trajectoryPanel.hide();
  activePaneName = name;
  for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pane]')) button.classList.toggle('active', button.dataset.pane === name);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pane]')) button.onclick = () => {
  const pane = button.dataset.pane;
  if (pane === 'notes' || pane === 'events') session.focus = pane;
  activatePane(pane ?? '');
  if (pane === 'lines') linePanel.render();
};
function openMultiLinePanel() { activatePane('multi-line'); multiLinePanel.render(); }
element<HTMLButtonElement>('#multi-line-tool').addEventListener('click', openMultiLinePanel);
element<HTMLButtonElement>('#multi-line-open').addEventListener('click', openMultiLinePanel);
element<HTMLButtonElement>('#multi-line-toggle').addEventListener('click', () => {
  const enabling = !session.multiLineEnabled;
  session.setMultiLineEnabled(enabling, session.focus === 'events' ? 'events' : 'notes');
  if (enabling) openMultiLinePanel();
});
element<HTMLButtonElement>('#multi-line-prev-add').addEventListener('click', () => session.addPreviousMultiLine());
element<HTMLButtonElement>('#multi-line-prev-remove').addEventListener('click', () => session.removeMinimumMultiLine());
element<HTMLButtonElement>('#multi-line-next-add').addEventListener('click', () => session.addNextMultiLine());
element<HTMLButtonElement>('#multi-line-next-remove').addEventListener('click', () => session.removeMaximumMultiLine());
element<HTMLButtonElement>('#multi-line-merge').addEventListener('click', () => session.setMultiLineMerge(!session.multiLineMerge));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-return-chart]')) button.onclick = () => activatePane('chart');
for (const form of document.querySelectorAll<HTMLFormElement>('#properties, #event-properties')) form.addEventListener('submit', event => { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-icon]')) button.style.setProperty('--icon', `url('${assetUrl(`rpe/Texture/icon/${button.dataset.icon}.png`)}')`);
function togglePreview(force?: boolean, stay = false, replay = false) {
  const visible = force ?? !preview.visible;
  if (visible) clearNoteSourceToast();
  if (visible && (!preview.visible || replay)) {
    previewReturnTime = audio.time; timeline.cancelPlacement();
    if (replay) playback.seek(0);
    if ((editorPreferences.autoplayView ?? preferences.settings.autoplayView) && !audio.playing && !playback.pending) togglePlayback().catch(reportError);
  }
  if (!visible && preview.visible) playback.seek(stay ? audio.time : previewReturnTime);
  preview.visible = visible;
  element('.preview-wrap').hidden = !preview.visible;
  element<HTMLButtonElement>('#view-toggle').classList.toggle('active', preview.visible);
  element('#multi-line-labels').hidden = preview.visible;
  element<HTMLInputElement>('#multi-line-scroll').hidden = preview.visible;
  element('#preview-title').textContent = session.chart.META.name ?? '';
  timeline.origin = currentBeat();
  invalidate();
}

/**
 * Binds a click handler that reports its own failures.
 *
 * The callback's return value is `unknown` because several handlers are `listen('#x', () => someFn())`
 * and that `someFn` returns a boolean or an element; `addEventListener` has always discarded it.
 */
function listen(selector: string, callback: () => unknown) {
  element<HTMLButtonElement>(selector).addEventListener('click', async () => {
    try { await callback(); } catch (failure) { reportError(failure); }
  });
}

let lineInfoVisible = false;
const lineInfoNumber = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '0.00';
/**
 * The readout for the easing event under the cursor, or `null` for a track with no rate readout.
 *
 * `event` is optional because `EventTrack.events` is a `ChartEvent[]` whose `event` field the
 * timeline may leave unset; the `!event` guard is the original's and stays.
 */
function selectedEventSpeed(type: string, event: ChartEvent | undefined) {
  if (!event) return null;
  const duration = tempo.seconds(event.endTime, session.line?.bpmfactor ?? 1) - tempo.seconds(event.startTime, session.line?.bpmfactor ?? 1);
  if (!Number.isFinite(duration) || Math.abs(duration) < 0.000001 || !Number.isFinite(event.start) || !Number.isFinite(event.end)) return null;
  const rate = (Number(event.end) - Number(event.start)) / duration;
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
  // A speed track's value is a number at runtime; `EventTrack.value` is typed `TrackValue` because the
  // same method serves the colour and text tracks. `Number(...)` is how `scene.ts` reads it back
  // (`this.tracks[type].reduce((sum, track) => sum + Number(track.value(seconds)), 0)`), and `|| 0`
  // keeps the original's treatment of a non-finite read.
  const scrollSpeed = runtime?.speeds?.reduce((sum, track) => sum + (Number(track.value(seconds)) || 0), 0) ?? 0;
  const line = session.line;
  const lineText = `Pos: (${lineInfoNumber(state.x)},${lineInfoNumber(state.y)})  Dir: ${lineInfoNumber(state.rotation)}  Alpha: ${lineInfoNumber(state.alpha, 0)}  Speed: ${lineInfoNumber(scrollSpeed)}`;
  const dt = 1 / 120;
  const before = lineInfoScene.sampler(seconds - dt)(session.lineIndex) ?? state;
  const after = lineInfoScene.sampler(seconds + dt)(session.lineIndex) ?? state;
  const xSpeed = (after.x - before.x) / (2 * dt) / 120;
  const ySpeed = (after.y - before.y) / (2 * dt) / 120;
  const rotateSpeed = (after.rotation - before.rotation) / (2 * dt);
  const activeSpeeds: string[] = [];
  /**
   * The readouts the original loop walked.
   *
   * The original tuple also named `'speedEvents'`, but `LineTracks` has no such member — the speed
   * track lives in `runtime.speeds` (`SpeedIntegral[]`), not in `runtime.tracks` — so that fourth
   * pass always iterated `undefined` and contributed nothing. Only the three tracks below can push a
   * readout, which is what this list states; adding the `speeds` pass would introduce entries the
   * original never produced.
   */
  const rateTracks: [keyof LineTracks, string][] = [['moveXEvents', 'X'], ['moveYEvents', 'Y'], ['rotateEvents', 'R']];
  for (const [type] of rateTracks) {
    for (const track of runtime?.tracks?.[type] ?? []) {
      for (const entry of track.events ?? []) {
        if (seconds < entry.start || seconds > entry.end) continue;
        const rate = selectedEventSpeed(type, entry.event);
        if (rate) activeSpeeds.push(rate);
      }
    }
  }
  const selectedSpeeds: string[] = [];
  for (const key of session.eventSelection ?? []) {
    const separator = key.lastIndexOf(':');
    const type = separator < 0 ? key : key.slice(0, separator);
    const index = Number(key.slice(separator + 1));
    // The key's track segment is a `AnyEventType` by construction (`eventKey` builds it), so the
    // narrowing test records that rather than changing which events are looked up.
    const event = isEventType(type) ? eventList(session, type)[index] : undefined;
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
  const editor = element('.editor');
  editor.classList.toggle('multi-notes', session.multiLineActive && session.multiLineMode === 'notes');
  editor.classList.toggle('multi-events', session.multiLineActive && session.multiLineMode === 'events');
  const context = `${session.lineIndex}:${timeline.layer}`;
  if (placementContext !== context) { timeline.cancelPlacement(); placementContext = context; }
  if (tempoEntries !== session.chart.BPMList) { tempoEntries = session.chart.BPMList; tempo = new TempoMap(tempoEntries); }
  timeline.tempo = tempo;
  session.tempo = tempo; session.division = timeline.division;
  session.cutDensity = Number(element<HTMLInputElement>('#event-cut-density').value);
  updateLineInfo();
  // `scrollValueIncrement` is a key of the raw legacy `Settings.json`, which `MigratedPreferences`
  // deliberately keeps loosely typed (`Record<string, unknown>`), so the array is read through an
  // `Array.isArray` check. The guard only admits a value `Number.isFinite` would accept anyway, and a
  // non-array falls through to the empty entries the original's index expression also produced.
  const scrollIncrements: unknown = preferences.originalSettings.scrollValueIncrement;
  const increments = Array.isArray(scrollIncrements) ? scrollIncrements : [];
  session.eventWheelSteps = Object.fromEntries(['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents', 'scaleXEvents', 'scaleYEvents'].flatMap((key, index) => Number.isFinite(increments[index]) ? [[key, increments[index] as number]] : []));
  timeline.origin = currentBeat();
  element('#document-name').textContent = atHome ? '谱面库' : `${session.history.dirty ? '● ' : ''}${session.chart.META.name ?? chartName}`;
  renderTimelineMarkers();
  element('#note-count').textContent = `${session.notes.length} notes`;
  /**
   * Counts the events a line holds across its layers and its `extended` bag.
   *
   * `EventLayer` values are `ChartEvent[] | undefined`, so the `Array.isArray` filter is the same
   * test the original wrote; the `events.length` read that follows is safe because the filter has
   * already established the array. The parameter is a partial `JudgeLine` because one call site
   * passes `session.line ?? {}`.
   */
  const countEvents = (line: Partial<JudgeLine>) => [...(line.eventLayers ?? []), line.extended ?? {}].reduce((total, layer) => total + Object.entries(layer ?? {}).filter(([type, events]) => type !== 'paintEvents' && Array.isArray(events)).reduce((count, [, events]) => count + (events as ChartEvent[]).length, 0), 0) + shaderEvents(session.chart, session.chart.judgeLineList?.indexOf(line as JudgeLine) ?? -1).length;
  const totalLines = session.chart.judgeLineList?.length ?? 0;
  const totalNotes = (session.chart.judgeLineList ?? []).reduce((count, line) => count + (line.notes?.length ?? 0), 0);
  const totalEvents = (session.chart.judgeLineList ?? []).reduce((count, line) => count + countEvents(line), 0);
  const chartInfo = [['谱面统计', `Notes: ${session.notes.length}  Events: ${countEvents(session.line ?? {})}  TotalLines: ${totalLines}  TotalNotes: ${totalNotes}  TotalEvents: ${totalEvents}  Time: ${formatEditTime(editTimeSeconds)}`]];
  element('#chart-info').replaceChildren(...chartInfo.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    return [term, description];
  }));
  // The metadata panel reports which of the two media slots are still empty, so a chart whose music
  // or cover never made it into the archive says so instead of rendering silently without them.
  const songName = session.chart.META?.song;
  const backgroundName = session.chart.META?.background;
  const missingMedia = [!songName || !assets.has(songName) ? '音乐' : '', !backgroundName || !assets.has(backgroundName) ? '封面' : ''].filter(Boolean);
  const materialHint = element<HTMLElement>('#chart-material-hint');
  if (materialHint) materialHint.textContent = missingMedia.length ? `缺少${missingMedia.join('、')} · 进入谱面信息添加` : '';
  const mediaStatus = element<HTMLElement>('#metadata-media-status');
  if (mediaStatus) mediaStatus.textContent = `音乐：${songName && assets.has(songName) ? songName : '未载入'}　封面：${backgroundName && assets.has(backgroundName) ? backgroundName : '未载入'}`;
  if (!session.liveBeatEdit) element<HTMLInputElement>('#offset').value = String(session.chart.META.offset ?? 0);
  element('#selection-info').textContent = session.focus === 'events' ? `${session.eventSelection.size} 个事件已选` : `${session.selection.size} 个音符已选`;
  element<HTMLButtonElement>('#undo').disabled = !session.history.undoStack.length;
  element<HTMLButtonElement>('#redo').disabled = !session.history.redoStack.length;
  element<HTMLButtonElement>('#batch-run').disabled = !session.selection.size;
  element<HTMLSelectElement>('#line-select').replaceChildren();
  (session.chart.judgeLineList ?? []).forEach((line, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = lineDisplayLabel(session.chart, index); element<HTMLSelectElement>('#line-select').append(option);
  });
  element<HTMLSelectElement>('#line-select').value = String(session.lineIndex);
  element<HTMLButtonElement>('#multi-line-toggle').classList.toggle('active', session.multiLineActive);
  element<HTMLButtonElement>('#multi-line-toggle').setAttribute('aria-pressed', String(session.multiLineActive));
  element<HTMLButtonElement>('#notes-only').disabled = session.multiLineActive;
  element('#multi-line-count').textContent = String(session.multiLineActive ? session.multiLineIndices.length : 0);
  element<HTMLButtonElement>('#multi-line-merge').classList.toggle('active', session.multiLineMerge && session.multiLineMode === 'notes');
  element<HTMLButtonElement>('#multi-line-merge').disabled = !session.multiLineActive || session.multiLineMode !== 'notes';
  const hasLines = session.multiLineActive && session.multiLineIndices.length;
  element<HTMLButtonElement>('#multi-line-prev-add').disabled = !hasLines || session.multiLineIndices.length >= session.chart.judgeLineList.length;
  element<HTMLButtonElement>('#multi-line-next-add').disabled = !hasLines || session.multiLineIndices.length >= session.chart.judgeLineList.length;
  element<HTMLButtonElement>('#multi-line-prev-remove').disabled = !hasLines;
  element<HTMLButtonElement>('#multi-line-next-remove').disabled = !hasLines;
  element<HTMLButtonElement>('#line-next').disabled = element<HTMLButtonElement>('#line-previous').disabled = session.chart.judgeLineList.length < 2;
  const lineGroup = element('#line-group-label');
  if (lineGroup) { const line = session.line; lineGroup.textContent = line && !isDefaultLineGroup(session.chart, line) ? lineGroupName(session.chart, line) : ''; lineGroup.title = lineGroup.textContent ? `当前判定线分组：${lineGroup.textContent}` : ''; }
  if (activePaneName === 'lines') linePanel.render();
  updateLayerButtons();
  const liveIssues = diagnose(session.chart);
  const liveSignature = liveIssues.map(issue => `${issue.severity}:${issue.path}:${issue.message}`).sort().join('|');
  if (lastDiagnosticSignature !== null && liveSignature !== lastDiagnosticSignature && activePaneName !== 'diagnose') {
    const previous = new Set(lastDiagnosticSignature.split('|').filter(Boolean));
    const addedErrors = liveIssues.filter(issue => issue.severity === 'error' && !previous.has(`${issue.severity}:${issue.path}:${issue.message}`));
    if (addedErrors.length) notify(`谱面检查新增 ${addedErrors.length} 个错误`, 'error', 4200);
  }
  lastDiagnosticSignature = liveSignature;
  if (activePaneName === 'diagnose') renderDiagnostics();
  if (activePaneName === 'history') renderHistoryPanel();
  if (activePaneName === 'multi') multiEdit.sync();
  if (activePaneName === 'multi-line') multiLinePanel.render();
  if (activePaneName === 'metadata') renderMetadataPanel(session, element('#metadata-editor'), () => { activatePane('chart'); renderSession(); });
  if (activePaneName === 'bpm') renderBpmPanel(session, element('#bpm-editor'), () => { activatePane('chart'); renderSession(); });
  session.eventLayer = timeline.layer;
  renderProperties(session, reportError);
  if (!session.liveEventEdit) renderEventInspector(session, tempo, currentBeat, reportError, notify);
  decorateBeatInputs();
  if (session.eventSelection.size) {
    // `size` guarantees the iterator yields a key, which is what the original relied on; the binding
    // names that same first key so the `split` below reads a string rather than `string | undefined`.
    const firstKey = session.eventSelection.values().next().value;
    if (firstKey !== undefined) timeline.eventPlacementType = firstKey.split(':')[0];
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
    if (multiEdit.committing) multiEdit.sync();
    else if (activePaneName === 'collaboration') collaboration.renderState();
    else if (trajectoryPanel.active && selectionCount !== 1) activatePane('trajectory');
    else if (curveEditorOpen) activatePane('curve');
    else if (activePaneName === 'clipboard') renderClipboardPanel();
    else if (selectionCount > 1) { activatePane('multi'); multiEdit.open(session.focus === 'events' ? 'events' : 'notes'); }
    else if (selectionCount === 1) {
      const entries = session.multiLineActive && session.multiLineMode === 'events'
        ? [...session.multiEventSelection].flatMap(([lineIndex, keys]) => [...keys].map(key => ({ lineIndex, key })))
        : [...session.eventSelection].map(key => ({ lineIndex: session.lineIndex, key }));
      const selected = entries.length === 1 ? entries[0] : null;
      // The selection key is `<track>:<index>`; both halves are only read once `selected` proves the
      // single-selection case, which is also what the original relied on when it indexed directly.
      const [type, index] = selected?.key.split(':') ?? [];
      const track = selected && type ? session.chart.judgeLineList[selected.lineIndex]?.eventLayers?.[timeline.layer]?.[type as AnyEventType] : undefined;
      const event = track?.[Number(index)];
      if (session.focus === 'events' && event?.trajectory && selected) { curveEditorOpen = false; trajectoryPanel.open(event, selected.lineIndex, timeline.layer); }
      else activatePane(session.focus === 'events' ? 'events' : 'notes');
    }
    else if (!['multi-line', 'lines', 'assets', 'collaboration'].includes(activePaneName)) activatePane('chart');
  }
  const limits = previewLimitations(session.chart);
  element('#compatibility').textContent = '已使用原 RPE 音符素材与打击音；支持封面、静态纹理、多线与控制曲线。尚需原版逐帧对照。' + (limits.length ? `需进一步验证：${limits.join('、')}。` : '');
  invalidate();
}

session.addEventListener('change', renderSession);

function replaceChart(chart: Chart, name: string, nextAssets: Map<string, Uint8Array> = new Map(), nextFolders: Iterable<string> = []) {
  assertChart(chart);
  if (!collaborationJoining && collaboration.client.active) collaboration.client.leave();
  lineSwitcher.reset();
  playback.pause(); audio.clear();
  audioAnalysis.setBuffer(null);
  hitSounds.stop(); hitSounds.onlyCurrentLine = false; element<HTMLButtonElement>('#mute-current-line').setAttribute('aria-pressed', 'false'); element<HTMLButtonElement>('#mute-current-line').classList.remove('active'); images.clear(); libraryProject = null;
  session.removeEventListener('change', renderSession);
  session = new EditorSession(chart);
  clipboardHistory.attach(session);
  lastSelectionSignature = '';
  activatePane('chart');
  session.history.limit = preferences.settings.historyLimit;
  session.addEventListener('change', renderSession);
  recoveryId = crypto.randomUUID();
  lastDraftDocument = undefined;
  autoSave.reset(performance.now());
  heldPreview = null; curveStart = null; curveEnd = null; curveAnchorMode = null; curveEditorOpen = false; loop = null; element<HTMLInputElement>('#loop-enabled').checked = false;
  assets = nextAssets;
  assetFolders = new Set(nextFolders ?? []);
  assetDirty = false;
  chartName = name;
  resetEditClock(chart);
  hitSounds.setProject(chart, assets, name);
  images.load(chart, assets, name);
  timeline.origin = 0;
  timeline.layer = 0;
  timeline.cancelPlacement();
  preview.visible = false; element('.preview-wrap').hidden = true; element<HTMLButtonElement>('#view-toggle').classList.remove('active');
  element('#preview-title').textContent = chart.META.name ?? '';
  element('#music-name').textContent = '无音乐 · 时钟预览';
  element<HTMLInputElement>('#scrubber').max = String(600);
  renderSession();
  hasDocument = true; setHome(false);
  status(`已打开 ${name}`);
}

function guardReplace(action: () => void) {
  if (session.history.dirty || assetDirty) confirmAction('切换谱面？', action);
  else action();
}

async function loadCandidate(candidate: LoadCandidate, nextAssets: Map<string, Uint8Array>) {
  // The two provenance fields live inside the stored document, so they are read through the narrow
  // view rather than off `StoredProject` itself.
  const provenance: CandidateProvenance = candidate.project ?? {};
  attachExternalEffects([candidate], nextAssets);
  replaceChart(candidate.chart, candidate.name, nextAssets, provenance.assetFolders ?? []);
  libraryProject = candidate.libraryProject ?? null;
  images.load(candidate.chart, assets, chartName, candidate.info);
  const references = resourceReferences(candidate.chart, assets, chartName, candidate.info);
  const bytes = assetBytes(assets, references.song, chartName);
  if (bytes) await loadMusic(bytes, references.song, false);
  else if (references.song) status(`谱面已打开，未找到音乐：${references.song}，请手动选择音乐`);
  if (session.chart === candidate.chart && provenance.viewState) {
    const lineIndex = provenance.viewState.lineIndex;
    // `Number.isInteger` already rejects `undefined`; the explicit test records that for the index
    // expressions below and is a no-op for every value the original could reach.
    if (lineIndex !== undefined && Number.isInteger(lineIndex) && session.chart.judgeLineList?.[lineIndex]) session.selectLine(lineIndex);
  }
}

async function loadMusic(bytes: Uint8Array, name: string, updateMetadata = true) {
  const chartPosition = chartSeconds();
  playback.pause();
  const loadingSession = session;
  // `Uint8Array.buffer` is typed `ArrayBufferLike`, and `load` takes the concrete `ArrayBuffer` it
  // passes to `decodeAudioData`. The bytes are always backed by a plain ArrayBuffer here — `openFiles`
  // and the file readers below build them with `new Uint8Array(await file.arrayBuffer())`.
  const buffer = bytes.buffer as ArrayBuffer;
  const loaded = await audio.load(buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name);
  if (!loaded || session !== loadingSession) return;
  audioAnalysis.setBuffer(audio.buffer);
  assets.set(name, bytes);
  element('#music-name').textContent = name;
  element<HTMLInputElement>('#scrubber').max = String(audio.duration);
  renderTimelineMarkers();
  if (updateMetadata) session.commit('选择音乐', { ...session.chart, META: { ...session.chart.META, song: name } });
  playback.seek(chartPosition + offsetSeconds());
}

function seekBeat(value: number, pause = true) {
  playback.seek(tempo.seconds(value, session.line?.bpmfactor ?? 1) + (session.chart.META.offset ?? 0) / 1000, pause);
  invalidate();
}

async function togglePlayback() {
  if (!audio.playing && !playback.pending) preview.effectsSince = realtimePreview.effectsSince = chartSeconds() - 0.001;
  await playback.toggle(session.chart);
  invalidate();
}

function save() {
  const savingSession = session;
  // The capture closure returns the document it saved alongside the project, so `complete` can mark
  // exactly that revision as saved. Naming the snapshot here is what lets `ManualSaveQueue` infer its
  // project type from `storeProject` while still typing the extra `document` field.
  type SaveSnapshot = { document: Chart; project: StoredProject };
  return manualSaves.save(savingSession, (): SaveSnapshot => {
    const document = session.chart; const snapshot = { ...document }; delete snapshot.chartTime;
    const project: StoredProject = { ...(libraryProject ?? { id: crypto.randomUUID(), source: 'Next 本地项目', imported: Date.now() }),
      chart: snapshot, chartName, assets: [...assets], assetFolders: [...assetFolders], bytes: [...assets.values()].reduce((sum, bytes) => sum + bytes.length, 0), updated: Date.now(), viewState: { lineIndex: session.lineIndex } };
    status('正在后台保存，可继续编辑…');
    return { document, project };
  }, ({ document, project }) => {
    savingSession.history.markSaved(document);
    if (session !== savingSession) return;
    libraryProject = project;
    // `assetFolders` and `viewState` are optional on `StoredProject` because records written by older
    // builds carry neither; this project was just built with both, so the fallbacks are unreachable
    // here and only satisfy the optional type.
    const savedFolders = project.assetFolders ?? [];
    assetDirty = assets.size !== project.assets.length || project.assets.some(([name, bytes]) => assets.get(name) !== bytes)
      || assetFolders.size !== savedFolders.length || savedFolders.some(folder => !assetFolders.has(folder));
    renderSession();
    const message = session.history.dirty || assetDirty ? '已保存开始保存时的版本；后续修改尚未保存' : '已保存到谱面库';
    status(message); notify(message, 'success');
  });
}

function validateCommit(label: string, next: Chart) { assertChart(next); session.commit(label, next); }

function editEvent(type: AnyEventType, index: number | null, beat: number = currentBeat()) {
  if (!session.line) { status('请先添加判定线'); return; }
  timeline.eventPlacementType = type;
  timeline.extended = !isBaseEventType(type);
  timeline.indexedLayer = undefined;
  session.focus = 'events'; session.eventLayer = timeline.layer; session.selection.clear();
  activatePane('events');
  if (index !== null) { session.eventSelection = new Set([eventKey(type, index)]); session.notify(); return; }
  timeline.eventInteraction.place(type, beat);
  status(timeline.eventInteraction.pending ? '移到事件终点，按 R 或点击完成；Esc 取消' : '事件放置完成');
}

listen('#new', () => guardReplace(() => replaceChart(createChart(), 'chart.json')));
listen('#home-new', () => element('#new').click());
listen('#home-open', () => element('#open').click());
listen('#home-migrate', () => element('#migrate').click());
listen('#resume-editor', () => setHome(false));
listen('#open', () => { element<HTMLInputElement>('#file-input').click(); });
element<HTMLInputElement>('#file-input').addEventListener('change', async event => {
  // The listener is bound to `#file-input`, so the target is that input; the binding keeps the
  // original's unguarded `.files` / `.value` reads without adding a branch.
  const input = event.target as HTMLInputElement;
  try {
    // `.files` is null only when the picker was cancelled, in which case `openFiles` reports
    // nothing to load anyway; `?? []` therefore leaves the outcome identical.
    const loaded = await openFiles(input.files ?? []);
    if (!loaded) return;
    const proceed = () => {
      if (loaded.candidates.length === 1) loadCandidate(loaded.candidates[0], loaded.assets).catch(reportError);
      else choose('选择谱面', '包中有多份 RPE 谱面，其他文件会随 PEZ 导出保留。', loaded.candidates, candidate => `${candidate.name} · ${candidate.chart.META.name ?? ''}`, candidate => loadCandidate(candidate, loaded.assets));
    };
    guardReplace(proceed);
  } catch (failure) { reportError(failure); }
  finally { input.value = ''; }
});
listen('#save', () => save());
listen('#export', () => showExportDialog(session.chart, assets, chartName, name => status(`已发起下载：${name}`)));
listen('#view-toggle', () => togglePreview());
listen('#close-preview', () => togglePreview(false, true));
listen('#background', () => element<HTMLInputElement>('#background-input').click());
element<HTMLInputElement>('#background-input').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  try {
    const candidate = input.files?.[0]; if (!candidate) return;
    const loadingSession = session;
    const bytes = new Uint8Array(await candidate.arrayBuffer());
    if (session !== loadingSession) return;
    assets.set(candidate.name, bytes);
    session.commit('选择封面', { ...session.chart, META: { ...session.chart.META, background: candidate.name } });
    await images.load(session.chart, assets, chartName);
  } catch (failure) { reportError(failure); }
  finally { input.value = ''; }
});
listen('#music', () => element<HTMLInputElement>('#music-input').click());
element<HTMLInputElement>('#music-input').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  try {
    const loadingSession = session;
    const candidate = input.files?.[0];
    if (candidate) {
      const bytes = new Uint8Array(await candidate.arrayBuffer());
      if (session === loadingSession) await loadMusic(bytes, candidate.name);
    }
  }
  catch (failure) { reportError(failure); }
  finally { input.value = ''; }
});
listen('#recover', async () => {
  const drafts = await listDrafts(atHome ? null : (libraryProject?.id ?? recoveryId));
  choose('恢复自动备份', drafts.length ? '新备份包含媒体；0.3 及更早的草稿仅包含谱面。恢复后请保存到谱面库。' : '此浏览器尚无自动备份。', drafts,
    draft => `${draft.title} · ${new Date(draft.updated).toLocaleString()}`,
    entry => { guardReplace(async () => {
      try {
        const draft = await readDraft(entry.id);
        if (!draft) throw new Error('此备份已被轮替，请重新打开备份列表');
        // A recovered draft has no stored project; the provenance it carries is read through the same
        // view as a library record, so a draft with no `viewState` yields `null` and the loader's
        // existing `?? {}` fallback applies, exactly as before.
        await loadCandidate({ chart: draft.chart, name: draft.name, project: candidateProvenance(draft) }, new Map(draft.assets ?? []));
        // A recovered draft has no stored counterpart, so the session must read as modified. The
        // original assigned `null` to break `History.dirty`'s identity check; that check compares the
        // two charts by reference, so recording the pre-load chart as "saved" leaves `dirty` true
        // exactly as before — `draft.chart` is the object the pre-load session held, and the load
        // built a new session whose document is a different object.
        libraryProject = null; session.history.markSaved(draft.chart); renderSession();
      } catch (error) { reportError(error); }
    }); });
});
listen('#play', togglePlayback);
listen('#rewind', () => seekBeat(0));
listen('#seek', () => seekBeat(beatValue(parseBeat(element<HTMLInputElement>('#seek-beat').value))));
element<HTMLInputElement>('#scrubber').addEventListener('input', (event: Event) => playback.seek(Number((event.target as HTMLInputElement).value)));
element<HTMLInputElement>('#rate').addEventListener('change', (event: Event) => audio.setRate(Number((event.target as HTMLInputElement).value)));
element<HTMLInputElement>('#offset').addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (!Number.isFinite(value)) { input.value = String(session.chart.META.offset ?? 0); return; }
  const chartPosition = chartSeconds();
  session.commit('修改谱面延迟', { ...session.chart, META: { ...session.chart.META, offset: value } });
  playback.seek(chartPosition + value / 1000);
});
function nudgeBeatInput(input: HTMLInputElement, direction: number) {
  try {
    const current = beatValue(parseBeat(input.value || '0'));
    const next = Math.max(0, current + direction / Math.max(1, timeline.division));
    input.value = formatBeat(fromNumber(next));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (failure) { reportError(failure); }
}
function decorateBeatInputs() {
  for (const input of document.querySelectorAll<HTMLInputElement>('#properties input[aria-label$="拍"], #event-properties input[aria-label$="拍"]')) {
    if (input.dataset.beatDecorated) continue;
    input.dataset.beatDecorated = 'true';
    const holder = input.parentElement;
    const wrapper = document.createElement('span'); wrapper.className = 'beat-input-wrap';
    const nudge = document.createElement('span'); nudge.className = 'beat-nudge';
    const nudges: [number, string][] = [[1, '▴'], [-1, '▾']];
    for (const [direction, symbol] of nudges) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol; button.title = direction < 0 ? '减少一格' : '增加一格';
      button.dataset.beatNudge = String(direction); button.onclick = () => nudgeBeatInput(input, direction); nudge.append(button);
    }
    input.replaceWith(wrapper); wrapper.append(input, nudge);
    input.addEventListener('wheel', (event: WheelEvent) => { event.preventDefault(); nudgeBeatInput(input, event.deltaY < 0 ? 1 : -1); }, { passive: false });
  }
}
element<HTMLButtonElement>('#chart-info-toggle').addEventListener('click', event => {
  const info = element('#chart-info'); info.hidden = !info.hidden;
  // The listener is bound to `#chart-info-toggle`, so the currentTarget is that button.
  (event.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(!info.hidden));
});
element<HTMLInputElement>('#volume').addEventListener('input', (event: Event) => { audio.setVolume(Number((event.target as HTMLInputElement).value)); persistEditor(); });
element<HTMLSelectElement>('#preview-mode').addEventListener('change', (event: Event) => { preview.allLines = realtimePreview.allLines = (event.target as HTMLSelectElement).value === 'all'; persistEditor(); invalidate(); });
/**
 * The three inputs whose value is written straight onto a numeric `Timeline` field.
 *
 * The tuple is typed because `property` indexes `Timeline`; the original array literal widened it to
 * `string`, which only worked because the editor was untyped.
 */
const numericTimelineFields: [string, 'division' | 'gridCount' | 'scale', number, number, boolean][] = [['#division', 'division', 1, 100, true], ['#grid-count', 'gridCount', 2, 100, false], ['#y-scale', 'scale', 20, 2000, false]];
for (const [selector, property, minimum, maximum, integer] of numericTimelineFields) {
  element<HTMLInputElement>(selector).addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
    if (Number.isFinite(value)) timeline[property] = Math.max(minimum, Math.min(maximum, integer ? Math.round(value) : value));
    input.value = String(timeline[property]); session.division = timeline.division; updateCurvePanel(); persistEditor(); invalidate();
    if (property === 'scale') element<HTMLInputElement>('#y-scale-slider').value = String(timeline.scale);
  });
}
element<HTMLInputElement>('#y-scale-slider').addEventListener('input', event => {
  timeline.scale = Number((event.target as HTMLInputElement).value); element<HTMLInputElement>('#y-scale').value = String(timeline.scale); persistEditor(); invalidate();
});
element<HTMLInputElement>('#snap-x').addEventListener('change', (event: Event) => { timeline.snapX = (event.target as HTMLInputElement).checked; persistEditor(); invalidate(); });
function updateLayerButtons() {
  const container = element('#layer');
  if (!container.children.length) for (let index = 0; index <= MAX_BASE_LAYERS; index++) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = index === MAX_BASE_LAYERS ? '特' : String(index);
    button.onclick = () => {
      timeline.cancelPlacement(); timeline.extended = index === MAX_BASE_LAYERS;
      if (!timeline.extended) timeline.layer = index;
      timeline.indexedLayer = undefined; session.eventLayer = timeline.layer; session.eventSelection.clear();
      timeline.eventPlacementType = timeline.eventTypes[0]; session.notify();
    };
    container.append(button);
  }
  const bottom = timeline.beatAt(timeline.notesCanvas.clientHeight); const top = timeline.beatAt(0);
  timelineActivity.compile(session.chart, tempo);
  // The children are the buttons the loop above appended, so the `HTMLButtonElement` view is what
  // the original untyped code already assumed; the widening is recorded per element, not copied.
  [...container.children].forEach((child, index) => {
    const button = child as HTMLButtonElement;
    const state = timelineActivity.layerState(session.lineIndex, index, index === MAX_BASE_LAYERS, bottom, top, timeline.eventBeatAt(timeline.notesCanvas.clientHeight, 'paintEvents'), timeline.eventBeatAt(0, 'paintEvents'));
    button.dataset.state = state;
    button.classList.toggle('active', timeline.extended ? index === MAX_BASE_LAYERS : index === timeline.layer);
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.title = `${index === MAX_BASE_LAYERS ? '特殊层' : `第 ${index} 层`} · ${state === 'empty' ? '空层' : state === 'visible' ? '当前视野内有事件' : '事件在当前视野外'}`;
  });
}
element<HTMLSelectElement>('#line-select').addEventListener('change', (event: Event) => { timeline.cancelPlacement(); session.selectLine(Number((event.target as HTMLSelectElement).value)); });
listen('#line-next', () => switchLine(1));
listen('#line-previous', () => switchLine(-1));
element<HTMLInputElement>('#hit-volume').addEventListener('input', (event: Event) => { hitSounds.setVolume(Number((event.target as HTMLInputElement).value)); persistEditor(); });
element<HTMLInputElement>('#hit-enabled').addEventListener('change', (event: Event) => { hitSounds.enabled = (event.target as HTMLInputElement).checked; hitSounds.stop(); persistEditor(); });
element<HTMLButtonElement>('#mute-current-line').addEventListener('click', () => {
  hitSounds.onlyCurrentLine = !hitSounds.onlyCurrentLine;
  const button = element<HTMLButtonElement>('#mute-current-line');
  button.setAttribute('aria-pressed', String(hitSounds.onlyCurrentLine));
  button.classList.toggle('active', hitSounds.onlyCurrentLine);
  hitSounds.stop(); invalidate();
});
element<HTMLInputElement>('#realtime-enabled').addEventListener('change', (event: Event) => { const checked = (event.target as HTMLInputElement).checked; realtimePreview.visible = checked; element<HTMLCanvasElement>('#realtime-preview').hidden = !checked; persistEditor(); invalidate(); });
element<HTMLInputElement>('#realtime-alpha').addEventListener('input', (event: Event) => { realtimePreview.opacity = Number((event.target as HTMLInputElement).value); persistEditor(); invalidate(); });
for (const selector of ['#loop-start', '#loop-end', '#loop-enabled']) element(selector).addEventListener('change', () => {
  try {
    const start = beatValue(parseBeat(element<HTMLInputElement>('#loop-start').value));
    const end = beatValue(parseBeat(element<HTMLInputElement>('#loop-end').value));
    if (start < 0 || end <= start) throw new Error('循环止拍必须大于起拍，起拍不能为负');
    loop = element<HTMLInputElement>('#loop-enabled').checked ? { start, end } : null;
  } catch (error) { loop = null; element<HTMLInputElement>('#loop-enabled').checked = false; reportError(error); }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.onclick = () => {
  timeline.cancelPlacement();
  timeline.tool = Number(button.dataset.tool);
  for (const item of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) item.classList.toggle('active', item === button);
  invalidate();
};
function travel(direction: 'undo' | 'redo', silent = false) {
  timeline.cancelPlacement();
  const stack = direction === 'undo' ? session.history.undoStack : session.history.redoStack;
  const command = stack.at(-1);
  if (!command) { notify(direction === 'undo' ? '没有可撤销的编辑' : '没有可重做的编辑', 'warning'); return; }
  session.travel(direction);
  if (!silent) notify(`${direction === 'undo' ? '撤销' : '重做'}：${command.label}`, 'success');
}
listen('#undo', () => travel('undo'));
listen('#redo', () => travel('redo'));
listen('#curve-notes', openCurvePanel);
listen('#curve-trajectory', () => { curveEditorOpen = false; trajectoryPanel.open(); });
listen('#curve-start', () => captureCurve(false));
listen('#curve-end', () => captureCurve(true));
function switchNoteView() {
  if (session.multiLineActive) return;
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
function captureCurve(end: boolean) {
  if (preview.visible) return;
  if (!curveEditorOpen) openCurvePanel();
  curveAnchorMode = end ? 'end' : 'start';
  if (end && !curveStart) { curveAnchorMode = null; throw new Error('请先按 Ctrl+F 选择曲线起点'); }
  element<HTMLButtonElement>('#curve-start')?.classList.toggle('active', !end);
  element<HTMLButtonElement>('#curve-end')?.classList.toggle('active', end);
  status(end ? '曲线终点选择中：点击一个音符' : '曲线起点选择中：点击一个音符');
}
listen('#notes-only', switchNoteView);
listen('#reset-camera', () => resetCamera(true));
listen('#game-ui', () => { editorPreferences.showGameUI = !preview.showGameUI; applyDisplaySettings(); persistEditor(); });
element<HTMLInputElement>('#preview-ratio').onchange = event => {
  [editorPreferences.ratioWidth, editorPreferences.ratioHeight] = (event.target as HTMLInputElement).value.split(':').map(Number);
  applyDisplaySettings(); persistEditor();
};
const numericPreferenceFields: [string, 'cameraX' | 'viewDivisor'][] = [['camera-x', 'cameraX'], ['view-divisor', 'viewDivisor']];
for (const [id, key] of numericPreferenceFields) element<HTMLInputElement>(`#${id}`).onchange = event => {
  const input = event.target as HTMLInputElement;
  if (!input.value.trim() || !input.validity.valid) { applyDisplaySettings(); return; }
  editorPreferences[key] = Number(input.value); applyDisplaySettings(); persistEditor();
};
element<HTMLButtonElement>('#toolbar-mode').onclick = () => {
  const modes: ToolbarMode[] = ['compact', 'icons', 'wide'];
  const current = editorPreferences.toolbarMode ?? 'compact';
  editorPreferences.toolbarMode = modes[(modes.indexOf(current) + 1) % modes.length];
  applyDisplaySettings(); persistEditor();
};
function copySelection() {
  const count = copyObjects(session);
  if (count) { clipboardHistory.remember(session); status(`已复制 ${count} 个物件`); }
  invalidate();
}
function deleteSelection() { deleteObjects(session); }
function cutSelection() { if (cutObjects(session)) clipboardHistory.remember(session); invalidate(); }
function pasteSelection(mirror = false, keepTime = false) {
  timeline.clipboardMode = { mirror, keepTime };
  pasteObjects(session, clipboardBeat(timeline), { ...timeline.clipboardMode, targetLineIndex: clipboardTargetLine() });
}
listen('#copy', copySelection);
listen('#cut', cutSelection);
listen('#paste', () => pasteSelection());
for (const [name, description] of BATCH_ACTIONS) {
  const option = new Option(name, name); option.title = description; element<HTMLSelectElement>('#batch-action').append(option);
}
element<HTMLSelectElement>('#batch-action').onchange = () => {
  // The select is populated from `BATCH_ACTIONS` above, so a selected value always has a matching
  // entry; the fallback keeps the title at its previous value for the impossible miss.
  const selected = element<HTMLSelectElement>('#batch-action').value;
  const action = BATCH_ACTIONS.find(([name]) => name === selected);
  if (action) element<HTMLButtonElement>('#batch-run').title = action[1];
};
const batchActionOnChange = element<HTMLSelectElement>('#batch-action').onchange;
if (batchActionOnChange) batchActionOnChange.call(element<HTMLSelectElement>('#batch-action'), new Event('change'));
listen('#batch-run', () => applyBatchAction(session, element<HTMLSelectElement>('#batch-action').value, timeline.gridCount));
listen('#delete', deleteSelection);
listen('#mirror', () => {
  if (session.focus === 'events') transformEvents(session, '镜像 X / 旋转事件', (event, type) => ['moveXEvents', 'rotateEvents'].includes(type) ? { ...event, start: -event.start, end: -event.end } : event);
  // `transformSelection` types the callback's note as optional because the same signature serves the
  // multi-line path; the single-selection path only ever passes a note the selection holds, which is
  // what makes the original's unconditional `-note.positionX` correct. `timeline.ts` narrows the same
  // way (`note => (note ? … : undefined)!`), so `!` records the established invariant rather than
  // adding a branch that could change what is written back.
  else session.transformSelection('镜像音符', note => ({ ...note!, positionX: -note!.positionX }));
});
listen('#metadata', () => { activatePane('metadata'); renderMetadataPanel(session, element('#metadata-editor'), () => { activatePane('chart'); renderSession(); }); });
listen('#bpm', () => { activatePane('bpm'); renderBpmPanel(session, element('#bpm-editor'), () => { activatePane('chart'); renderSession(); }); });
listen('#assets', () => { activatePane('assets'); assetLibrary.render(); });
listen('#audio-analysis-tool', () => {
  audioAnalysis.enabled = true; activatePane('audio-analysis'); audioAnalysis.render(element('#audio-analysis-panel')); audioAnalysis.draw(offsetSeconds()); persistEditor();
});
function renderHistoryPanel() {
  const host = element('#history-results'); if (!host) return;
  host.replaceChildren();
  const history = session.history; const current = history.undoStack.length;
  // `redoStack` is walked newest-first, which `toReversed` expressed; `[...stack].reverse()` produces
  // the same new array (the library target is ES2022, which has no `toReversed`).
  const entries: HistoryEntry[] = [{ label: '当前可回退的起点', index: 0 }, ...history.undoStack.map((command, index) => ({ label: command.label, index: index + 1 })), ...[...history.redoStack].reverse().map((command, index) => ({ label: command.label, index: current + index + 1 }))];
  for (const entry of entries) {
    const button = document.createElement('button'); button.type = 'button'; button.className = entry.index === current ? 'active' : ''; button.textContent = `${entry.index === current ? '● ' : ''}${entry.index} · ${entry.label}`;
    button.onclick = () => { const direction = entry.index < current ? 'undo' : 'redo'; for (let count = 0; count < Math.abs(entry.index - current); count++) travel(direction, true); renderHistoryPanel(); notify(`已定位到编辑历史第 ${entry.index} 步`, 'success', 1800); };
    host.append(button);
  }
}
listen('#history-panel', () => { activatePane('history'); renderHistoryPanel(); });
listen('#clear-clipboard', () => { clipboardHistory.clearCurrent(session); timeline.clipboardMode = {}; invalidate(); });
const clipboardButton = document.createElement('button'); clipboardButton.id = 'clipboard-history'; clipboardButton.textContent = '剪贴板历史'; clipboardButton.title = '长按 Ctrl+V';
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
/**
 * The two extra fields `ClipboardHistory.changed` hangs off its `change` event.
 *
 * `clipboard-history.ts` declares the same local shape; `addEventListener` hands the handler a bare
 * `Event`, so the fields are read through this view. Both are optional because the class also
 * dispatches a plain `Event('change')` with neither property set, which the `?? false` fallbacks
 * below treat exactly as the original `undefined` reads did.
 */
const clipboardChange = (event: Event) => event as Event & { persist?: boolean; reason?: string };
clipboardHistory.addEventListener('change', event => {
  const change = clipboardChange(event);
  if (activePaneName === 'clipboard' && change.reason !== 'rename') renderClipboardPanel();
  invalidate();
  if (!change.persist) return;
  const entries = structuredClone(clipboardHistory.entries);
  clipboardSave = clipboardSave.then(() => storeClipboardHistory(entries)).then(() => undefined).catch(failure => status(`剪贴板历史保存失败：${failureMessage(failure)}`));
});
readClipboardHistory().then(entries => clipboardHistory.restore(entries)).catch(failure => status(`剪贴板历史读取失败：${failureMessage(failure)}`));
function deleteDiagnosticIssue(issue: DiagnosticIssue) {
  if (issue.path.startsWith('paintEvents[')) {
    // A `paintEvents[…]` issue always carries both; the guards below are the same `undefined` tests
    // the original's untyped index expressions performed implicitly, and change nothing when the
    // fields are present, which is every path that reaches here.
    if (issue.line === undefined || issue.index === undefined) return;
    session.commit('删除着色器检查项', replaceShaderEvents(session.chart, issue.line, shaderEvents(session.chart, issue.line).filter((event, index) => index !== issue.index)));
    notify('已删除检查项对应对象', 'success'); return;
  }
  const chart = structuredClone(session.chart);
  if (issue.path.startsWith('notes[') && issue.line !== undefined && issue.index !== undefined && chart.judgeLineList?.[issue.line]) chart.judgeLineList[issue.line].notes.splice(issue.index, 1);
  else if (issue.path === 'father' && issue.line !== undefined && chart.judgeLineList?.[issue.line]) chart.judgeLineList[issue.line].father = -1;
  else if (issue.path.startsWith('BPMList[') && issue.index !== undefined) chart.BPMList.splice(issue.index, 1);
  else if (issue.line != null && issue.path.match(/^\w+Events\[/)) {
    if (issue.index === undefined) return;
    const type = issue.path.slice(0, issue.path.indexOf('[')); const line = chart.judgeLineList?.[issue.line];
    // An `extended` issue carries no layer (its events live on the line's `extended` bag); a base
    // layer issue always names one, which is what the original's untyped index assumed. A missing
    // layer on a non-extended issue is not an index the original could use either, so it falls
    // through to the same `return` the `!layer?.[type]` test below would have taken.
    if (!issue.extended && issue.layer === undefined) return;
    // The two bags are keyed by track name, so the lookup is widened the same way the original's
    // untyped read was; `isEventType` is the guard that accepts exactly the track names.
    if (!isEventType(type)) return;
    const bag: Partial<Record<AnyEventType, ChartEvent[]>> | undefined = issue.extended ? line?.extended : line?.eventLayers?.[issue.layer!];
    const events = bag?.[type];
    if (!events) return;
    events.splice(issue.index, 1);
  }
  else return;
  session.commit('删除检查项', chart); notify('已删除检查项对应对象', 'success');
}
function renderDiagnostics() {
  const host = element('#diagnose-results'); if (!host) return;
  host.replaceChildren();
  const issues = diagnose(session.chart); const visible = element<HTMLInputElement>('#diagnose-show-low')?.checked !== false;
  const signature = issues.map(issue => `${issue.severity}:${issue.path}:${issue.message}`).sort().join('|');
  if (lastDiagnosticSignature !== null && signature !== lastDiagnosticSignature) {
    const previous = new Set(lastDiagnosticSignature.split('|').filter(Boolean));
    const added = issues.filter(issue => !previous.has(`${issue.severity}:${issue.path}:${issue.message}`));
    if (added.some(issue => issue.severity === 'error')) notify(`谱面检查发现 ${added.filter(issue => issue.severity === 'error').length} 个错误`, 'error', 4200);
    else if (added.some(issue => issue.severity === 'warning')) notify(`谱面检查新增 ${added.filter(issue => issue.severity === 'warning').length} 个警告`, 'warning', 3600);
  }
  lastDiagnosticSignature = signature;
  const category = (issue: DiagnosticIssue) => {
    const top = issue.path.startsWith('notes[') ? '音符' : issue.path.match(/Events\[/) ? '事件' : '其他';
    const sub = issue.message.includes('超出') ? '超界' : issue.message.includes('重叠') ? '重叠' : issue.message.includes('时长') ? '时长' : issue.message.includes('父线') ? '父线' : '其他';
    return [top, sub];
  };
  for (const [severity, title] of [['error', '错误'], ['warning', '警告'], ['info', '提示']]) {
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
          const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = `Line ${issue.line} · ${issue.beat} 拍 · ${issue.message}`;
          locate.onclick = () => { session.selectLine(issue.line); seekBeat(issue.beat); notify(`已定位到 Line ${issue.line} · ${issue.beat} 拍`, 'success', 1800); };
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.disabled = !issue.path.includes('[') && issue.path !== 'father'; remove.onclick = () => deleteDiagnosticIssue(issue);
          row.append(locate, remove); subgroup.append(row);
        }
        parent.append(subgroup);
      }
      details.append(parent);
    }
    host.append(details);
  }
  if (!issues.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '未发现当前检查规则覆盖的问题。'; host.append(empty); }
}
listen('#diagnose', () => { activatePane('diagnose'); renderDiagnostics(); });
element<HTMLInputElement>('#diagnose-show-low').addEventListener('change', renderDiagnostics);
element<HTMLButtonElement>('#diagnose-close').addEventListener('click', () => activatePane('chart'));
element<HTMLButtonElement>('#history-close').addEventListener('click', () => activatePane('chart'));

function curveField(id: string, label: string, value: string | number, type = 'text', options: [string, string][] = []) {
  const row = document.createElement('label'); row.className = 'field'; row.append(label);
  // The two arms are built separately so each keeps its own element type: `type`/`step` only exist
  // on the input, and `value` is a string property on both. The original ternary produced the same
  // two elements.
  if (type === 'select') {
    const select = document.createElement('select');
    select.id = id;
    select.replaceChildren(...options.map(([optionValue, optionLabel]) => new Option(optionLabel, optionValue)));
    select.value = String(value); row.append(select);
    return row;
  }
  const input = document.createElement('input');
  input.id = id;
  input.type = type; input.step = 'any';
  input.value = String(value); row.append(input);
  if (type === 'number') numericWheel(input, id === 'curve-density' ? 0.25 : 1, direction => { input.value = String(Number(input.value) + direction * (id === 'curve-density' ? 0.25 : 1)); input.dispatchEvent(new Event('input', { bubbles: true })); });
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
    root.append(curveField('curve-start-time', '起点拍', formatBeat(curveValues.startTime)), curveField('curve-end-time', '终点拍', formatBeat(curveValues.endTime)),
      curveField('curve-start-x', '起点 X', curveValues.startX, 'number'), curveField('curve-end-x', '终点 X', curveValues.endX, 'number'),
      curveField('curve-density', '密度', curveValues.density, 'number'), curveField('curve-type', '类型', curveValues.type, 'select', [['1', 'Tap'], ['3', 'Flick'], ['4', 'Drag']]), curveField('curve-easing', '缓动编号（1–29）', curveValues.easingType, 'number'));
    root.addEventListener('input', () => {
      try {
        curveValues = { startTime: parseBeat(element<HTMLInputElement>('#curve-start-time').value), endTime: parseBeat(element<HTMLInputElement>('#curve-end-time').value), startX: Number(element<HTMLInputElement>('#curve-start-x').value), endX: Number(element<HTMLInputElement>('#curve-end-x').value), density: Number(element<HTMLInputElement>('#curve-density').value), type: Number(element<HTMLSelectElement>('#curve-type').value) as NoteType, easingType: Number(element<HTMLInputElement>('#curve-easing').value) };
        element('#curve-summary').textContent = `${generatedCurveCount()} 个中间音符 · 端点不重复添加`;
        curveEasingPicker?.select(curveValues.easingType);
        invalidate();
      } catch (error) { element('#curve-summary').textContent = failureMessage(error); }
    });
    const summary = document.createElement('p'); summary.id = 'curve-summary'; summary.className = 'hint'; root.append(summary);
    curveEasingPicker = createEasingPicker(curveValues.easingType, value => { curveValues.easingType = value; updateCurvePanel(); });
    root.append(curveEasingPicker.element);
  }
  const values: [string, string | number][] = [['#curve-start-time', formatBeat(curveValues.startTime)], ['#curve-end-time', formatBeat(curveValues.endTime)], ['#curve-start-x', curveValues.startX], ['#curve-end-x', curveValues.endX], ['#curve-density', curveValues.density], ['#curve-type', curveValues.type], ['#curve-easing', curveValues.easingType]];
  for (const [selector, value] of values) { const control = element<HTMLInputElement | HTMLSelectElement>(selector); if (document.activeElement !== control) control.value = String(value); }
  element('#curve-summary').textContent = `${generatedCurveCount()} 个中间音符 · 端点不重复添加`;
  curveEasingPicker?.select(curveValues.easingType);
  invalidate();
}
function openCurvePanel() {
  curveEditorOpen = true; curveStart = null; curveEnd = null; curveAnchorMode = null;
  element<HTMLButtonElement>('#curve-start')?.classList.remove('active'); element<HTMLButtonElement>('#curve-end')?.classList.remove('active');
  activatePane('curve'); updateCurvePanel(); status('曲线编辑：请选择起点音符');
}
function closeCurvePanel() {
  curveEditorOpen = false; curveStart = null; curveEnd = null; curveAnchorMode = null;
  element<HTMLButtonElement>('#curve-start')?.classList.remove('active'); element<HTMLButtonElement>('#curve-end')?.classList.remove('active');
  activatePane('chart'); invalidate();
}
listen('#curve-generate', () => {
  try {
    const notes = generateCurveNotes({ ...curveValues, division: timeline.division });
    if (!notes.length) throw new Error('当前参数没有可生成的中间音符');
    session.focus = 'notes'; session.eventSelection.clear(); session.insertNotes(notes, '生成曲线音符'); closeCurvePanel(); notify(`已生成 ${notes.length} 个曲线音符`, 'success');
  } catch (error) { reportError(error); }
});
listen('#curve-cancel', closeCurvePanel);
listen('#help', () => showDialog('Re:PhiEdit Next · 迁移预览版', HELP_TEXT));

let playbackSpaceHeld = false;
window.addEventListener('keydown', event => {
  if (atHome || !hasDocument || !shortcutMatches(event, preferences.hotkeys.ShowLineInfo) || dialogOpen() || isTypingText(event.target as ShortcutTargetArg)) return;
  event.preventDefault();
  if (event.repeat) return;
  lineInfoVisible = !lineInfoVisible;
  updateLineInfo();
}, true);
window.addEventListener('blur', () => { lineInfoVisible = false; element('#line-info-overlay')?.setAttribute('hidden', ''); });
window.addEventListener('keydown', event => {
  if (atHome || !hasDocument || dialogOpen() || isTextEntry(event.target as ShortcutTargetArg) || !shortcutMatches(event, preferences.hotkeys.Pause)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  playbackSpaceHeld = true;
  if (!event.repeat) togglePlayback().catch(reportError);
}, true);
window.addEventListener('keyup', event => {
  if (!shortcutReleased(event, preferences.hotkeys.Pause) || !playbackSpaceHeld) return;
  event.preventDefault(); event.stopImmediatePropagation(); playbackSpaceHeld = false;
}, true);
window.addEventListener('blur', () => { playbackSpaceHeld = false; });
window.addEventListener('keydown', async event => {
  // `keyboard.ts` types its parameter as a structural `ShortcutTarget` and probes every member before
  // using it (see `closest`); `isPlaybackSpace` in that same module casts `event.target` the same way.
  // The cast only names the members the three helpers below inspect.
  const target = event.target as ShortcutTargetArg;
  if (atHome || !hasDocument || dialogOpen() || isTypingText(target)) return;
  if (isTextEntry(target) && event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) return;
  if (batchControls.active) { event.preventDefault(); return; }
  const area = timeline.hoverArea ?? session.focus;
  const hasMultiSelection = [...(session.multiLineSelection?.values() ?? [])].some(values => values.size) || [...(session.multiEventSelection?.values() ?? [])].some(values => values.size);
  const hasSelection = Boolean(session.selection.size || session.eventSelection.size || hasMultiSelection);
  const action = shortcutAction(event, preferences, area, { hasSelection: hasSelection && !preview.visible });
  if (action || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) releaseShortcutFocus(target);
  if (pasteGesture.pending && action !== 'Paste') pasteGesture.cancel();
    if (action === 'Paste' && clipboardHistory.enabled && !preview.visible && shortcutMatches(event, preferences.hotkeys.ClipboardHistory ?? DEFAULT_HOTKEYS.ClipboardHistory)) {
    pasteGesture.down(event, { session, chart: session.chart, lineIndex: session.lineIndex, targetLineIndex: clipboardTargetLine(), layer: timeline.layer, beat: clipboardBeat(timeline) }); return;
  }
  // A key that matches no shortcut yields `undefined`; the `else if (action === '…')` chain below
  // never matched such a key either, falling through to `handled = false`, so returning here is a
  // no-op for every value it could receive — it only narrows the type for the chain.
  if (!action) return;
  let handled = true;
  try {
    if (event.repeat && ['NumberMirror', 'NumberFill', 'Pause', 'AddHold', 'AddEvent', 'AddTap', 'StartView', 'EndView', 'JumpView', 'ReplayView', 'StartView_HOLD', 'JumpView_HOLD', 'ToggleMultiLine', 'SwitchMultiLineMode'].includes(action)) { event.preventDefault(); return; }
    // `action` is narrowed to a string by the guard above, and the `Page*` test guarantees the
    // lookup below hits; the explicit key type is what lets the index be read without a cast.
    const pageKey = action as 'PageLeft' | 'PageRight' | 'PageUp' | 'PageDown';
    if (!preview.visible && action.startsWith('Page')) nudgeSelection(session, { PageLeft: 'ArrowLeft', PageRight: 'ArrowRight', PageUp: 'ArrowUp', PageDown: 'ArrowDown' }[pageKey], timeline.division, timeline.gridCount);
    else if (timeline.eventInteraction.pending && /^[0-9]$/.test(event.key) && !event.ctrlKey && !event.altKey) timeline.eventInteraction.place(undefined, undefined, Number(event.key) || 10);
    else if (action === 'Save') { event.preventDefault(); await save(); }
    else if (action === 'Undo') travel('undo');
    else if (action === 'Redo') travel('redo');
    else if (action === 'SelectAll') {
      if (session.focus === 'events') session.eventSelection = new Set(timeline.eventTypes.flatMap(type => eventList(session, type).map((event, index) => eventKey(type, index))));
      else if (session.multiLineActive && session.multiLineMode === 'notes') {
        session.multiLineSelection = new Map(session.targetLineIndices.map(lineIndex => [lineIndex, new Set((session.chart.judgeLineList?.[lineIndex]?.notes ?? []).map((note, index) => index))]));
        session.selection = new Set(session.multiLineSelection.get(session.lineIndex) ?? []);
      } else session.selection = new Set(session.notes.map((note, index) => index));
      session.notify();
    }
    else if (action === 'Copy') copySelection();
    else if (action === 'Shear') cutSelection();
    else if (action === 'ClipboardHistory') toggleClipboardPanel();
    // `applyNumberShortcut` declares its own `NumberShortcutSession` view, whose `transformSelection`
    // requires a `Note` where `EditorSession`'s accepts `Note | undefined` (the same variance the
    // timeline declares for its own view). The session is the live editor session either way; the
    // shortcut only ever reaches it with a note the selection holds.
    else if (!preview.visible && ['NumberMirror', 'NumberFill'].includes(action)) applyNumberShortcut(session as unknown as NumberShortcutSession, action);
    else if (['Paste', 'PasteMirror', 'KeepTimePaste', 'KeepTimePasteMirror'].includes(action)) pasteSelection(action.endsWith('Mirror'), action.startsWith('KeepTime'));
    else if (action === 'Pause') { event.preventDefault(); await togglePlayback(); }
    else if (['StartView', 'ReplayView', 'StartView_HOLD', 'JumpView_HOLD'].includes(action)) {
      // Only the two `_HOLD` names are stored, both of which are hotkey names; the explicit test names
      // them for the type, and is a no-op for the other two actions this branch accepts.
      if (action === 'StartView_HOLD' || action === 'JumpView_HOLD') heldPreview = { action, code: event.code };
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
    else if (preview.visible && ['AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action)) handled = false;
    else if (area === 'events' && ['AddTap', 'AddEvent'].includes(action)) handled = timeline.eventInteraction.place(undefined, undefined, undefined, action === 'AddTap');
    else if (['AddTap', 'AddDrag', 'AddFlick', 'AddHold'].includes(action)) {
      // The record is typed by its key set, so the lookup returns the note type for exactly those four
      // names the test above accepts. A miss falls back to the tap type, which nobody reaches.
      const addTypes: Record<'AddTap' | 'AddDrag' | 'AddFlick' | 'AddHold', NoteType> = { AddTap: 1, AddDrag: 4, AddFlick: 3, AddHold: 2 };
      const noteType: NoteType = addTypes[action as keyof typeof addTypes] ?? 1;
      handled = timeline.addAtCursor(noteType);
    }
    else if (action === 'Delete') deleteSelection();
    else if (action === 'QuickDelete' && session.selection.size + session.eventSelection.size + [...(session.multiLineSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0) + [...(session.multiEventSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0) > 1) deleteSelection();
    else if (action === 'QuickDelete' && session.focus === 'events' && timeline.eventCursor) {
      const hit = timeline.eventInteraction.hit(timeline.eventCursor);
      if (hit) { session.eventSelection = new Set([eventKey(hit.type, hit.index)]); deleteEvents(session); }
    } else if (action === 'QuickDelete' && timeline.cursor) {
      const hit = timeline.hit(timeline.cursor);
      if (hit) { if (session.multiLineActive && session.multiLineMode === 'notes') session.multiLineSelection.set(hit.lineIndex, new Set([hit.index])); session.selection = new Set([hit.index]); deleteSelection(); }
    } else if (['LastBeat', 'NextBeat'].includes(action)) seekBeat(Math.max(0, currentBeat() + (action === 'LastBeat' ? -1 : 1) / timeline.division));
    // `clipboardVisible` is created by the clipboard-history feature rather than declared on
    // `EditorSession`; the test suite views the session through the same intersection
    // (`EditorSession & ClipboardHistorySession`), so the field is written through that view here.
    else if (action === 'Esc') { (session as EditorClipboardSession).clipboardVisible = false; session.selection.clear(); session.eventSelection.clear(); session.multiLineSelection?.clear(); session.multiEventSelection?.clear(); timeline.cancelPlacement(); curveAnchorMode = null; curveStart = null; curveEnd = null; curveEditorOpen = false; togglePreview(false); activatePane('chart'); session.notify(); }
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  } catch (error) { event.preventDefault(); reportError(error); }
}, true);
window.addEventListener('keyup', event => {
  pasteGesture.up(event);
  if (timeline.clipboardMode?.mirror || timeline.clipboardMode?.keepTime) { timeline.clipboardMode = {}; invalidate(); }
  if (heldPreview && (event.code === heldPreview.code || shortcutReleased(event, preferences.hotkeys[heldPreview.action]))) {
    togglePreview(false, heldPreview.action === 'JumpView_HOLD'); heldPreview = null;
  }
}, true);
window.addEventListener('blur', () => { if (heldPreview) { togglePreview(false); heldPreview = null; } });

window.addEventListener('beforeunload', event => { if (session.history.dirty || assetDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('resize', invalidate);
element<HTMLDialogElement>('#modal').addEventListener('close', () => { if (atHome) home.refresh().catch(reportError); });
const markerResizeObserver = new ResizeObserver(() => { renderTimelineMarkers(); invalidate(); });
markerResizeObserver.observe(element('.stage'));
markerResizeObserver.observe(element('.scrubber-wrap'));
let lastPaint = 0;
let lastInfoTick = 0;
let lastFrameTime = 0;
let frameSampleStart = 0;
let frameSampleCount = 0;
let measuredFps = 0;
let lastTick = 0;
function frame(timestamp: number) {
  const elapsed = lastTick ? (timestamp - lastTick) / 1000 : 0; lastTick = timestamp;
  audio.update();
  batchControls.sync();
  lineSwitcher.draw(timestamp);
  if (!atHome) timeline.autoScroll(elapsed);
  frameSampleCount++;
  if (timestamp - frameSampleStart >= 500) { measuredFps = frameSampleCount * 1000 / (timestamp - frameSampleStart); frameSampleStart = timestamp; frameSampleCount = 0; }
  advanceEditClock(timestamp);
  if (hasDocument && !atHome && timestamp - lastInfoTick > 500) {
    const info = element<HTMLElement>('#chart-info dd');
    if (info && !element('#chart-info').hidden) info.textContent = info.textContent.replace(/Time: .*$/, `Time: ${formatEditTime(editTimeSeconds)}  FPS: ${measuredFps.toFixed(1)}`);
    lastInfoTick = timestamp;
  }
  // `autoSave` is a preference flag that reaches this narrow index-signature read as a union; the
  // `Boolean` coercion is the value the original passed to the same truthiness test.
  if (hasDocument && !atHome && !document.hidden) autoSave.tick(timestamp, Boolean(editorPreferences.autoSave ?? preferences.settings.autoSave),
    Number(editorPreferences.autoSaveSeconds ?? preferences.settings.autoSaveSeconds), session.history.dirty && session.chart !== lastDraftDocument);
  if (audio.playing && loop && currentBeat() >= loop.end) seekBeat(loop.start, false);
  if (audio.playing && audio.time >= audio.duration) { audio.pause(); invalidate(); }
  hitSounds.tick(session.chart, tempo, session.lineIndex);
  if (!atHome && (audio.playing || dirtyFrame || trajectoryPanel.active) && timestamp - lastFrameTime >= 1000 / preferences.settings.fpsLimit) {
    lastFrameTime = timestamp;
    const start = performance.now();
    const beat = currentBeat();
    session.editSeconds = Math.max(0, chartSeconds());
    updateLineInfo();
    if (audio.playing) timeline.origin = beat;
    if (!preview.visible) {
      timeline.draw(beat);
      multiEdit.drawTimeline();
      selectionOverlay.draw();
      drawTimelineStrips();
      updateLayerButtons();
      audioAnalysis.draw(offsetSeconds());
    }
    preview.duration = realtimePreview.duration = audio.duration;
    const viewSession = timeline.getSession();
    const trajectoryView = trajectoryPanel.tick(timestamp, chartSeconds(), audio.playing, realtimePreview);
    const viewChart = trajectoryView?.chart ?? (multiEdit.active && multiEdit.previewHovered && multiEdit.previewEnabled.checked && multiEdit.result ? multiEdit.result.chart : viewSession.chart);
    const viewSeconds = trajectoryView?.seconds ?? chartSeconds();
    preview.draw(viewChart, tempo, viewSeconds, viewSession.lineIndex);
    if (!preview.visible) {
      const visible = realtimePreview.visible;
      if (trajectoryView) realtimePreview.visible = true;
      realtimePreview.draw(viewChart, tempo, viewSeconds, viewSession.lineIndex);
      realtimePreview.visible = visible;
    }
    element('#play').textContent = audio.playing ? 'Ⅱ 暂停' : '▶ 播放';
    element('#play').dataset.playing = String(audio.playing);
    element('#play').title = audio.playing ? '暂停' : '播放';
    element('#clock').textContent = `${chartSeconds().toFixed(3)} s`;
    element<HTMLInputElement>('#scrubber').value = String(audio.time);
    const tempoPoint = tempo.points[Math.max(0, upperBound(tempo.points, beat, point => point.beat) - 1)];
    element('#bpm-display').textContent = `${(60 / tempoPoint.secondsPerBeat).toFixed(2)} BPM`;
    // `TimelineDrag` carries an index signature, so every member reads as `unknown`; the members this
    // readout needs are declared on the exported `MoveDrag` view, which `timeline.ts` itself uses for
    // the same purpose. The drag members are only meaningful while a note drag is in flight, which the
    // `Number.isInteger` / kind tests below establish.
    const drag: MoveDrag | null = timeline.drag;
    const draggedLineIndex = Number.isInteger(drag?.lineIndex) ? drag!.lineIndex! : session.lineIndex;
    // `movedNote` is declared to take a `Note`; a move drag is always anchored to one, which is what
    // the original's unconditional index expression assumed. `draggedNote` is tested before use below.
    const draggedNote = drag && ['move', 'startTime', 'endTime'].includes(drag.kind ?? '') ? timeline.movedNote(draggedAnchorNote(session.chart, draggedLineIndex, drag.anchor)!) : null;
    const positionInput = element<HTMLInputElement>('#properties input[aria-label="X 坐标"]');
    if (draggedNote && positionInput && document.activeElement !== positionInput) positionInput.value = Number(draggedNote.positionX).toFixed(2);
    element('#cursor-position').textContent = draggedNote ? `X ${draggedNote.positionX.toFixed(2)} · ${beatValue(draggedNote.startTime).toFixed(3)} 拍` : timeline.cursor ? `X ${timeline.positionAt(timeline.cursor.x).toFixed(2)} · ${timeline.snappedBeat(timeline.cursor.y).toFixed(3)} 拍` : '';
    if (timestamp - lastPaint > 400) {
      element('#performance').textContent = `绘制 ${(performance.now() - start).toFixed(1)} ms`;
      lastPaint = timestamp;
    }
    dirtyFrame = false;
  }
  requestAnimationFrame(frame);
}
applyPreferences(preferences);
setHome(true);
requestAnimationFrame(frame);

function applyPreferences(next: MigratedPreferences) {
  next = { ...next, hotkeys: { ...DEFAULT_HOTKEYS, ...next.hotkeys } };
  preferences = next;
  audio.setVolume(Number(editorPreferences.volume ?? next.settings.volume));
  element<HTMLInputElement>('#volume').value = String(audio.volume);
  hitSounds.setVolume(Number(editorPreferences.hitVolume ?? next.settings.hitVolume));
  element<HTMLInputElement>('#hit-volume').value = String(hitSounds.volume);
  preview.noteSize = realtimePreview.noteSize = next.settings.noteSize;
  // `lineScale` is a range-backed preference, so it is always a number here; `Number` is the same
  // narrowing the surrounding lines use and is the identity for the only value this can hold.
  preview.lineScale = realtimePreview.lineScale = Number(editorPreferences.lineScale ?? next.settings.lineScale);
  preview.backgroundAlpha = realtimePreview.backgroundAlpha = next.settings.backgroundAlpha;
  timeline.noteScale = next.settings.noteSize / 175;
  timeline.gridCount = Number(editorPreferences.gridCount ?? next.settings.gridCount);
  timeline.scale = Number(editorPreferences.scale ?? 500);
  timeline.division = Number(editorPreferences.division ?? 4);
  timeline.snapX = Boolean(editorPreferences.snapX ?? true);
  timeline.multiLineWidth = Number(editorPreferences.multiLineWidth ?? 0);
  timeline.multiLineEventWidth = Number(editorPreferences.multiLineEventWidth ?? 0);
  timeline.multiLineWidthExplicit = Number.isFinite(editorPreferences.multiLineWidth);
  timeline.multiLineEventWidthExplicit = Number.isFinite(editorPreferences.multiLineEventWidth);
  element<HTMLInputElement>('#grid-count').value = String(timeline.gridCount); element<HTMLInputElement>('#division').value = String(timeline.division); element<HTMLInputElement>('#y-scale').value = String(timeline.scale); element<HTMLInputElement>('#snap-x').checked = timeline.snapX;
  element<HTMLInputElement>('#y-scale-slider').value = String(timeline.scale);
  realtimePreview.visible = Boolean(editorPreferences.realtime ?? true);
  element<HTMLInputElement>('#realtime-enabled').checked = realtimePreview.visible; element<HTMLCanvasElement>('#realtime-preview').hidden = !realtimePreview.visible;
  element<HTMLInputElement>('#realtime-alpha').value = String(editorPreferences.realtimeAlpha ?? next.settings.realtimeAlpha);
  realtimePreview.opacity = Number(element<HTMLInputElement>('#realtime-alpha').value);
  audioAnalysis.enabled = Boolean(editorPreferences.analysisEnabled ?? false);
  audioAnalysis.mode = editorPreferences.analysisMode === 'spectrum' ? 'spectrum' : 'waveform';
  audioAnalysis.alpha = Number.isFinite(Number(editorPreferences.analysisAlpha)) ? Number(editorPreferences.analysisAlpha) : 0.2;
  audioAnalysis.width = Number.isFinite(Number(editorPreferences.analysisWidth)) ? Number(editorPreferences.analysisWidth) : 0.62;
  hitSounds.enabled = Boolean(editorPreferences.hitEnabled ?? true); element<HTMLInputElement>('#hit-enabled').checked = hitSounds.enabled;
  preview.allLines = realtimePreview.allLines = Boolean(editorPreferences.allLines ?? true); element<HTMLSelectElement>('#preview-mode').value = preview.allLines ? 'all' : 'current';
  timeline.scrollSpeed = next.settings.scrollSpeed / 5;
  session.history.limit = next.settings.historyLimit;
  element('#hotkey-help').hidden = !next.settings.showHotkey;
  element('#hotkey-help').textContent = `Tap ${next.hotkeys.AddTap} · Drag ${next.hotkeys.AddDrag} · Flick ${next.hotkeys.AddFlick} · Hold ${next.hotkeys.AddHold} 两次定位 · 事件 ${next.hotkeys.AddEvent} 两次定位 · 播放 ${next.hotkeys.Pause}。预览 ${next.hotkeys.StartView}，返回 ${next.hotkeys.EndView}，留在当前时间 ${next.hotkeys.JumpView}；按住预览 ${next.hotkeys.StartView_HOLD}/${next.hotkeys.JumpView_HOLD}。布局 ${next.hotkeys.SwitchUI}，重置视区 ${next.hotkeys.ResetCamera}，曲线端点 ${next.hotkeys.CurveBegin}/${next.hotkeys.CurveEnd}。滚轮向上前进并暂停；Shift 或右键两次框选，空白处拖动划线选择。`;
  applyDisplaySettings();
  renderSession();
}

function applyMigratedPreferences(next: MigratedPreferences) {
  editorPreferences = { ...editorPreferences, volume: next.settings.volume, hitVolume: next.settings.hitVolume, gridCount: next.settings.gridCount, realtimeAlpha: next.settings.realtimeAlpha,
    lineScale: next.settings.lineScale,
    ratioWidth: next.settings.ratioWidth, ratioHeight: next.settings.ratioHeight, barWidth: next.settings.barWidth, barAlpha: next.settings.barAlpha,
    autoSave: next.settings.autoSave, autoSaveSeconds: next.settings.autoSaveSeconds, autoSaveLimit: next.settings.autoSaveLimit, autoplayView: next.settings.autoplayView, highlight: next.settings.highlight, showGameUI: next.settings.showGameUI };
  applyPreferences(next); persistEditor();
}

listen('#migrate', async () => {
  const content = showDialog('选择原 RPE 主文件夹', '请选择包含 Resources、Hotkey.txt、Settings.json 的目录。读取后会先展示项目清单，再由你选择迁移内容。');
  // `showDirectoryPicker` is a File System Access API member that this project's DOM lib predates,
  // so it is declared as an optional field on the global view the feature-detection and the call
  // below both read. The browser check is the original's and behaves identically.
  const pickerWindow: Window & { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> } = window;
  if (pickerWindow.showDirectoryPicker) {
    const select = document.createElement('button'); select.type = 'button'; select.className = 'primary'; select.textContent = '只读选择文件夹';
    select.onclick = async () => {
      try {
        const directory = await pickerWindow.showDirectoryPicker!({ mode: 'read' });
        status('正在扫描旧 RPE 目录…');
        const entries = await directoryEntries(directory);
        migrationDialog(await scanMigration(entries, directory.name), applyMigratedPreferences);
      } catch (failure) { if (!(failure instanceof Error) || failure.name !== 'AbortError') reportError(failure); }
    };
    content.append(select);
  }
  const fallback = document.createElement('button'); fallback.type = 'button'; fallback.textContent = '兼容方式选择文件夹';
  fallback.onclick = () => element<HTMLInputElement>('#directory-input').click(); content.append(fallback);
});
element<HTMLInputElement>('#directory-input').addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  try {
    const files = input.files;
    if (!files?.length) return;
    status('正在扫描旧 RPE 目录…');
    const entries = uploadedEntries(files);
    const name = files[0].webkitRelativePath.split('/')[0];
    migrationDialog(await scanMigration(entries, name), applyMigratedPreferences);
  } catch (failure) { reportError(failure); }
  finally { input.value = ''; }
});
listen('#library', () => {
  if (atHome) return;
  playback.pause();
  if (!session.history.dirty && !assetDirty) { setHome(true); return; }
  choose('返回主界面前保存修改？', '保存会更新谱面库及资源；不保存会丢弃本次未保存修改。', ['保存并返回', '不保存并返回'], value => value, async value => {
    if (value === '保存并返回') {
      await save();
      if (session.history.dirty || assetDirty) throw new Error('仍有未保存修改，请等待保存结束后重试');
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
/**
 * Whether a value read back from storage is a usable migration record.
 *
 * `readPreferences` returns `Promise<unknown>` — the store holds whatever an earlier version wrote —
 * so the record is checked for the four fields the editor reads before being handed on. The original
 * read them off the value unguarded; a value failing this test is one whose `originalSettings` would
 * have thrown on `JSON.stringify` or whose `originalHotkeys` would have thrown on `Object.entries`,
 * so skipping it leaves the outcome for every real record unchanged.
 */
function isMigratedPreferences(value: unknown): value is MigratedPreferences {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { originalSettings?: unknown; originalHotkeys?: unknown; originalUI?: unknown };
  return candidate.originalSettings !== undefined && candidate.originalHotkeys !== null && typeof candidate.originalHotkeys === 'object' && typeof candidate.originalUI === 'string';
}
readPreferences().then(saved => {
  if (isMigratedPreferences(saved)) applyPreferences(migratePreferences(JSON.stringify(saved.originalSettings), Object.entries(saved.originalHotkeys).map(([key, value]) => `${key} ${value}`).join('\n'), saved.originalUI));
}).catch(failure => status(`无法读取偏好设置：${failureMessage(failure)}`));

function applyDisplaySettings() {
  // Seven of the `displayFields` keys are editor-only and absent from the migrated legacy settings, so
  // the settings-side fallback is read through a widened view; a missing key yields `undefined` and the
  // tuple's own default applies, which is the value the original's untyped lookup produced.
  // `MigratedSettings` is a closed interface, so the widened view is taken by intersection — the same
  // object, read by key, with no copy.
  const legacy: Record<string, unknown> = preferences.settings as MigratedSettings & Record<string, unknown>;
  for (const [id, key, fallback] of displayFields) {
    const control = element<HTMLInputElement>(`#${id}`);
    const value = editorPreferences[key] ?? legacy[key] ?? fallback;
    if (control.type === 'checkbox') control.checked = Boolean(value); else control.value = String(value);
  }
  const ratioWidth = Number(editorPreferences.ratioWidth ?? preferences.settings.ratioWidth);
  const ratioHeight = Number(editorPreferences.ratioHeight ?? preferences.settings.ratioHeight);
  setRatioOptions(element<HTMLInputElement>('#preview-ratio'), ratioWidth, ratioHeight);
  preview.aspectRatio = realtimePreview.aspectRatio = ratioWidth / ratioHeight;
  applyViewControls({ ...editorPreferences, showGameUI: editorPreferences.showGameUI ?? preferences.settings.showGameUI }, timeline, [preview, realtimePreview]);
  const displayKeys: ('lineNumbers' | 'lineArrows' | 'lineTint' | 'mergeLineNumbers' | 'pickPreviewLines')[] = ['lineNumbers', 'lineArrows', 'lineTint', 'mergeLineNumbers', 'pickPreviewLines'];
  for (const renderer of [preview, realtimePreview]) for (const key of displayKeys) renderer[key] = Boolean(editorPreferences[key] ?? true);
  const toolbarMode = editorPreferences.toolbarMode ?? 'icons';
  element('.editor-toolbar').classList.remove('mode-compact', 'mode-icons', 'mode-wide');
  element('.editor-toolbar').classList.add(`mode-${toolbarMode}`);
  element<HTMLButtonElement>('#toolbar-mode').title = `工具栏：${toolbarMode === 'icons' ? '图标' : toolbarMode === 'wide' ? '完整' : '紧凑'}（点击切换）`;
  timeline.barWidth = Number(element<HTMLInputElement>('#bar-width').value); timeline.barAlpha = Number(element<HTMLInputElement>('#bar-alpha').value); timeline.judgementOffset = Number(element<HTMLInputElement>('#judgement-offset').value);
  timeline.eventValueFontSize = Number(element<HTMLInputElement>('#event-value-size').value); timeline.eventValueThreshold = Number(element<HTMLInputElement>('#event-value-threshold').value); timeline.eventCurveThreshold = Number(element<HTMLInputElement>('#event-curve-threshold').value); timeline.eventOpacity = Number(element<HTMLInputElement>('#event-opacity').value); timeline.eventBarWidth = Number(element<HTMLInputElement>('#event-bar-width').value);
  timeline.seamlessEvents = element<HTMLInputElement>('#seamless-events').checked;
  session.cutDensity = Number(element<HTMLInputElement>('#event-cut-density').value);
  clipboardHistory.enabled = element<HTMLInputElement>('#clipboard-history-enabled').checked;
  lineSwitcher.enabled = element<HTMLInputElement>('#line-switcher-enabled').checked;
  if (!lineSwitcher.enabled) lineSwitcher.hide();
  if (!clipboardHistory.enabled) pasteGesture.cancel();
  element('#clipboard-history').hidden = !clipboardHistory.enabled;
  if (!clipboardHistory.enabled && activePaneName === 'clipboard') activatePane('chart');
  preview.backgroundBlur = realtimePreview.backgroundBlur = Number(element<HTMLInputElement>('#background-blur').value);
  preview.lineScale = realtimePreview.lineScale = Number(element<HTMLInputElement>('#default-line-thickness').value);
  timeline.highlight = preview.highlight = realtimePreview.highlight = element<HTMLInputElement>('#highlight-notes').checked;
  audio.setPreservePitch(element<HTMLInputElement>('#preserve-pitch').checked);
  rotateTip();
  invalidate();
}
for (const [id, key] of displayFields) {
  const control = element<HTMLInputElement>(`#${id}`);
  control.addEventListener(control.type === 'number' ? 'change' : 'input', (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.type === 'checkbox') editorPreferences[key] = target.checked;
    else if (target.value.trim() && target.validity.valid && Number.isFinite(Number(target.value))) editorPreferences[key] = Number(target.value);
    else return;
    applyDisplaySettings(); persistEditor();
  });
}
timeline.eventPlacementType = timeline.eventTypes[0];
