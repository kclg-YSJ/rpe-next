import { EditorSession } from '../application/session.mjs';
import { assertChart, createChart, diagnose, EVENT_TYPES, previewLimitations } from '../core/chart.mjs';
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
import { readProject, readPreferences, storePreferences, storeProject, readClipboardHistory, storeClipboardHistory } from '../platform/library.mjs';
import { migrationDialog } from './migration-dialog.mjs';
import { LinePanel } from './line-panel.mjs';
import { AssetLibraryPanel } from './asset-library.mjs';
import { HELP_TEXT } from './help.mjs';
import { download } from '../platform/files.mjs';
import { RpeSkin } from './skin.mjs';
import { ProjectImages } from '../platform/images.mjs';
import { HitSounds } from '../platform/hitsounds.mjs';
import { renderEventInspector } from './event-inspector.mjs';
import { eventKey, eventList, deleteEvents, transformEvents } from '../application/event-commands.mjs';
import { BATCH_ACTIONS, applyBatchAction, nudgeSelection } from '../application/batch-edit.mjs';
import { copyObjects, cutObjects, pasteObjects, deleteObjects } from '../application/clipboard.mjs';
import { ClipboardHistory } from '../application/clipboard-history.mjs';
import { renderClipboardHistory } from './clipboard-history.mjs';
import { PasteGesture } from './paste-gesture.mjs';
import { SelectionOverlay } from './selection-overlay.mjs';
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
import { isTextEntry, isTypingText, releaseShortcutFocus } from './keyboard.mjs';
import { setRatioOptions, applyViewControls } from './view-controls.mjs';
import { generateCurveNotes } from '../core/curve-notes.mjs';
import { createEasingPicker } from './easing-picker.mjs';
import { numericWheel } from './numeric-wheel.mjs';
import { SceneRuntime } from '../core/scene.mjs';
import { TimelineActivity } from '../core/timeline-activity.mjs';
import { assetUrl } from '../core/asset-url.mjs';
import { AudioAnalysis } from './audio-analysis.mjs';
import { TrajectoryPanel } from './trajectory-panel.mjs';
import { CollaborationPanel } from './collaboration.mjs';
import { NoiseDomainPanel } from './noise-domain-panel.mjs';

const element = selector => document.querySelector(selector);
const displayFields = [
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
let session = new EditorSession();
let assets = new Map();
let assetFolders = new Set();
let assetDirty = false;
let chartName = 'chart.json';
let recoveryId = crypto.randomUUID();
let tempo = new TempoMap(session.chart.BPMList);
let tempoEntries = session.chart.BPMList;
let dirtyFrame = true;
let lastDraftDocument;
let preferences = migratePreferences();
let libraryProject = null;
const manualSaves = new ManualSaveQueue(storeProject);
let editorPreferences = readEditorPreferences();
let atHome = true;
let hasDocument = false;
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
preview.invalidate = realtimePreview.invalidate = invalidate;
realtimePreview.applyShaders = false;
realtimePreview.showHitEffects = false;
const skin = new RpeSkin(invalidate);
const images = new ProjectImages(invalidate, message => status(message));
const timeline = new Timeline(element('#notes'), element('#events'), () => session, editEvent, invalidate, error => reportError(error), openTimelineContextMenu);
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
    toast.textContent = `该音符来自 ${entry.lineIndex} 号线 · 点击切换`;
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
const batchControls = new BatchControls(element('.stage'), timeline, () => session, () => !atHome && !preview.visible, error => reportError(error));
const multiEdit = new MultiEditPanel(element('#multi-editor'), () => session, timeline, {
  close: () => activatePane('chart'), invalidate, notify: (message, severity) => notify(message, severity),
});
const trajectoryPanel = new TrajectoryPanel(element('#trajectory-editor'), () => ({ session, timeline, tempo, previewVisible: preview.visible }), { invalidate, notify, activate: activatePane });
const multiLinePanel = new MultiLinePanel(element('#multi-line-editor'), () => session, { timeline, render: renderSession, notify, persist: persistEditor });
const linePanel = new LinePanel(element('#line-panel'), () => session, { render: renderSession, notify, getAssets: () => assets, afterTexture: () => images.load(session.chart, assets, chartName) });
const noiseDomainPanel = new NoiseDomainPanel(element('#noise-domain-editor'), () => ({ session, tempo, division: timeline.division, seconds: chartSeconds, preview, realtimePreview }), {
  close: () => activatePane('chart'), invalidate, reportError: error => reportError(error),
});
const assetLibrary = new AssetLibraryPanel(element('#asset-library'), () => ({ assets, folders: assetFolders, chart: session.chart, chartName }), {
  notify,
  onChange: (nextAssets, nextFolders) => {
    assets = nextAssets; assetFolders = new Set(nextFolders ?? []); images.load(session.chart, assets, chartName); assetDirty = true; status('素材库已修改，请保存谱面以保留资源'); renderSession();
  },
  onTexture: (oldName, newName = oldName) => {
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
}), { select: index => selectOverviewLine(index) });
function clipboardTargetLine() {
  return timeline.hoverArea === 'events'
    ? timeline.lineIndexAt(timeline.eventCursor?.x ?? 0, timeline.eventsCanvas.clientWidth, 'events')
    : timeline.lineIndexAt(timeline.cursor?.x ?? 0, timeline.notesCanvas.clientWidth, 'notes');
}
const pasteGesture = new PasteGesture({
  paste: context => { try { pasteObjects(session, context.beat, { ...timeline.clipboardMode, targetLineIndex: clipboardTargetLine() }); } catch (error) { reportError(error); } },
  open: () => { activatePane('clipboard'); renderClipboardPanel(); },
  reportError: error => notify(`剪贴板历史：${error.message}`, 'error'),
  valid: context => context.session === session && context.chart === session.chart && context.layer === timeline.layer && !atHome && !preview.visible && !dialogOpen() && !isTextEntry(document.activeElement),
});
window.addEventListener('blur', () => pasteGesture.cancel());
let stripCache;
function createStripCanvas(width, height) {
  const canvas = document.createElement('canvas'); const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  return { canvas, context, width, height };
}
function drawTimelineStrips() {
  const height = timeline.notesCanvas.clientHeight; const densityCanvas = element('#note-density'); const historyCanvas = element('#history-strip');
  const width = densityCanvas.clientWidth; if (!height || !width) return;
  timelineActivity.compile(session.chart, tempo);
  const duration = Math.max(0.001, audio.duration > 0 ? audio.duration : timelineActivity.duration);
  const historyEntries = session.recentEdits ?? [];
  const historySignature = `${historyEntries.length}:${historyEntries.at(-1)?.start ?? ''}:${historyEntries.at(-1)?.end ?? ''}:${historyEntries.at(-1)?.label ?? ''}`;
  const key = { chart: session.chart, line: session.lineIndex, layer: timeline.layer, extended: timeline.extended, duration, width, historyWidth: historyCanvas.clientWidth, height, historySignature };
  if (!stripCache || Object.keys(key).some(name => stripCache[name] !== key[name])) {
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
  noteFrame.context.drawImage(stripCache.note, 0, 0, width, height);
  historyFrame.context.drawImage(stripCache.history, 0, 0, historyCanvas.clientWidth, height);
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
    status('曲线起点已选择；请选择终点音符');
    invalidate();
    return true;
  }
  if (!curveStart) { curveAnchorMode = null; status('请先选择曲线起点'); return true; }
  curveEnd = anchor;
  curveAnchorMode = null;
  element('#curve-end')?.classList.remove('active');
  curveValues.endTime = anchor.startTime; curveValues.endX = anchor.positionX; updateCurvePanel();
  status('曲线终点已选择，可在右侧调整参数并生成');
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
  if (level === 'success' && editorPreferences.successNotifications === false) return;
  const host = element('#notifications'); if (!host) return;
  const item = document.createElement('div'); item.className = `editor-notification ${level}`; item.textContent = message; host.append(item);
  requestAnimationFrame(() => item.classList.add('visible'));
  const timer = setTimeout(() => { item.classList.add('leaving'); setTimeout(() => item.remove(), 260); notificationTimers.delete(timer); }, duration); notificationTimers.add(timer);
}
timeline.notify = (message, level = 'warning') => notify(message, level);
const reportError = error => { status(error.message); notify(error.message, 'error', 5000); showDialog('操作未完成', error.message); };
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
const currentBeat = () => tempo.beat(chartSeconds(), session.line?.bpmfactor ?? 1);
let collaborationJoining = false;
const collaborationTool = document.createElement('button'); collaborationTool.id = 'collaboration-tool'; collaborationTool.textContent = '联机协作'; element('[data-panel="chart"] .action-grid').append(collaborationTool);
const collaboration = new CollaborationPanel(element('#collaboration-panel'), () => ({
  session, timeline, interactionBusy: batchControls.active, seconds: chartSeconds(), offset: offsetSeconds(), duration: Number(element('#scrubber').max) || 600,
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
timeline.onDragScroll = seconds => playback.seek(audio.time + seconds);
const autoSave = new AutoSaveClock(async () => {
  const current = session; const snapshot = { ...current.chart }; delete snapshot.chartTime;
  await saveSnapshot(libraryProject?.id ?? recoveryId, chartName, snapshot, [...assets], editorPreferences.autoSaveLimit ?? preferences.settings.autoSaveLimit, { lineIndex: current.lineIndex });
  if (current === session) { lastDraftDocument = current.chart; status('自动备份已保存（包含音乐、曲绘与编辑位置）'); notify('自动备份已保存', 'success'); }
}, error => status(`自动保存失败：${error.message}，请手动保存或导出 PEZ`));
timeline.onWheel = event => {
  if (event.ctrlKey) {
    if (event.deltaY) {
      if (lineSwitcher.enabled) { lineSwitcher.step(event.deltaY); lineSwitcher.show(); }
      else switchLine(event.deltaY);
    }
  } else playback.wheel(event, { ...preferences.settings, scrollSpeed: editorPreferences.scrollSpeed ?? preferences.settings.scrollSpeed }, performance.now() / 1000);
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
  playback.wheel(event, { ...preferences.settings, scrollSpeed: editorPreferences.scrollSpeed ?? preferences.settings.scrollSpeed }, performance.now() / 1000);
};
element('.preview-wrap').addEventListener('wheel', previewWheel, { passive: false });
const pickPreviewLine = (renderer, event) => {
  const index = renderer.pick(event.clientX, event.clientY);
  if (index === null) return false;
  timeline.cancelPlacement(); session.selectLine(index); return true;
};
element('#preview').addEventListener('click', event => {
  if (!preview.visible) return;
  const noteLine = preview.pickNote(event.clientX, event.clientY);
  if (Number.isInteger(noteLine)) { timeline.cancelPlacement(); session.selectLine(noteLine); clearNoteSourceToast(); invalidate(); return; }
  pickPreviewLine(preview, event);
});
element('#preview').addEventListener('pointermove', event => {
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
    toast.textContent = `该音符来自 ${lineIndex} 号线 · 点击切换`;
    toast.hidden = false;
    toast.onclick = () => { session.selectLine(lineIndex); clearNoteSourceToast(); invalidate(); };
  }, 1000);
});
element('#preview').addEventListener('pointerleave', event => { if (!element('#note-source-toast')?.contains(event.relatedTarget)) clearNoteSourceToast(); });
timeline.previewPick = () => false;
const home = new ProjectHome(async id => {
  const project = await readProject(id);
  if (!project) throw new Error('此项目不存在');
  guardReplace(() => loadCandidate({ chart: project.chart, name: project.chartName, info: project.info, project }, new Map(project.assets)).catch(reportError));
}, reportError, project => {
  if (libraryProject?.id === project.id) {
    const renamed = libraryProject.chart.META.name !== project.chart.META.name;
    libraryProject = project;
    if (!session.history.dirty) {
      session.commit('更新项目信息', project.chart); session.history.markSaved(); renderSession();
    } else if (renamed) session.commit('更新项目名称', { ...session.chart, META: { ...session.chart.META, name: project.chart.META.name } });
  }
});

function setHome(visible) {
  if (visible && collaboration.client.active) collaboration.client.leave();
  atHome = visible;
  if (visible) clearNoteSourceToast();
  if (visible) { lineSwitcher.reset(); hitSounds.onlyCurrentLine = false; element('#mute-current-line')?.setAttribute('aria-pressed', 'false'); element('#mute-current-line')?.classList.remove('active'); }
  if (visible) { lineInfoVisible = false; element('#line-info-overlay')?.setAttribute('hidden', ''); }
  element('#document-name').textContent = visible ? '谱面库' : `${session.history.dirty ? '● ' : ''}${session.chart.META.name ?? chartName}`;
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
  const point = canvas ? timeline.point(event, canvas) : null;
  pendingTimelineMenu = { time: point ? timeline.timeAt(point.y) : null, markerIndex };
  element('#timeline-add-marker').hidden = !canvas;
  element('#timeline-delete-marker').hidden = markerIndex === null;
  const selections = session.multiLineActive && session.multiLineMode === 'events'
    ? [...session.multiEventSelection].flatMap(([lineIndex, keys]) => [...keys].map(key => ({ lineIndex, key })))
    : [...session.eventSelection].map(key => ({ lineIndex: session.lineIndex, key }));
  const selection = selections.length === 1 ? selections[0] : null;
  const [type, index] = selection?.key.split(':') ?? [];
  const selected = type === 'moveXEvents' ? session.chart.judgeLineList[selection.lineIndex]?.eventLayers?.[timeline.layer]?.moveXEvents?.[Number(index)] : null;
  const split = element('#trajectory-context-split'); split.hidden = !selected?.trajectory || canvas !== timeline.eventsCanvas;
  split.onclick = () => { closeTimelineContextMenu(); trajectoryPanel.open(selected, selection.lineIndex, timeline.layer); trajectoryPanel.split(); };
  menu.style.left = `${Math.max(4, Math.min(window.innerWidth - 190, event.clientX))}px`;
  menu.style.top = `${Math.max(4, Math.min(window.innerHeight - 90, event.clientY))}px`;
  menu.hidden = false;
}
function closeTimelineContextMenu() { const menu = element('#timeline-context-menu'); if (menu) menu.hidden = true; pendingTimelineMenu = null; }
function addTimelineMarker() {
  const pending = pendingTimelineMenu; closeTimelineContextMenu(); if (!pending || !Number.isFinite(pending.time)) return;
  const content = showDialog('添加时间标记', `将在 ${pending.time.toFixed(3)} 秒处添加标记。`);
  const input = document.createElement('input'); input.type = 'text'; input.placeholder = '例如：副歌开始'; input.setAttribute('aria-label', '标记名称'); content.append(input);
  const apply = element('#modal-apply'); apply.hidden = false; apply.onclick = () => {
    const name = String(input.value ?? '').trim(); if (!name) { element('#modal-error').textContent = '请输入标记名称'; return; }
    const markers = [...timelineMarkers(), { time: pending.time, name }].sort((left, right) => left.time - right.time);
    session.commit('添加时间标记', { ...session.chart, markers }); element('#modal').close();
  }; input.focus();
}
function deleteTimelineMarker() {
  const pending = pendingTimelineMenu; closeTimelineContextMenu(); if (!pending || pending.markerIndex === null) return;
  const markers = timelineMarkers().filter((unused, index) => index !== pending.markerIndex);
  session.commit('删除时间标记', { ...session.chart, markers });
}
window.addEventListener('pointerdown', event => { const menu = element('#timeline-context-menu'); if (menu && !menu.contains(event.target)) closeTimelineContextMenu(); }, true);
element('#timeline-add-marker').addEventListener('click', addTimelineMarker);
element('#timeline-delete-marker').addEventListener('click', deleteTimelineMarker);

function persistEditor() {
  editorPreferences = { ...editorPreferences, scale: timeline.scale, division: timeline.division, gridCount: timeline.gridCount, snapX: timeline.snapX, judgementOffset: timeline.judgementOffset, multiLineWidth: timeline.multiLineWidth || undefined, multiLineEventWidth: timeline.multiLineEventWidth || undefined,
    realtime: realtimePreview.visible, realtimeAlpha: Number(element('#realtime-alpha').value), volume: audio.volume, hitVolume: hitSounds.volume,
    hitEnabled: hitSounds.enabled, allLines: preview.allLines, toolbarMode: editorPreferences.toolbarMode ?? 'icons',
    analysisEnabled: audioAnalysis.enabled, analysisMode: audioAnalysis.mode, analysisAlpha: audioAnalysis.alpha, analysisWidth: audioAnalysis.width };
  try { writeEditorPreferences(editorPreferences); } catch (error) { status(`设置保存失败：${error.message}`); }
}

function activatePane(name) {
  if (name !== 'multi') multiEdit.hide();
  if (name !== 'trajectory') trajectoryPanel.hide();
  if (name !== 'noise') preview.noiseSelection = realtimePreview.noiseSelection = -1;
  activePaneName = name;
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== name;
  for (const button of document.querySelectorAll('[data-pane]')) button.classList.toggle('active', button.dataset.pane === name);
}
for (const button of document.querySelectorAll('[data-pane]')) button.onclick = () => {
  const pane = button.dataset.pane;
  if (['notes', 'events'].includes(pane)) session.focus = pane;
  activatePane(pane);
  if (pane === 'lines') linePanel.render();
};
function openMultiLinePanel() { activatePane('multi-line'); multiLinePanel.render(); }
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
function togglePreview(force, stay = false, replay = false) {
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
  element('#view-toggle').classList.toggle('active', preview.visible);
  element('#multi-line-labels').hidden = preview.visible;
  element('#multi-line-scroll').hidden = preview.visible;
  element('#preview-title').textContent = session.chart.META.name ?? '';
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
  const editor = element('.editor');
  editor.classList.toggle('multi-notes', session.multiLineActive && session.multiLineMode === 'notes');
  editor.classList.toggle('multi-events', session.multiLineActive && session.multiLineMode === 'events');
  const context = `${session.lineIndex}:${timeline.layer}`;
  if (placementContext !== context) { timeline.cancelPlacement(); placementContext = context; }
  if (tempoEntries !== session.chart.BPMList) { tempoEntries = session.chart.BPMList; tempo = new TempoMap(tempoEntries); }
  timeline.tempo = tempo;
  session.tempo = tempo; session.division = timeline.division;
  session.cutDensity = Number(element('#event-cut-density').value);
  updateLineInfo();
  session.eventWheelSteps = Object.fromEntries(['moveXEvents', 'moveYEvents', 'rotateEvents', 'alphaEvents', 'speedEvents', 'scaleXEvents', 'scaleYEvents'].flatMap((key, index) => Number.isFinite(preferences.originalSettings.scrollValueIncrement?.[index]) ? [[key, preferences.originalSettings.scrollValueIncrement[index]]] : []));
  timeline.origin = currentBeat();
  element('#document-name').textContent = atHome ? '谱面库' : `${session.history.dirty ? '● ' : ''}${session.chart.META.name ?? chartName}`;
  renderTimelineMarkers();
  element('#note-count').textContent = `${session.notes.length} notes`;
  const countEvents = line => [...(line.eventLayers ?? []), line.extended ?? {}].reduce((total, layer) => total + Object.entries(layer ?? {}).filter(([type, events]) => type !== 'paintEvents' && Array.isArray(events)).reduce((count, [, events]) => count + events.length, 0), 0) + shaderEvents(session.chart, session.chart.judgeLineList?.indexOf(line) ?? -1).length;
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
  const songName = session.chart.META?.song;
  const backgroundName = session.chart.META?.background;
  const missingMedia = [!songName || !assets.has(songName) ? '音乐' : '', !backgroundName || !assets.has(backgroundName) ? '封面' : ''].filter(Boolean);
  const materialHint = element('#chart-material-hint');
  if (materialHint) materialHint.textContent = missingMedia.length ? `缺少${missingMedia.join('、')} · 进入谱面信息添加` : '';
  const mediaStatus = element('#metadata-media-status');
  if (mediaStatus) mediaStatus.textContent = `音乐：${songName && assets.has(songName) ? songName : '未载入'}　封面：${backgroundName && assets.has(backgroundName) ? backgroundName : '未载入'}`;
  if (!session.liveBeatEdit) element('#offset').value = session.chart.META.offset ?? 0;
  element('#selection-info').textContent = session.focus === 'events' ? `${session.eventSelection.size} 个事件已选` : `${session.selection.size} 个音符已选`;
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
  element('#notes-only').disabled = session.multiLineActive;
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
  if (activePaneName === 'noise') noiseDomainPanel.render();
  session.eventLayer = timeline.layer;
  renderProperties(session, reportError);
  if (!session.liveEventEdit) renderEventInspector(session, tempo, currentBeat, reportError, notify);
  decorateBeatInputs();
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
      const [type, index] = selected?.key.split(':') ?? [];
      const event = session.chart.judgeLineList[selected?.lineIndex]?.eventLayers?.[timeline.layer]?.[type]?.[Number(index)];
      if (session.focus === 'events' && event?.trajectory) { curveEditorOpen = false; trajectoryPanel.open(event, selected.lineIndex, timeline.layer); }
      else activatePane(session.focus === 'events' ? 'events' : 'notes');
    }
    else if (!['multi-line', 'lines', 'assets', 'collaboration'].includes(activePaneName)) activatePane('chart');
  }
  const limits = previewLimitations(session.chart);
  element('#compatibility').textContent = '已使用原 RPE 音符素材与打击音；支持封面、静态纹理、多线与控制曲线。尚需原版逐帧对照。' + (limits.length ? `需进一步验证：${limits.join('、')}。` : '');
  invalidate();
}

session.addEventListener('change', renderSession);

function replaceChart(chart, name, nextAssets = new Map(), nextFolders = []) {
  assertChart(chart);
  if (!collaborationJoining && collaboration.client.active) collaboration.client.leave();
  lineSwitcher.reset();
  playback.pause(); audio.clear();
  audioAnalysis.setBuffer(null);
  hitSounds.stop(); hitSounds.onlyCurrentLine = false; element('#mute-current-line').setAttribute('aria-pressed', 'false'); element('#mute-current-line').classList.remove('active'); images.clear(); libraryProject = null;
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
  heldPreview = null; curveStart = null; curveEnd = null; curveAnchorMode = null; curveEditorOpen = false; loop = null; element('#loop-enabled').checked = false;
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
  preview.visible = false; element('.preview-wrap').hidden = true; element('#view-toggle').classList.remove('active');
  element('#preview-title').textContent = chart.META.name ?? '';
  element('#music-name').textContent = '无音乐 · 时钟预览';
  element('#scrubber').max = 600;
  renderSession();
  hasDocument = true; setHome(false);
  status(`已打开 ${name}`);
}

function guardReplace(action) {
  if (session.history.dirty || assetDirty) confirmAction('切换谱面？', action);
  else action();
}

async function loadCandidate(candidate, nextAssets) {
  attachExternalEffects([candidate], nextAssets);
  replaceChart(candidate.chart, candidate.name, nextAssets, candidate.project?.assetFolders ?? []);
  libraryProject = candidate.project ?? null;
  images.load(candidate.chart, assets, chartName, candidate.info);
  const references = resourceReferences(candidate.chart, assets, chartName, candidate.info);
  const bytes = assetBytes(assets, references.song, chartName);
  if (bytes) await loadMusic(bytes, references.song, false);
  else if (references.song) status(`谱面已打开，未找到音乐：${references.song}，请手动选择音乐`);
  if (session.chart === candidate.chart && candidate.project?.viewState) {
    const view = candidate.project.viewState;
    if (Number.isInteger(view.lineIndex) && session.chart.judgeLineList?.[view.lineIndex]) session.selectLine(view.lineIndex);
  }
}

async function loadMusic(bytes, name, updateMetadata = true) {
  const chartPosition = chartSeconds();
  playback.pause();
  const loadingSession = session;
  const loaded = await audio.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name);
  if (!loaded || session !== loadingSession) return;
  audioAnalysis.setBuffer(audio.buffer);
  assets.set(name, bytes);
  element('#music-name').textContent = name;
  element('#scrubber').max = audio.duration;
  renderTimelineMarkers();
  if (updateMetadata) session.commit('选择音乐', { ...session.chart, META: { ...session.chart.META, song: name } });
  playback.seek(chartPosition + offsetSeconds());
}

function seekBeat(value, pause = true) {
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
  return manualSaves.save(savingSession, () => {
    const document = session.chart; const snapshot = { ...document }; delete snapshot.chartTime;
    const project = { ...(libraryProject ?? { id: crypto.randomUUID(), source: 'Next 本地项目', imported: Date.now() }),
      chart: snapshot, chartName, assets: [...assets], assetFolders: [...assetFolders], bytes: [...assets.values()].reduce((sum, bytes) => sum + bytes.length, 0), updated: Date.now(), viewState: { lineIndex: session.lineIndex } };
    status('正在后台保存，可继续编辑…');
    return { document, project };
  }, ({ document, project }) => {
    savingSession.history.markSaved(document);
    if (session !== savingSession) return;
    libraryProject = project;
    assetDirty = assets.size !== project.assets.length || project.assets.some(([name, bytes]) => assets.get(name) !== bytes)
      || assetFolders.size !== project.assetFolders.length || project.assetFolders.some(folder => !assetFolders.has(folder));
    renderSession();
    const message = session.history.dirty || assetDirty ? '已保存开始保存时的版本；后续修改尚未保存' : '已保存到谱面库';
    status(message); notify(message, 'success');
  });
}

function validateCommit(label, next) { assertChart(next); session.commit(label, next); }

function editEvent(type, index, beat = currentBeat()) {
  if (!session.line) { status('请先添加判定线'); return; }
  timeline.eventPlacementType = type;
  timeline.extended = !EVENT_TYPES.includes(type);
  timeline.indexedLayer = null;
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
listen('#open', () => { element('#file-input').click(); });
element('#file-input').addEventListener('change', async event => {
  try {
    const loaded = await openFiles(event.target.files);
    if (!loaded) return;
    const proceed = () => {
      if (loaded.candidates.length === 1) loadCandidate(loaded.candidates[0], loaded.assets).catch(reportError);
      else choose('选择谱面', '包中有多份 RPE 谱面，其他文件会随 PEZ 导出保留。', loaded.candidates, candidate => `${candidate.name} · ${candidate.chart.META.name ?? ''}`, candidate => loadCandidate(candidate, loaded.assets));
    };
    guardReplace(proceed);
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
listen('#save', () => save());
listen('#export', () => showExportDialog(session.chart, assets, chartName, name => status(`已发起下载：${name}`)));
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
    session.commit('选择封面', { ...session.chart, META: { ...session.chart.META, background: file.name } });
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
  choose('恢复自动备份', drafts.length ? '新备份包含媒体；0.3 及更早的草稿仅包含谱面。恢复后请保存到谱面库。' : '此浏览器尚无自动备份。', drafts,
    draft => `${draft.title} · ${new Date(draft.updated).toLocaleString()}`,
    entry => { guardReplace(async () => {
      try {
        const draft = await readDraft(entry.id);
        if (!draft) throw new Error('此备份已被轮替，请重新打开备份列表');
        await loadCandidate({ chart: draft.chart, name: draft.name, project: { viewState: draft.viewState } }, new Map(draft.assets ?? []));
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
  session.commit('修改谱面延迟', { ...session.chart, META: { ...session.chart.META, offset: value } });
  playback.seek(chartPosition + value / 1000);
});
function nudgeBeatInput(input, direction) {
  try {
    const current = beatValue(parseBeat(input.value || '0'));
    const next = Math.max(0, current + direction / Math.max(1, timeline.division));
    input.value = formatBeat(fromNumber(next));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (error) { reportError(error); }
}
function decorateBeatInputs() {
  for (const input of document.querySelectorAll('#properties input[aria-label$="拍"], #event-properties input[aria-label$="拍"]')) {
    if (input.dataset.beatDecorated) continue;
    input.dataset.beatDecorated = 'true';
    const holder = input.parentElement;
    const wrapper = document.createElement('span'); wrapper.className = 'beat-input-wrap';
    const nudge = document.createElement('span'); nudge.className = 'beat-nudge';
    for (const [direction, symbol] of [[1, '▴'], [-1, '▾']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol; button.title = direction < 0 ? '减少一格' : '增加一格';
      button.dataset.beatNudge = String(direction); button.onclick = () => nudgeBeatInput(input, direction); nudge.append(button);
    }
    input.replaceWith(wrapper); wrapper.append(input, nudge);
    input.addEventListener('wheel', event => { event.preventDefault(); nudgeBeatInput(input, event.deltaY < 0 ? 1 : -1); }, { passive: false });
  }
}
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
    const button = document.createElement('button'); button.type = 'button'; button.textContent = index === MAX_BASE_LAYERS ? '特' : String(index);
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
    button.title = `${index === MAX_BASE_LAYERS ? '特殊层' : `第 ${index} 层`} · ${state === 'empty' ? '空层' : state === 'visible' ? '当前视野内有事件' : '事件在当前视野外'}`;
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
    if (start < 0 || end <= start) throw new Error('循环止拍必须大于起拍，起拍不能为负');
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
function captureCurve(end) {
  if (preview.visible) return;
  if (!curveEditorOpen) openCurvePanel();
  curveAnchorMode = end ? 'end' : 'start';
  if (end && !curveStart) { curveAnchorMode = null; throw new Error('请先按 Ctrl+F 选择曲线起点'); }
  element('#curve-start')?.classList.toggle('active', !end);
  element('#curve-end')?.classList.toggle('active', end);
  status(end ? '曲线终点选择中：点击一个音符' : '曲线起点选择中：点击一个音符');
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
  const option = new Option(name, name); option.title = description; element('#batch-action').append(option);
}
element('#batch-action').onchange = () => { element('#batch-run').title = BATCH_ACTIONS.find(([name]) => name === element('#batch-action').value)[1]; };
element('#batch-action').onchange();
listen('#batch-run', () => applyBatchAction(session, element('#batch-action').value, timeline.gridCount));
listen('#delete', deleteSelection);
listen('#mirror', () => {
  if (session.focus === 'events') transformEvents(session, '镜像 X / 旋转事件', (event, type) => ['moveXEvents', 'rotateEvents'].includes(type) ? { ...event, start: -event.start, end: -event.end } : event);
  else session.transformSelection('镜像音符', note => ({ ...note, positionX: -note.positionX }));
});
listen('#metadata', () => { activatePane('metadata'); renderMetadataPanel(session, element('#metadata-editor'), () => { activatePane('chart'); renderSession(); }); });
listen('#bpm', () => { activatePane('bpm'); renderBpmPanel(session, element('#bpm-editor'), () => { activatePane('chart'); renderSession(); }); });
listen('#noise-domains', () => { activatePane('noise'); noiseDomainPanel.render(); });
listen('#assets', () => { activatePane('assets'); assetLibrary.render(); });
listen('#audio-analysis-tool', () => {
  audioAnalysis.enabled = true; activatePane('audio-analysis'); audioAnalysis.render(element('#audio-analysis-panel')); audioAnalysis.draw(offsetSeconds()); persistEditor();
});
function renderHistoryPanel() {
  const host = element('#history-results'); if (!host) return;
  host.replaceChildren();
  const history = session.history; const current = history.undoStack.length;
  const entries = [{ label: '当前可回退的起点', index: 0 }, ...history.undoStack.map((command, index) => ({ label: command.label, index: index + 1 })), ...history.redoStack.toReversed().map((command, index) => ({ label: command.label, index: current + index + 1 }))];
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
clipboardHistory.addEventListener('change', event => {
  if (activePaneName === 'clipboard' && event.reason !== 'rename') renderClipboardPanel();
  invalidate();
  if (!event.persist) return;
  const entries = structuredClone(clipboardHistory.entries);
  clipboardSave = clipboardSave.then(() => storeClipboardHistory(entries)).catch(error => status(`剪贴板历史保存失败：${error.message}`));
});
readClipboardHistory().then(entries => clipboardHistory.restore(entries)).catch(error => status(`剪贴板历史读取失败：${error.message}`));
function deleteDiagnosticIssue(issue) {
  if (issue.path.startsWith('paintEvents[')) {
    session.commit('删除着色器检查项', replaceShaderEvents(session.chart, issue.line, shaderEvents(session.chart, issue.line).filter((event, index) => index !== issue.index)));
    notify('已删除检查项对应对象', 'success'); return;
  }
  const chart = structuredClone(session.chart);
  if (issue.path.startsWith('notes[') && chart.judgeLineList?.[issue.line]) chart.judgeLineList[issue.line].notes.splice(issue.index, 1);
  else if (issue.path === 'father' && chart.judgeLineList?.[issue.line]) chart.judgeLineList[issue.line].father = -1;
  else if (issue.path.startsWith('BPMList[')) chart.BPMList.splice(issue.index, 1);
  else if (issue.line != null && issue.path.match(/^\w+Events\[/)) {
    const type = issue.path.slice(0, issue.path.indexOf('[')); const line = chart.judgeLineList?.[issue.line];
    const layer = issue.extended ? line?.extended : line?.eventLayers?.[issue.layer];
    if (!layer?.[type]) return;
    layer[type].splice(issue.index, 1);
  }
  else return;
  session.commit('删除检查项', chart); notify('已删除检查项对应对象', 'success');
}
function renderDiagnostics() {
  const host = element('#diagnose-results'); if (!host) return;
  host.replaceChildren();
  const issues = diagnose(session.chart); const visible = element('#diagnose-show-low')?.checked !== false;
  const signature = issues.map(issue => `${issue.severity}:${issue.path}:${issue.message}`).sort().join('|');
  if (lastDiagnosticSignature !== null && signature !== lastDiagnosticSignature) {
    const previous = new Set(lastDiagnosticSignature.split('|').filter(Boolean));
    const added = issues.filter(issue => !previous.has(`${issue.severity}:${issue.path}:${issue.message}`));
    if (added.some(issue => issue.severity === 'error')) notify(`谱面检查发现 ${added.filter(issue => issue.severity === 'error').length} 个错误`, 'error', 4200);
    else if (added.some(issue => issue.severity === 'warning')) notify(`谱面检查新增 ${added.filter(issue => issue.severity === 'warning').length} 个警告`, 'warning', 3600);
  }
  lastDiagnosticSignature = signature;
  const category = issue => {
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
    root.append(curveField('curve-start-time', '起点拍', formatBeat(curveValues.startTime)), curveField('curve-end-time', '终点拍', formatBeat(curveValues.endTime)),
      curveField('curve-start-x', '起点 X', curveValues.startX, 'number'), curveField('curve-end-x', '终点 X', curveValues.endX, 'number'),
      curveField('curve-density', '密度', curveValues.density, 'number'), curveField('curve-type', '类型', curveValues.type, 'select', [['1', 'Tap'], ['3', 'Flick'], ['4', 'Drag']]), curveField('curve-easing', '缓动编号（1–29）', curveValues.easingType, 'number'));
    root.addEventListener('input', () => {
      try {
        curveValues = { startTime: parseBeat(element('#curve-start-time').value), endTime: parseBeat(element('#curve-end-time').value), startX: Number(element('#curve-start-x').value), endX: Number(element('#curve-end-x').value), density: Number(element('#curve-density').value), type: Number(element('#curve-type').value), easingType: Number(element('#curve-easing').value) };
        element('#curve-summary').textContent = `${generatedCurveCount()} 个中间音符 · 端点不重复添加`;
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
  element('#curve-summary').textContent = `${generatedCurveCount()} 个中间音符 · 端点不重复添加`;
  curveEasingPicker.select(curveValues.easingType);
  invalidate();
}
function openCurvePanel() {
  curveEditorOpen = true; curveStart = null; curveEnd = null; curveAnchorMode = null;
  element('#curve-start')?.classList.remove('active'); element('#curve-end')?.classList.remove('active');
  activatePane('curve'); updateCurvePanel(); status('曲线编辑：请选择起点音符');
}
function closeCurvePanel() {
  curveEditorOpen = false; curveStart = null; curveEnd = null; curveAnchorMode = null;
  element('#curve-start')?.classList.remove('active'); element('#curve-end')?.classList.remove('active');
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
  if (atHome || !hasDocument || !shortcutMatches(event, preferences.hotkeys.ShowLineInfo) || dialogOpen() || isTypingText(event.target)) return;
  event.preventDefault();
  if (event.repeat) return;
  lineInfoVisible = !lineInfoVisible;
  updateLineInfo();
}, true);
window.addEventListener('blur', () => { lineInfoVisible = false; element('#line-info-overlay')?.setAttribute('hidden', ''); });
window.addEventListener('keydown', event => {
  if (atHome || !hasDocument || dialogOpen() || isTextEntry(event.target) || !shortcutMatches(event, preferences.hotkeys.Pause)) return;
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
  const target = event.target;
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
  let handled = true;
  try {
    if (event.repeat && ['NumberMirror', 'NumberFill', 'Pause', 'AddHold', 'AddEvent', 'AddTap', 'StartView', 'EndView', 'JumpView', 'ReplayView', 'StartView_HOLD', 'JumpView_HOLD', 'ToggleMultiLine', 'SwitchMultiLineMode'].includes(action)) { event.preventDefault(); return; }
    if (!preview.visible && action?.startsWith('Page')) nudgeSelection(session, { PageLeft: 'ArrowLeft', PageRight: 'ArrowRight', PageUp: 'ArrowUp', PageDown: 'ArrowDown' }[action], timeline.division, timeline.gridCount);
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
    else if (preview.visible && ['AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action)) handled = false;
    else if (area === 'events' && ['AddTap', 'AddEvent'].includes(action)) handled = timeline.eventInteraction.place(undefined, undefined, undefined, action === 'AddTap');
    else if (['AddTap', 'AddDrag', 'AddFlick', 'AddHold'].includes(action)) handled = timeline.addAtCursor({ AddTap: 1, AddDrag: 4, AddFlick: 3, AddHold: 2 }[action]);
    else if (action === 'Delete') deleteSelection();
    else if (action === 'QuickDelete' && session.selection.size + session.eventSelection.size + [...(session.multiLineSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0) + [...(session.multiEventSelection?.values() ?? [])].reduce((sum, values) => sum + values.size, 0) > 1) deleteSelection();
    else if (action === 'QuickDelete' && session.focus === 'events' && timeline.eventCursor) {
      const hit = timeline.eventInteraction.hit(timeline.eventCursor);
      if (hit) { session.eventSelection = new Set([eventKey(hit.type, hit.index)]); deleteEvents(session); }
    } else if (action === 'QuickDelete' && timeline.cursor) {
      const hit = timeline.hit(timeline.cursor);
      if (hit) { if (session.multiLineActive && session.multiLineMode === 'notes') session.multiLineSelection.set(hit.lineIndex, new Set([hit.index])); session.selection = new Set([hit.index]); deleteSelection(); }
    } else if (['LastBeat', 'NextBeat'].includes(action)) seekBeat(Math.max(0, currentBeat() + (action === 'LastBeat' ? -1 : 1) / timeline.division));
    else if (action === 'Esc') { session.clipboardVisible = false; session.selection.clear(); session.eventSelection.clear(); session.multiLineSelection?.clear(); session.multiEventSelection?.clear(); timeline.cancelPlacement(); curveAnchorMode = null; curveStart = null; curveEnd = null; curveEditorOpen = false; togglePreview(false); activatePane('chart'); session.notify(); }
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
element('#modal').addEventListener('close', () => { if (atHome) home.refresh().catch(reportError); });
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
function frame(timestamp) {
  const elapsed = lastTick ? (timestamp - lastTick) / 1000 : 0; lastTick = timestamp;
  audio.update();
  batchControls.sync();
  lineSwitcher.draw(timestamp);
  if (!atHome) timeline.autoScroll(elapsed);
  frameSampleCount++;
  if (timestamp - frameSampleStart >= 500) { measuredFps = frameSampleCount * 1000 / (timestamp - frameSampleStart); frameSampleStart = timestamp; frameSampleCount = 0; }
  advanceEditClock(timestamp);
  if (hasDocument && !atHome && timestamp - lastInfoTick > 500) {
    const info = element('#chart-info dd');
    if (info && !element('#chart-info').hidden) info.textContent = info.textContent.replace(/Time: .*$/, `Time: ${formatEditTime(editTimeSeconds)}  FPS: ${measuredFps.toFixed(1)}`);
    lastInfoTick = timestamp;
  }
  if (hasDocument && !atHome && !document.hidden) autoSave.tick(timestamp, editorPreferences.autoSave ?? preferences.settings.autoSave,
    editorPreferences.autoSaveSeconds ?? preferences.settings.autoSaveSeconds, session.history.dirty && session.chart !== lastDraftDocument);
  if (audio.playing && loop && currentBeat() >= loop.end) seekBeat(loop.start, false);
  if (audio.playing && audio.time >= audio.duration) { audio.pause(); invalidate(); }
  hitSounds.tick(session.chart, tempo, session.lineIndex);
  if (!atHome && (audio.playing || dirtyFrame || trajectoryPanel.active) && timestamp - lastFrameTime >= 1000 / preferences.settings.fpsLimit) {
    lastFrameTime = timestamp;
    const start = performance.now();
    const beat = currentBeat();
    session.editSeconds = Math.max(0, chartSeconds());
    updateLineInfo();
    if (activePaneName === 'noise') noiseDomainPanel.tick();
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
    element('#scrubber').value = audio.time;
    const tempoPoint = tempo.points[Math.max(0, upperBound(tempo.points, beat, point => point.beat) - 1)];
    element('#bpm-display').textContent = `${(60 / tempoPoint.secondsPerBeat).toFixed(2)} BPM`;
    const draggedLineIndex = Number.isInteger(timeline.drag?.lineIndex) ? timeline.drag.lineIndex : session.lineIndex;
    const draggedSource = session.chart.judgeLineList?.[draggedLineIndex]?.notes?.[timeline.drag?.anchor];
    const draggedNote = ['move', 'startTime', 'endTime'].includes(timeline.drag?.kind) ? timeline.movedNote(draggedSource) : null;
    const positionInput = element('#properties input[aria-label="X 坐标"]');
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

function applyPreferences(next) {
  next = { ...next, hotkeys: { ...DEFAULT_HOTKEYS, ...next.hotkeys } };
  preferences = next;
  audio.setVolume(editorPreferences.volume ?? next.settings.volume);
  element('#volume').value = audio.volume;
  hitSounds.setVolume(editorPreferences.hitVolume ?? next.settings.hitVolume);
  element('#hit-volume').value = hitSounds.volume;
  preview.noteSize = realtimePreview.noteSize = next.settings.noteSize;
  preview.lineScale = realtimePreview.lineScale = editorPreferences.lineScale ?? next.settings.lineScale;
  preview.backgroundAlpha = realtimePreview.backgroundAlpha = next.settings.backgroundAlpha;
  timeline.noteScale = next.settings.noteSize / 175;
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
  element('#hotkey-help').textContent = `Tap ${next.hotkeys.AddTap} · Drag ${next.hotkeys.AddDrag} · Flick ${next.hotkeys.AddFlick} · Hold ${next.hotkeys.AddHold} 两次定位 · 事件 ${next.hotkeys.AddEvent} 两次定位 · 播放 ${next.hotkeys.Pause}。预览 ${next.hotkeys.StartView}，返回 ${next.hotkeys.EndView}，留在当前时间 ${next.hotkeys.JumpView}；按住预览 ${next.hotkeys.StartView_HOLD}/${next.hotkeys.JumpView_HOLD}。布局 ${next.hotkeys.SwitchUI}，重置视区 ${next.hotkeys.ResetCamera}，曲线端点 ${next.hotkeys.CurveBegin}/${next.hotkeys.CurveEnd}。滚轮向上前进并暂停；Shift 或右键两次框选，空白处拖动划线选择。`;
  applyDisplaySettings();
  renderSession();
}

function applyMigratedPreferences(next) {
  editorPreferences = { ...editorPreferences, volume: next.settings.volume, hitVolume: next.settings.hitVolume, gridCount: next.settings.gridCount, realtimeAlpha: next.settings.realtimeAlpha,
    lineScale: next.settings.lineScale,
    ratioWidth: next.settings.ratioWidth, ratioHeight: next.settings.ratioHeight, barWidth: next.settings.barWidth, barAlpha: next.settings.barAlpha,
    autoSave: next.settings.autoSave, autoSaveSeconds: next.settings.autoSaveSeconds, autoSaveLimit: next.settings.autoSaveLimit, autoplayView: next.settings.autoplayView, highlight: next.settings.highlight, showGameUI: next.settings.showGameUI };
  applyPreferences(next); persistEditor();
}

listen('#migrate', async () => {
  const content = showDialog('选择原 RPE 主文件夹', '请选择包含 Resources、Hotkey.txt、Settings.json 的目录。读取后会先展示项目清单，再由你选择迁移内容。');
  if (window.showDirectoryPicker) {
    const select = document.createElement('button'); select.type = 'button'; select.className = 'primary'; select.textContent = '只读选择文件夹';
    select.onclick = async () => {
      try {
        const directory = await window.showDirectoryPicker({ mode: 'read' });
        status('正在扫描旧 RPE 目录…');
        const entries = await directoryEntries(directory);
        migrationDialog(await scanMigration(entries, directory.name), applyMigratedPreferences);
      } catch (error) { if (error.name !== 'AbortError') reportError(error); }
    };
    content.append(select);
  }
  const fallback = document.createElement('button'); fallback.type = 'button'; fallback.textContent = '兼容方式选择文件夹';
  fallback.onclick = () => element('#directory-input').click(); content.append(fallback);
});
element('#directory-input').addEventListener('change', async event => {
  try {
    if (!event.target.files.length) return;
    status('正在扫描旧 RPE 目录…');
    const entries = uploadedEntries(event.target.files);
    const name = event.target.files[0].webkitRelativePath.split('/')[0];
    migrationDialog(await scanMigration(entries, name), applyMigratedPreferences);
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
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
readPreferences().then(saved => {
  if (saved) applyPreferences(migratePreferences(JSON.stringify(saved.originalSettings), Object.entries(saved.originalHotkeys).map(([key, value]) => `${key} ${value}`).join('\n'), saved.originalUI));
}).catch(error => status(`无法读取偏好设置：${error.message}`));

function applyDisplaySettings() {
  for (const [id, key, fallback] of displayFields) {
    const control = element(`#${id}`); const value = editorPreferences[key] ?? preferences.settings[key] ?? fallback;
    if (control.type === 'checkbox') control.checked = value; else control.value = value;
  }
  const ratioWidth = editorPreferences.ratioWidth ?? preferences.settings.ratioWidth;
  const ratioHeight = editorPreferences.ratioHeight ?? preferences.settings.ratioHeight;
  setRatioOptions(element('#preview-ratio'), ratioWidth, ratioHeight);
  preview.aspectRatio = realtimePreview.aspectRatio = ratioWidth / ratioHeight;
  applyViewControls({ ...editorPreferences, showGameUI: editorPreferences.showGameUI ?? preferences.settings.showGameUI }, timeline, [preview, realtimePreview]);
  for (const renderer of [preview, realtimePreview]) for (const key of ['lineNumbers', 'lineArrows', 'lineTint', 'mergeLineNumbers', 'pickPreviewLines']) renderer[key] = editorPreferences[key] ?? true;
  const toolbarMode = editorPreferences.toolbarMode ?? 'icons';
  element('.editor-toolbar').classList.remove('mode-compact', 'mode-icons', 'mode-wide');
  element('.editor-toolbar').classList.add(`mode-${toolbarMode}`);
  element('#toolbar-mode').title = `工具栏：${toolbarMode === 'icons' ? '图标' : toolbarMode === 'wide' ? '完整' : '紧凑'}（点击切换）`;
  timeline.barWidth = Number(element('#bar-width').value); timeline.barAlpha = Number(element('#bar-alpha').value); timeline.judgementOffset = Number(element('#judgement-offset').value);
  timeline.eventValueFontSize = Number(element('#event-value-size').value); timeline.eventValueThreshold = Number(element('#event-value-threshold').value); timeline.eventCurveThreshold = Number(element('#event-curve-threshold').value); timeline.eventOpacity = Number(element('#event-opacity').value); timeline.eventBarWidth = Number(element('#event-bar-width').value);
  timeline.seamlessEvents = element('#seamless-events').checked;
  session.cutDensity = Number(element('#event-cut-density').value);
  clipboardHistory.enabled = element('#clipboard-history-enabled').checked;
  lineSwitcher.enabled = element('#line-switcher-enabled').checked;
  if (!lineSwitcher.enabled) lineSwitcher.hide();
  if (!clipboardHistory.enabled) pasteGesture.cancel();
  element('#clipboard-history').hidden = !clipboardHistory.enabled;
  if (!clipboardHistory.enabled && activePaneName === 'clipboard') activatePane('chart');
  preview.backgroundBlur = realtimePreview.backgroundBlur = Number(element('#background-blur').value);
  preview.lineScale = realtimePreview.lineScale = Number(element('#default-line-thickness').value);
  timeline.highlight = preview.highlight = realtimePreview.highlight = element('#highlight-notes').checked;
  audio.setPreservePitch(element('#preserve-pitch').checked);
  rotateTip();
  invalidate();
}
for (const [id, key] of displayFields) element(`#${id}`).addEventListener(element(`#${id}`).type === 'number' ? 'change' : 'input', event => {
  const control = event.target;
  if (control.type === 'checkbox') editorPreferences[key] = control.checked;
  else if (control.value.trim() && control.validity.valid && Number.isFinite(Number(control.value))) editorPreferences[key] = Number(control.value);
  else return;
  applyDisplaySettings(); persistEditor();
});
timeline.eventPlacementType = timeline.eventTypes[0];
