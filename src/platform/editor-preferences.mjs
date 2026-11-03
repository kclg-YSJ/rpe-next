import { localPreferences } from './local-preferences.mjs';
import { validFpsLimit } from '../core/frame-timing.mjs';
import { validSelectionInterval } from '../core/selection-interval.mjs';
import { normalizeLineDefaults } from '../core/placement-defaults.mjs';
import { EVENT_TYPES } from '../core/chart.mjs';

const multiLineEventTypes = [...EVENT_TYPES, 'scaleXEvents', 'scaleYEvents', 'colorEvents', 'paintEvents', 'textEvents'];

const ranges = { scale: [20, 2000], division: [1, 100], gridCount: [2, 100], noteSize: [10, 500], volume: [0, 1], hitVolume: [0, 1], realtimeAlpha: [0, 1], ratioWidth: [1, 100], ratioHeight: [1, 100], barWidth: [0.5, 10], barAlpha: [0.1, 2], judgementOffset: [42, 240], eventValueSize: [8, 28], eventValueThreshold: [10, 180], eventCurveThreshold: [8, 180], eventOpacity: [0.05, 1], eventBarWidth: [0.35, 1], multiLineWidth: [30, 2400], multiLineEventWidth: [30, 2400], scrollSpeed: [0.1, 100], autoSaveSeconds: [1, 3600], autoSaveLimit: [1, 100], dragSensitivity: [0.1, 8] };
Object.assign(ranges, { cameraX: [-1000000, 1000000], viewDivisor: [0.1, 100], backgroundBlur: [0, 30], overflowBlur: [0, 80], overflowDarken: [0, 1], cutDensity: [0.1, 128] });
Object.assign(ranges, { analysisAlpha: [0.02, 1], analysisWidth: [0.2, 1], lineScale: [0.1, 10] });
Object.assign(ranges, { judgementWidth: [0.5, 12], judgementAlpha: [0, 1] });
Object.assign(ranges, { placementOpacity: [0, 1] });
Object.assign(ranges, { noteSpacing: [0.05, 10], notesOnlyNoteScale: [0.1, 3] });
const flags = ['snapX', 'realtime', 'hitEnabled', 'allLines', 'preservePitch', 'autoSave', 'autoplayView', 'highlight', 'drawEventCurves', 'seamlessEvents', 'seamlessNoiseAreas', 'notesOnly', 'showGameUI', 'viewportOverflow', 'lineNumbers', 'lineArrows', 'lineTint', 'mergeLineNumbers', 'pickPreviewLines', 'pickPreviewNoiseAreas', 'tipsEnabled', 'successNotifications', 'clipboardHistory', 'lineSwitcher', 'analysisEnabled', 'noteSourceHover', 'sampleAutoFit', 'pairedMovementSampling', 'wheelStopAtAudioStart', 'rpeEventDrag', 'xyBinding'];
export function normalizeEditorPreferences(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  if (value.multiLineEventVisibility && typeof value.multiLineEventVisibility === 'object') result.multiLineEventVisibility = Object.fromEntries(multiLineEventTypes.filter(type => typeof value.multiLineEventVisibility[type] === 'boolean').map(type => [type, value.multiLineEventVisibility[type]]));
  if (value.lineEventDefaults && typeof value.lineEventDefaults === 'object' && !Array.isArray(value.lineEventDefaults)) result.lineEventDefaults = normalizeLineDefaults(value.lineEventDefaults);
  if (validFpsLimit(value.fpsLimit)) result.fpsLimit = value.fpsLimit;
  if (validSelectionInterval(value.selectionInterval)) result.selectionInterval = value.selectionInterval;
  if (typeof value.textSelectionDrag === 'boolean') result.textSelectionDrag = value.textSelectionDrag;
  if (typeof value.judgementColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.judgementColor)) result.judgementColor = value.judgementColor.toLowerCase();
  for (const key of ['hitTapDelay', 'hitDragDelay', 'hitFlickDelay']) if (Number.isFinite(value[key])) result[key] = value[key];
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) if (Number.isFinite(value[key])) result[key] = Math.max(minimum, Math.min(maximum, value[key]));
  if (result.division) result.division = Math.round(result.division);
  for (const key of [...flags, 'forceSimpleNoise', 'includeBackupCharts', 'overlappingLinePicker', 'directPlacement']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (['compact', 'icons', 'wide'].includes(value.toolbarMode)) result.toolbarMode = value.toolbarMode;
  if (value.analysisMode === 'waveform' || value.analysisMode === 'spectrum') result.analysisMode = value.analysisMode;
  if (value.wheelInputMode === 'mouse' || value.wheelInputMode === 'trackpad') result.wheelInputMode = value.wheelInputMode;
  return result;
}
export function readEditorPreferences(storage = localPreferences) {
  try { return normalizeEditorPreferences(JSON.parse(storage.getItem('rpe-next-editor-v1') ?? '{}')); } catch { return {}; }
}
export function writeEditorPreferences(value, storage = localPreferences) { storage.setItem('rpe-next-editor-v1', JSON.stringify(normalizeEditorPreferences(value))); }
