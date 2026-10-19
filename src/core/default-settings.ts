// Shared defaults for new browser and desktop profiles. Saved preferences take precedence.
import type { EditorPreferences } from '../platform/editor-preferences.ts';
import type { MigratedSettings } from './preferences.ts';

export const DEFAULT_SETTINGS = Object.freeze({
  cutDensity: 4,
  volume: 0.51,
  hitVolume: 0.2573,
  noteSize: 200,
  lineScale: 1.5,
  gridCount: 21,
  scrollSpeed: 5,
  wheelStopAtAudioStart: true,
  drawEventCurves: true,
  backgroundAlpha: 0.23529411764705882,
  realtimeAlpha: 0.05,
  scrollAcceleration: true,
  historyLimit: 30,
  autoSave: true,
  autoSaveSeconds: 240,
  autoSaveLimit: 10,
  ratioWidth: 3,
  ratioHeight: 2,
  barWidth: 3,
  barAlpha: 0.6,
  highlight: true,
  autoplayView: true,
  fpsLimit: 120,
  showHotkey: false,
  showGameUI: true,
} as const) satisfies MigratedSettings;

export const DEFAULT_EDITOR_PREFERENCES = Object.freeze({
  includeBackupCharts: false,
  pairedMovementSampling: true,
  scale: 600,
  division: 4,
  snapX: true,
  judgementOffset: 92,
  realtime: true,
  hitEnabled: true,
  allLines: true,
  toolbarMode: 'icons',
  analysisEnabled: false,
  analysisMode: 'waveform',
  analysisAlpha: 0.2,
  analysisWidth: 0.62,
  notesOnly: false,
  eventOpacity: 0.45,
  eventBarWidth: 0.67,
  dragSensitivity: 1,
  tipsEnabled: false,
} as const) satisfies EditorPreferences;

export interface DefaultAppearance {
  editorSkin: string;
  editorSkinOptions: Record<string, { variant: string; parameters: Record<string, unknown> }>;
  noteSkin: string;
}

export const DEFAULT_APPEARANCE: DefaultAppearance = Object.freeze({
  editorSkin: 'inkline',
  editorSkinOptions: {
    inkline: {
      variant: 'base',
      parameters: {},
    },
    default: {
      variant: 'base',
      parameters: {},
    },
  },
  noteSkin: 'default',
});
