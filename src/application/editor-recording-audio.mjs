import { loadStudioProject } from './render-project.mjs';
import { loadHitBuffers, disposeDecodeContext } from '../platform/render-audio.mjs';
import { mixRenderPcm } from '../core/render-audio-mix.mjs';
import { EditorTempoPcm, resampleEditorMusic } from '../core/editor-audio-tempo.mjs';
import { checkRenderAbort, renderYield } from '../core/render-task.mjs';
import { t } from '../i18n.mjs';

export async function createEditorRecordingAudio(editor, { start, rate, sampleRate = 48000, signal }) {
  const sounds = editor.hitSounds, musicVolume = editor.audio.volume, hitVolume = sounds.enabled ? sounds.volume : 0;
  const project = await loadStudioProject({ editor }, signal, { musicEnabled: musicVolume > 0, playbackMusic: true, hitDelays: { ...sounds.delays }, hitLine: sounds.onlyCurrentLine ? editor.session.lineIndex : null });
  try {
    const buffers = new Map();
    if (hitVolume > 0) {
      await sounds.prepare();
      for (const [name, buffer] of [...sounds.buffers, ...sounds.skinBuffers]) buffers.set(name, buffer);
    }
    const ensure = async entries => {
      const names = [...new Set(entries.map(e => e.sound))].filter(name => !buffers.has(name));
      if (names.length) { const loaded = await loadHitBuffers({ assets: project.assets, chartName: project.chartName, sampleRate, signal, names }); for (const [name, buffer] of loaded) buffers.set(name, buffer); }
      if ([...buffers.values()].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0) > 64 * 1024 ** 2) throw Error(t('render.soundBudget'));
    };
    if (hitVolume > 0) await ensure(project.hitSoundNames.map(sound => ({ sound })));
    const offset = project.chartOffset / 1000;
    const stretch = rate !== 1 && editor.audio.preservePitch ? new EditorTempoPcm({ sampleRate, rate, start }) : null;
    let active = [], until = null;
    return { project, sampleRate,
      async read(relative, frames) {
        checkRenderAbort(signal); project.assertCurrent();
        const first = start + relative * rate, end = first + frames / sampleRate * rate;
        let data = new Float32Array(frames * 2);
        if (musicVolume > 0 && project.musicSource) {
          const range = stretch?.range(relative, frames);
          const pieces = await project.musicSource.read(range?.start ?? first, range?.end ?? end, signal);
          if (stretch) {
            const input = mixRenderPcm({ music: pieces, start: range.start, frames: range.frames, sampleRate });
            data = stretch.read(input, range.start, frames); for (let i = 0; i < data.length; i++) data[i] *= musicVolume;
          } else data = resampleEditorMusic({ music: pieces, start: first, frames, sampleRate, rate, volume: musicVolume });
        }
        if (hitVolume > 0) {
          const lookback = Math.max(0, ...[...buffers.values()].map(b => b.duration)) * rate;
          const continuous = until !== null && Math.abs(until - first) < 1e-6;
          const hits = await project.readHits((continuous ? until : first - lookback) - offset, end - offset, signal);
          await ensure(hits);
          active = [...(continuous ? active : []).filter(h => h.time + (buffers.get(h.sound)?.duration ?? 0) > relative), ...hits.map(h => ({ ...h, time: (h.time + offset - start) / rate }))];
          if (active.length > 200000) throw Error(t('render.audioBudget'));
          until = end;
          for (let index = 0; index < active.length; index += 64) {
            mixRenderPcm({ start: relative, frames, sampleRate, hits: active.slice(index, index + 64), hitBuffers: buffers, musicVolume: 0, hitVolume, target: data });
            if (index + 64 < active.length) await renderYield(signal);
          }
        }
        return data;
      },
      dispose() { project.dispose(); buffers.clear(); active = []; disposeDecodeContext(); }
    };
  } catch (error) { project.dispose(); disposeDecodeContext(); throw error; }
}
