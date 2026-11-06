import { probeCodecs } from './video-encoder.mjs';
import { t } from '../i18n.mjs';
export async function editorRecordingEncoding(width, height, fps, sampleRate = 48000) {
  const base = { width, height, fps, videoCodec: 'auto', audioCodec: 'auto', videoBitrate: Math.min(100, Math.max(12, width * height * fps / 5e6)), audioBitrate: 192, sampleRate };
  for (const format of width % 2 || height % 2 ? ['webm', 'mp4'] : ['mp4', 'webm']) {
    const settings = { ...base, format }, codecs = await probeCodecs(settings);
    if (Object.values(codecs.video).some(Boolean) && Object.values(codecs.audio).some(Boolean)) return settings;
  }
  throw Error(t('editor-recording.noEncoder'));
}
export function editorRecordingName(editor) { return (editor.chart.META?.name || editor.chartName || 'RPEN').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100); }
