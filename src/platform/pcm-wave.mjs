import { t } from '../i18n.mjs';
const yieldEncoding = () => globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));

export async function pcmWave(buffer, cancelled = () => false, leadingSeconds = 0) {
  const channels = buffer.numberOfChannels;
  const leadingFrames = Math.max(0, Math.round(Number(leadingSeconds) * buffer.sampleRate));
  const totalFrames = leadingFrames + buffer.length;
  const dataSize = totalFrames * channels * 4;
  if (!Number.isSafeInteger(dataSize) || dataSize > 0xffffffff - 36 || channels < 1) throw new Error(t('pcm-wave.se8b6c41'));
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset, value) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  text(0, 'RIFF'); view.setUint32(4, dataSize + 36, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true); view.setUint16(34, 32, true); text(36, 'data'); view.setUint32(40, dataSize, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  const parts = [new Blob([header])];
  for (let start = 0; start < totalFrames; start += 65536) {
    if (cancelled()) return null;
    const count = Math.min(65536, totalFrames - start);
    const chunk = new ArrayBuffer(count * channels * 4);
    const output = new DataView(chunk);
    for (let frame = 0; frame < count; frame++) {
      const sourceFrame = start + frame - leadingFrames;
      for (let channel = 0; channel < channels; channel++) output.setFloat32((frame * channels + channel) * 4, sourceFrame < 0 ? 0 : samples[channel][sourceFrame], true);
    }
    parts.push(new Blob([chunk]));
    await yieldEncoding();
  }
  return cancelled() ? null : new Blob(parts, { type: 'audio/wav' });
}
