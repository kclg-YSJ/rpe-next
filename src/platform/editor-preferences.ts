// Every persisted editor preference is a number or a boolean under a fixed key, so the schema is
// expressed as data: one table of clamped numeric ranges and one list of boolean flags. Adding a
// preference means adding a row here, and unknown keys in stored data are dropped rather than
// copied through, which keeps a preference file written by an older or newer build harmless.
const ranges: Record<string, [minimum: number, maximum: number]> = { scale: [20, 2000], division: [1, 100], gridCount: [2, 100], volume: [0, 1], hitVolume: [0, 1], realtimeAlpha: [0, 1], ratioWidth: [1, 100], ratioHeight: [1, 100], barWidth: [0.5, 10], barAlpha: [0.1, 2], judgementOffset: [42, 240], eventValueSize: [8, 28], eventValueThreshold: [10, 180], eventCurveThreshold: [8, 180], eventOpacity: [0.05, 1], eventBarWidth: [0.35, 1], multiLineWidth: [30, 2400], multiLineEventWidth: [30, 2400], scrollSpeed: [0.1, 100], autoSaveSeconds: [1, 3600], autoSaveLimit: [1, 100] };
Object.assign(ranges, { cameraX: [-1000000, 1000000], viewDivisor: [0.1, 100], backgroundBlur: [0, 30], cutDensity: [0.1, 128] });
Object.assign(ranges, { analysisAlpha: [0.02, 1], analysisWidth: [0.2, 1], lineScale: [0.1, 10] });
const flags = ['snapX', 'realtime', 'hitEnabled', 'allLines', 'preservePitch', 'autoSave', 'autoplayView', 'highlight', 'seamlessEvents', 'notesOnly', 'showGameUI', 'lineNumbers', 'lineArrows', 'lineTint', 'mergeLineNumbers', 'pickPreviewLines', 'tipsEnabled', 'successNotifications', 'clipboardHistory', 'lineSwitcher', 'analysisEnabled', 'noteSourceHover'] as const;
const toolbarModes = ['compact', 'icons', 'wide'] as const;
/** The waveform/spectrum choice is a string, so it is validated against its own list. */
const analysisModes = ['waveform', 'spectrum'] as const;

export type ToolbarMode = typeof toolbarModes[number];
export type AnalysisMode = typeof analysisModes[number];

/**
 * A normalized preference set.
 *
 * Keys are only present when stored data actually carried a usable value, so consumers fall back
 * to their own defaults; hence the optional members rather than a fully-populated shape.
 */
export interface EditorPreferences {
  toolbarMode?: ToolbarMode;
  /**
   * The waveform/spectrum choice, the one preference that is a string union rather than a number or a
   * boolean. It is validated against `analysisModes` on read, exactly like `toolbarMode`.
   */
  analysisMode?: AnalysisMode;
  [key: string]: number | boolean | ToolbarMode | AnalysisMode | undefined;
}

/** The storage surface this module needs, so tests can pass a stub. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Coerces stored preferences into the known schema: numbers are clamped to their range and
 * rounded where the editor treats them as integers, booleans pass through, and anything else —
 * including unknown keys — is discarded.
 */
export function normalizeEditorPreferences(value: unknown): EditorPreferences {
  const result: EditorPreferences = {};
  if (!value || typeof value !== 'object') return result;
  const source = value as Record<string, unknown>;
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const entry = source[key];
    if (Number.isFinite(entry)) result[key] = Math.max(minimum, Math.min(maximum, entry as number));
  }
  if (result.division) result.division = Math.round(result.division as number);
  for (const key of flags) if (typeof source[key] === 'boolean') result[key] = source[key];
  if (toolbarModes.includes(source.toolbarMode as ToolbarMode)) result.toolbarMode = source.toolbarMode as ToolbarMode;
  if (analysisModes.includes(source.analysisMode as AnalysisMode)) result.analysisMode = source.analysisMode as AnalysisMode;
  return result;
}

/** Reads preferences from storage, falling back to an empty set if the stored JSON is unusable. */
export function readEditorPreferences(storage: PreferenceStorage = localStorage): EditorPreferences {
  try { return normalizeEditorPreferences(JSON.parse(storage.getItem('rpe-next-editor-v1') ?? '{}')); } catch { return {}; }
}

export function writeEditorPreferences(value: unknown, storage: PreferenceStorage = localStorage): void {
  storage.setItem('rpe-next-editor-v1', JSON.stringify(normalizeEditorPreferences(value)));
}
