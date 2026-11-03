// Adapted from Autoplay Studio 1.1.7 by NyamonZone; integrated RPEN renderer.
import { fileExtension, fileMime, FORMATS } from '../core/render-settings.mjs';
import { checkRenderAbort, renderAwait, renderFramePlan } from '../core/render-task.mjs';
import { renderFrames } from '../application/render-frames.mjs';
import { t } from '../i18n.mjs';

let mediaPromise = null;
export function loadMediaBunny() {
  mediaPromise ??= import('../../assets/vendor/mediabunny/mediabunny.min.mjs');
  return mediaPromise;
}

const VIDEO_CANDIDATES = ['avc', 'hevc', 'vp9', 'av1', 'vp8', 'prores'];
const AUDIO_CANDIDATES = ['aac', 'opus', 'flac', 'vorbis', 'pcm-s16'];

export async function probeCodecs(settings) {
  const media = await loadMediaBunny();
  const video = {};
  for (const codec of FORMATS[settings.format].video) {
    try {
      video[codec] = await media.canEncodeVideo(codec, {
        width: settings.width, height: settings.height,
        bitrate: Math.round(settings.videoBitrate * 1e6), frameRate: settings.fps,
      });
    } catch { video[codec] = false; }
  }
  const audio = {};
  for (const codec of FORMATS[settings.format].audio) {
    try {
      // AAC 在 Windows 上通常只开放 96–192 kbps；低码率请求仍按 AAC 最低可用档探测。
      const rate = codec === 'aac' ? Math.max(96, settings.audioBitrate) : settings.audioBitrate;
      audio[codec] = await media.canEncodeAudio(codec, {
        numberOfChannels: 2, sampleRate: settings.sampleRate,
        ...(codec === 'pcm-s16' ? {} : { bitrate: rate * 1000 }),
      });
    } catch { audio[codec] = false; }
  }
  return { video, audio };
}

async function chooseVideo(media, settings, report) {
  const candidates = settings.videoCodec === 'auto'
    ? FORMATS[settings.format].video.filter(codec => VIDEO_CANDIDATES.includes(codec))
    : [settings.videoCodec];
  for (const codec of candidates) {
    if (!FORMATS[settings.format].video.includes(codec)) continue;
    let supported = false;
    try {
      supported = await media.canEncodeVideo(codec, {
        width: settings.width, height: settings.height,
        bitrate: Math.round(settings.videoBitrate * 1e6), frameRate: settings.fps,
      });
    } catch { supported = false; }
    if (supported) return codec;
    report?.(t('render.ui.6ab30959c',{p0:(settings.format.toUpperCase()),p1:(codec)}));
  }
  throw new Error(t('render.ui.4754af406',{p0:(FORMATS[settings.format].label)}));
}

async function chooseAudio(media, settings) {
  if (!settings.__hasAudio) return null;
  const candidates = settings.audioCodec === 'auto'
    ? FORMATS[settings.format].audio.filter(codec => AUDIO_CANDIDATES.includes(codec))
    : [settings.audioCodec];
  for (const codec of candidates) {
    if (!FORMATS[settings.format].audio.includes(codec)) continue;
    const rates = codec === 'aac'
      ? [...new Set([Math.max(96, settings.audioBitrate), 128, 192])]
      : [settings.audioBitrate];
    for (const rate of rates) {
      try {
        const supported = await media.canEncodeAudio(codec, {
          numberOfChannels: 2, sampleRate: settings.sampleRate,
          ...(codec.startsWith('pcm-') ? {} : { bitrate: rate * 1000 }),
        });
        if (supported) return { codec, bitrate: rate * 1000 };
      } catch { /* 继续尝试 */ }
    }
  }
  throw new Error(t('render.noAudioEncoder'));
}

function outputFormat(media, format, streaming = false) {
  // 流式导出不能开 fastStart: 'in-memory'——它要求整个文件先留在内存里，
  // 十几分钟的 1080p 会直接把手机 WebView 撑爆。moov 放末尾即可，播放器照样能放。
  if (format === 'mp4') return new media.Mp4OutputFormat(streaming ? {} : { fastStart: 'in-memory' });
  if (format === 'mov') return new media.MovOutputFormat();
  if (format === 'mkv') return new media.MkvOutputFormat();
  if (format === 'webm') return new media.WebMOutputFormat();
  throw new Error(t('render.ui.1b4ae3939') + format);
}

/**
 * drawFrame may await disk/asset preparation, then draws into the fixed canvas.
 * CanvasSource.add snapshots it before one following draw overlaps encoding.
 * Interface previews are independent and limited by wall time, not output FPS.
 */
export async function encodeVideo({
  canvas, audioTrack, settings, duration, drawFrame, onFrame, signal, onProgress, report, stream,
}) {
  checkRenderAbort(signal);
  if (!stream?.writable) throw Error(t('render.outputRequired'));
  const media = await renderAwait(loadMediaBunny(), signal);
  const videoCodec = await renderAwait(chooseVideo(media, settings, report), signal);
  const audioChoice = await renderAwait(chooseAudio(media, { ...settings, __hasAudio: Boolean(audioTrack) }), signal);
  const audioCodec = audioChoice?.codec ?? null;
  const format = outputFormat(media, settings.format, true);
  const target = new media.StreamTarget(stream.writable, { chunked: true, chunkSize: 1 << 19 });
  const output = new media.Output({ format, target });
  const source = new media.CanvasSource(canvas, {
    codec: videoCodec,
    bitrate: Math.round(settings.videoBitrate * 1e6),
  });
  output.addVideoTrack(source, { frameRate: settings.fps });
  let audioSource = null;
  if (audioTrack && audioCodec) {
    audioSource = new media.AudioSampleSource({
      codec: audioCodec,
      ...(audioCodec.startsWith('pcm-') ? {} : { bitrate: audioChoice.bitrate }),
    });
    output.addAudioTrack(audioSource);
  }
  const { frames, frameDuration } = renderFramePlan(duration, settings.fps);
  let audioFrame = 0;
  const cancel = () => { void output.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await renderAwait(output.start(), signal);
    await renderFrames({ frames, frameDuration, duration, drawFrame, signal,
      pipeline: typeof globalThis.VideoFrame === 'function',
      beforeFrame: async time => {
        if (audioSource && audioFrame / settings.sampleRate <= time + 1e-9) {
          const count = Math.min(settings.sampleRate, Math.round(duration * settings.sampleRate) - audioFrame);
          if (count > 0) {
            const data = await renderAwait(audioTrack.read(audioFrame / settings.sampleRate, count), signal);
            const sample = new media.AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: settings.sampleRate, timestamp: audioFrame / settings.sampleRate });
            try { await renderAwait(audioSource.add(sample), signal); } finally { sample.close(); }
            audioFrame += count;
          }
        }
      },
      submitFrame: (time, seconds) => source.add(time, seconds),
      onFrame: frame => onFrame?.({ ...frame, canvas }),
      onProgress: progress => onProgress?.({ phase: 'encode', ...progress, videoCodec, audioCodec }),
    });
    await renderAwait(output.finalize(), signal);
    const bytes = stream.bytes();
    if (!bytes) throw new Error(t('render.ui.25dac2f47'));
    return {
      buffer: null,
      bytes,
      streamed: Boolean(stream),
      videoCodec,
      audioCodec,
      format: settings.format,
      extension: fileExtension(settings.format),
      mime: fileMime(settings.format),
      frames,
    };
  } catch (error) {
    try { await output.cancel(); } catch { /* 已取消或已终结 */ }
    checkRenderAbort(signal); throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
