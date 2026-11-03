import { t } from '../i18n.mjs';
// Adapted from Autoplay Studio 1.1.7 by NyamonZone; integrated RPEN renderer.
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

export const STORAGE_KEY = 'studio';

export const RESOLUTIONS = [
  ['720p', 1280, 720],
  ['1080p', 1920, 1080],
  ['1440p', 2560, 1440],
  ['4K', 3840, 2160],
];

export const FORMATS = {
  mp4: { label: 'MP4', ext: 'mp4', mime: 'video/mp4', video: ['avc', 'hevc', 'av1'], audio: ['aac', 'opus'] },
  mov: { label: 'MOV', ext: 'mov', mime: 'video/quicktime', video: ['avc', 'hevc', 'prores'], audio: ['aac', 'pcm-s16'] },
  mkv: { label: 'MKV', ext: 'mkv', mime: 'video/x-matroska', video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus', 'flac'] },
  webm: { label: 'WebM', ext: 'webm', mime: 'video/webm', video: ['vp9', 'av1', 'vp8'], audio: ['opus', 'vorbis'] },
};

export const VIDEO_CODEC_LABELS = {
  auto: t('render.ui.43f8433bd'),
  avc: 'H.264 / AVC',
  hevc: 'H.265 / HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
  prores: 'Apple ProRes',
};

export const AUDIO_CODEC_LABELS = {
  auto: t('render.ui.8304a6584'),
  aac: 'AAC',
  opus: 'Opus',
  flac: 'FLAC',
  'pcm-s16': 'PCM 16-bit',
  vorbis: 'Vorbis',
};

export const DISPLAY_MODES = {
  score: t('render.ui.05eb8912b'),
  information: t('render.ui.51a038045'),
  clean: t('render.ui.892d73716'),
};

export const DEFAULT_SETTINGS = Object.freeze({
  format: 'mp4',
  preset: '1080p',
  width: 1920,
  height: 1080,
  fps: 60,
  videoCodec: 'auto',
  videoBitrate: 12,
  audioCodec: 'auto',
  audioBitrate: 192,
  sampleRate: 48000,
  fileName: '{name} - Autoplay',
  start: 0,
  end: 0,
  backgroundDim: 0.65,
  backgroundBlur: 63,
  display: 'score',
  // 谱面偏移（毫秒）：音乐位置 = 谱面时间 + offset，与 META.offset / 谱面信息里的「偏移 / 毫秒」同义。
  // offsetAuto 为真时跟着谱面自身走；手动改过偏移就固定成手填的值。
  offset: 0,
  offsetAuto: true,
  // 音符大小按百分比：100% = 播放器默认（1350 舞台下的 175px）。
  noteScale: 100,
  lineScale: 1,
  noteSkin: 'default',
  noteHighlight: true,
  skinPolicy: 'render',
  autoplayText: 'AUTOPLAY',
  showCombo: true,
  showOffsetBar: false,
  // 判定线颜色（AP 指示）：开 = 线跟着判定变色（good/miss 会变），关 = 恒白。
  showApBadge: true,
  showProgress: true,
  showPause: true,
  showChartName: true,
  showChartLevel: true,
  showHitEffects: true,
  shaders: true,
  noise: true,
  musicVolume: 0.9,
  hitVolume: 0.6,
  hitSounds: true,
  watermark: '',
  loop: true,
});

const oneOf = (value, values, fallback) => values.includes(value) ? value : fallback;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback, max = 2000) => typeof value === 'string' ? value.slice(0, max) : fallback;

export function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const format = oneOf(value.format, Object.keys(FORMATS), DEFAULT_SETTINGS.format);
  const preset = oneOf(value.preset, [...RESOLUTIONS.map(([id]) => id), 'custom'], DEFAULT_SETTINGS.preset);
  let width = Math.round(clamp(finite(value.width, DEFAULT_SETTINGS.width), 64, 7680));
  let height = Math.round(clamp(finite(value.height, DEFAULT_SETTINGS.height), 64, 4320));
  // H.264/HEVC require even dimensions; keep custom fields even so the muxer never rejects the job.
  width -= width % 2; height -= height % 2;
  const videoCodecs = FORMATS[format].video;
  const audioCodecs = FORMATS[format].audio;
  let videoCodec = oneOf(value.videoCodec, ['auto', ...Object.keys(VIDEO_CODEC_LABELS).filter(key => key !== 'auto')], 'auto');
  let audioCodec = oneOf(value.audioCodec, ['auto', ...Object.keys(AUDIO_CODEC_LABELS).filter(key => key !== 'auto')], 'auto');
  if (videoCodec !== 'auto' && !videoCodecs.includes(videoCodec)) videoCodec = 'auto';
  if (audioCodec !== 'auto' && !audioCodecs.includes(audioCodec)) audioCodec = 'auto';
  return {
    format,
    preset,
    width,
    height,
    fps: oneOf(finite(value.fps, DEFAULT_SETTINGS.fps), [24, 25, 30, 50, 60, 90, 120, 144, 240], DEFAULT_SETTINGS.fps),
    videoCodec,
    videoBitrate: clamp(finite(value.videoBitrate, DEFAULT_SETTINGS.videoBitrate), 1, 200),
    audioCodec,
    audioBitrate: oneOf(finite(value.audioBitrate, DEFAULT_SETTINGS.audioBitrate), [64, 96, 128, 192, 256, 320, 512, 1024], DEFAULT_SETTINGS.audioBitrate),
    sampleRate: oneOf(finite(value.sampleRate, DEFAULT_SETTINGS.sampleRate), [32000, 44100, 48000, 88200, 96000], DEFAULT_SETTINGS.sampleRate),
    fileName: text(value.fileName, DEFAULT_SETTINGS.fileName, 160),
    start: clamp(finite(value.start, 0), 0, 12 * 3600 - .1),
    end: clamp(finite(value.end, 0), 0, 12 * 3600),
    backgroundDim: clamp(finite(value.backgroundDim, DEFAULT_SETTINGS.backgroundDim), 0, 1),
    backgroundBlur: clamp(finite(value.backgroundBlur, DEFAULT_SETTINGS.backgroundBlur), 0, 200),
    display: oneOf(value.display, Object.keys(DISPLAY_MODES), DEFAULT_SETTINGS.display),
    offset: clamp(finite(value.offset, DEFAULT_SETTINGS.offset), -60000, 60000),
    offsetAuto: value.offsetAuto === undefined ? DEFAULT_SETTINGS.offsetAuto : value.offsetAuto !== false,
    // 旧存档存的是像素（60–420）；换算成百分比后继续用，避免升级后音符突然变成 175%。
    noteScale: clamp(finite(value.noteScale,
      Number(value.noteSize) > 0 ? Number(value.noteSize) / 175 * 100 : DEFAULT_SETTINGS.noteScale), 30, 300),
    lineScale: clamp(finite(value.lineScale, DEFAULT_SETTINGS.lineScale), 0.2, 3),
    noteSkin: text(value.noteSkin, 'default', 160),
    skinPolicy: oneOf(value.skinPolicy, ['render','skin'], 'render'),
    noteHighlight: value.noteHighlight === undefined ? DEFAULT_SETTINGS.noteHighlight : value.noteHighlight !== false,
    autoplayText: text(value.autoplayText, DEFAULT_SETTINGS.autoplayText, 40),
    showCombo: value.showCombo === undefined ? DEFAULT_SETTINGS.showCombo : value.showCombo !== false,
    showOffsetBar: value.showOffsetBar === undefined ? DEFAULT_SETTINGS.showOffsetBar : value.showOffsetBar === true,
    showApBadge: value.showApBadge === undefined ? DEFAULT_SETTINGS.showApBadge : value.showApBadge === true,
    showProgress: value.showProgress === undefined ? DEFAULT_SETTINGS.showProgress : value.showProgress !== false,
    showPause: value.showPause === undefined ? DEFAULT_SETTINGS.showPause : value.showPause === true,
    showChartName: value.showChartName === undefined ? DEFAULT_SETTINGS.showChartName : value.showChartName !== false,
    showChartLevel: value.showChartLevel === undefined ? DEFAULT_SETTINGS.showChartLevel : value.showChartLevel !== false,
    showHitEffects: value.showHitEffects !== false,
    shaders: value.shaders !== false,
    noise: value.noise !== false,
    musicVolume: clamp(finite(value.musicVolume, DEFAULT_SETTINGS.musicVolume), 0, 1),
    hitVolume: clamp(finite(value.hitVolume, DEFAULT_SETTINGS.hitVolume), 0, 1),
    hitSounds: value.hitSounds !== false,
    watermark: text(value.watermark, '', 120),
    loop: value.loop !== false,
  };
}

export function applyResolutionPreset(settings, preset, width, height) {
  if (preset === 'custom') return normalizeSettings({ ...settings, preset, width, height });
  const entry = RESOLUTIONS.find(([id]) => id === preset) ?? RESOLUTIONS[1];
  return normalizeSettings({ ...settings, preset: entry[0], width: entry[1], height: entry[2] });
}

export function fileExtension(format) { return FORMATS[format]?.ext ?? 'mp4'; }
export function fileMime(format) { return FORMATS[format]?.mime ?? 'video/mp4'; }
export function formatLabel(format) { return FORMATS[format]?.label ?? 'MP4'; }

export function formatDuration(seconds, fps = 60) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secs = Math.floor(total % 60);
  const frames = Math.floor((total % 1) * Math.max(1, fps));
  return `${hours ? String(hours).padStart(2, '0') + ':' : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

export function estimateBytes(settings, duration) {
  const seconds = Math.max(0, Number(duration) || 0);
  return Math.round((settings.videoBitrate * 1e6 + settings.audioBitrate * 1000) * seconds / 8);
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(2) + ' GiB';
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(1) + ' MiB';
  if (value >= 1024) return (value / 1024).toFixed(0) + ' KiB';
  return value + ' B';
}

export function safeFileName(value, fallback = 'autoplay') {
  return String(value || fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || fallback;
}
