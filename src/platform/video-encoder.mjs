// Adapted from Autoplay Studio 1.1.7 by NyamonZone; integrated RPEN renderer.
import { fileExtension, fileMime, FORMATS } from '../core/render-settings.mjs';
import { checkRenderAbort, renderAwait, renderFramePlan } from '../core/render-task.mjs';
import { renderFrames } from '../application/render-frames.mjs';
import { t } from '../i18n.mjs';

let mediaPromise = null;
let frameBufferTransfer;
function rawEditorVideoFrame(image, timestamp, duration) {
  if (frameBufferTransfer === undefined) {
    frameBufferTransfer = false;
    try {
      const pixel = new Uint8Array([0, 0, 0, 255]);
      const probe = new VideoFrame(pixel, { format: 'RGBA', codedWidth: 1, codedHeight: 1, timestamp: 0, transfer: [pixel.buffer] });
      frameBufferTransfer = pixel.byteLength === 0; probe.close();
    } catch { /* Older engines copy the pixels instead. */ }
  }
  return new VideoFrame(image.bytes, { format: image.format, codedWidth: image.width, codedHeight: image.height,
    layout: [{ offset: 0, stride: image.stride }], timestamp: Math.round(timestamp * 1e6), duration: Math.round(duration * 1e6),
    colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
    ...(frameBufferTransfer ? { transfer: [image.bytes.buffer] } : {}) });
}
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

/** Incremental, backpressured encoding; stopping finalizes the frames already added. */
export async function createVideoEncodingSession({ canvas, sampleFrames = false, audioTrack, settings, stream, signal }) {
  checkRenderAbort(signal);
  const media = await renderAwait(loadMediaBunny(), signal);
  const videoCodec = await renderAwait(chooseVideo(media, settings), signal);
  const audioChoice = await renderAwait(chooseAudio(media, { ...settings, __hasAudio: Boolean(audioTrack) }), signal);
  const output = new media.Output({ format: outputFormat(media, settings.format, true), target: new media.StreamTarget(stream.writable, { chunked: true, chunkSize: 1 << 19 }) });
  const config = { codec: videoCodec, bitrate: Math.round(settings.videoBitrate * 1e6) };
  const video = sampleFrames ? new media.VideoSampleSource(config) : new media.CanvasSource(canvas, config);
  output.addVideoTrack(video, { frameRate: settings.fps });
  const audio = audioChoice && new media.AudioSampleSource({ codec: audioChoice.codec, ...(audioChoice.codec.startsWith('pcm-') ? {} : { bitrate: audioChoice.bitrate }) });
  if (audio) output.addAudioTrack(audio);
  let frames = 0, audioFrames = 0, done = false;
  const cancel = () => { void output.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const release = () => signal?.removeEventListener('abort', cancel);
  const addAudio = async final => {
    checkRenderAbort(signal);
    const total = Math.round(frames / settings.fps * settings.sampleRate);
    while (audio && total > audioFrames && (final || total - audioFrames >= settings.sampleRate / 2)) {
      const count = Math.min(Math.floor(settings.sampleRate / 2), total - audioFrames);
      const data = await renderAwait(audioTrack.read(audioFrames / settings.sampleRate, count), signal);
      const sample = new media.AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: settings.sampleRate, timestamp: audioFrames / settings.sampleRate });
      try { await renderAwait(audio.add(sample), signal); } finally { sample.close(); }
      audioFrames += count;
    }
  };
  try { await renderAwait(output.start(), signal); }
  catch (error) { release(); await output.cancel().catch(() => {}); throw error; }
  return { get frames() { return frames; },
    async add(image) {
      checkRenderAbort(signal);
      if (done) throw Error('Video encoder is closed');
      const timestamp = frames / settings.fps, duration = 1 / settings.fps;
      if (sampleFrames) {
        let sample;
        try {
          if (image.format === 'BGRA' || image.format === 'RGBA') {
            // Transfer native pixels when supported, otherwise copy in native
            // code. Avoid PNG, JS swizzling, canvas upload and readback.
            const frame = rawEditorVideoFrame(image, timestamp, duration);
            try { sample = new media.VideoSample(frame); } catch (error) { frame.close(); throw error; }
          } else sample = new media.VideoSample(image.bitmap, { timestamp, duration });
          await renderAwait(video.add(sample), signal);
        } finally { sample?.close(); }
      } else await renderAwait(video.add(timestamp, duration), signal);
      frames++; await addAudio(false);
    },
    async finish() {
      checkRenderAbort(signal);
      if (done) throw Error('Video encoder is closed');
      try {
        await addAudio(true); await renderAwait(output.finalize(), signal); done = true;
        if (!stream.bytes()) throw Error(t('render.ui.25dac2f47'));
        return { frames, duration: frames / settings.fps, bytes: stream.bytes(), videoCodec, audioCodec: audioChoice?.codec ?? null };
      } finally { release(); }
    },
    async abort() { if (done) return; done = true; release(); await output.cancel().catch(() => {}); }
  };
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
