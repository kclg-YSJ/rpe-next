// Adapted from Autoplay Studio 1.1.7 by NyamonZone; integrated RPEN renderer.
import { loadStudioProject, rangeEndAtOffset } from '../../application/render-project.mjs';
import {
  DEFAULT_SETTINGS, DISPLAY_MODES, FORMATS, VIDEO_CODEC_LABELS, AUDIO_CODEC_LABELS,
  applyResolutionPreset, estimateBytes, fileExtension, fileMime, formatBytes,
  formatDuration, formatLabel, normalizeSettings, safeFileName, STORAGE_KEY,
} from '../../core/render-settings.mjs';
import { AutoplayScene, noteSkinChoices } from './renderer.mjs';
import { loadHitBuffers, createRenderAudioTrack, disposeDecodeContext } from '../../platform/render-audio.mjs';
import { createVideoOutput } from '../../platform/video-output.mjs';
import { checkRenderAbort, renderAwait } from '../../core/render-task.mjs';
import { t } from '../../i18n.mjs';
import { isTextEntry, isPlaybackSpace } from '../keyboard.mjs';
import { mixRenderPcm } from '../../core/render-audio-mix.mjs';
import { encodeVideo, probeCodecs } from '../../platform/video-encoder.mjs';

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const button = (text, className = '') => {
  const node = el('button', `rpas-button ${className}`.trim(), text);
  node.type = 'button';
  return node;
};
const section = (title, description = '') => {
  const node = el('section', 'rpas-section');
  node.append(el('h3', '', title));
  if (description) node.append(el('p', 'rpas-hint', description));
  return node;
};
const row = (label, control, hint = '') => {
  const node = el('label', 'rpas-field');
  node.append(el('span', 'rpas-field-label', label), control);
  if (hint) node.append(el('small', 'rpas-hint', hint));
  return node;
};

export class RenderStudio {
  constructor(api) {
    this.api = api;
    this.isOpen = false;
    this.opening = false;
    this.rendering = false;
    this.playing = true;
    this.previewTime = 0;
    this.duration = 1;
    this.scene = null;
    this.project = null;
    this.skins = new Map();
    this.controls = new Map();
    this.abort = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.lastResult = null;
    this.closeRequested = false;
    this.settings = normalizeSettings(api.storage.read({})[STORAGE_KEY] ?? DEFAULT_SETTINGS);
    this.saveTimer = 0;
    // The modal owns playback shortcuts; real text fields retain native editing.
    api.hook?.('input:before', payload => {
      const event = payload?.event;
      if (!event || !this.isOpen || event.type !== 'keydown' || event.isComposing) return;
      if (isTextEntry(event.target)) return;
      if (event.key === 'Escape') {
        if (this.rendering) return;
        payload.handled = true;
        this.close();
        return;
      }
      if (isPlaybackSpace(event)) {
        payload.handled = true;
        this.togglePlay();
      }
    });
    this.api.listen(window, 'keydown', event => {
      if (!this.isOpen || event.key !== 'Escape' || event.isComposing) return;
      if (this.rendering) return;
      event.preventDefault(); this.close();
    });
  }

  async open() {
    if (this.opening || this.isOpen) { this.root?.focus(); return; }
    this.opening = true;
    const generation = this.generation = (this.generation ?? 0) + 1;
    const controller = this.loadAbort = new AbortController();
    const signal = controller.signal;
    this.releaseLock();
    this.buildShell();
    this.api.mount(this.root);
    // Keep the modal outside the editor subtree while its controls are inert.
    if (this.root.parentElement !== document.body || this.root.closest('[inert]')) document.body.append(this.root);
    document.documentElement.classList.add('rpen-render-active');
    this.unlock = this.api.lockEditing();
    this.setLoading(true, t('render.ui.4a1de69b0'));
    try {
      // 制谱器里正在播放时打开渲染器：先停掉制谱器的音乐，否则两边各播一份
      // （尤其换了皮肤后延迟不同步，听起来就是「两个音频叠着」）。关掉面板再恢复。
      this.editorWasPlaying = false;
      try {
        const editor = this.api.editor;
        this.editorWasPlaying = Boolean(editor?.audio?.playing);
        editor?.pause?.();
      } catch (error) { console.warn(t('render.ui.a4efdb953'), error); }
      const [project, skins] = await Promise.all([
        loadStudioProject(this.api, signal, { musicEnabled: this.settings.musicVolume > 0 }),
        noteSkinChoices(this.api.editor),
      ]);
      if (!this.isOpen || generation !== this.generation) { project.dispose?.(); return; }
      this.project = project;this.sourceSession=project.sourceSession;this.sourceChart=project.sourceChart;
      this.skins = skins;
      const defaults = this.settings;
      this.settings = normalizeSettings({
        ...defaults,
        // A start/end saved for another chart is useless and often out of range; the rest persist.
        start: 0, end: 0,
        // 谱面偏移默认取这张谱自己的（谱面信息 / JSON 的 META.offset）；
        // 只有用户手动改过（offsetAuto=false）才沿用存档里那个值。
        offset: defaults.offsetAuto ? project.chartOffset : defaults.offset,
        noteSkin: skins.has(defaults.noteSkin) ? defaults.noteSkin : 'default',
      });
      this.rebuildSkinSelect();
      await this.buildScene(signal);
      checkRenderAbort(signal); if (generation !== this.generation || !this.isOpen) return;
      this.setLoading(false);
      this.syncControls();
      this.updateOffsetHint();
      this.refreshSummary();
      this.resetPlayback();
      this.play();
      this.probe();
      this.root.querySelector('.rpas-close')?.focus();
    } catch (error) {
      if (signal.aborted || generation !== this.generation) return;
      console.error('[render]', error);
      this.setLoading(true, t('render.ui.5a7781220') + (error?.message ?? error), true);
      this.api.notify?.('Autoplay Studio：' + (error?.message ?? error), 'error');
    } finally {
      if (generation === this.generation) this.opening = false;
    }
  }

  buildShell() {
    const root = el('dialog', 'rpas-root');
    root.id = 'rpen-render-studio';
    root.tabIndex = -1;
    root.dataset.modInteractive = 'true';
    root.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    root.innerHTML = `
      <header class="rpas-header">
        <div class="rpas-title"><strong>${t('render.title')}</strong><span class="rpas-project"></span></div>
        <div class="rpas-header-actions"><span class="rpas-status" role="status"></span><button type="button" class="rpas-button rpas-close">${t('render.close')}</button></div>
      </header>
      <div class="rpas-main">
        <section class="rpas-preview-pane">
          <div class="rpas-canvas-wrap"><canvas class="rpas-display" aria-label="${t('render.preview')}"></canvas>
            <div class="rpas-loading"><span class="rpas-spinner"></span><strong class="rpas-loading-text">${t('render.ui.4a1de69b0')}</strong><button type="button" class="rpas-button rpas-retry" hidden>${t('render.retry')}</button></div>
          </div>
          <div class="rpas-transport">
            <button type="button" class="rpas-button rpas-play">${t('render.ui.8d12fc0d4')}</button>
            <input class="rpas-seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="${t('render.progress')}">
            <output class="rpas-time">00:00.00</output>
            <label class="rpas-loop"><input type="checkbox" checked>${t('render.loop')}</label>
          </div>
        </section>
        <aside class="rpas-settings" aria-label="${t('render.parameters')}"></aside>
      </div>
      <footer class="rpas-footer">
        <div class="rpas-summary"></div>
        <div class="rpas-progress-wrap"><progress class="rpas-progress" max="1" value="0" hidden></progress><span class="rpas-progress-text"></span></div>
        <div class="rpas-footer-actions">
          <button type="button" class="rpas-button rpas-download" hidden>${t('render.download')}</button>
          <button type="button" class="rpas-button rpas-open-folder" hidden>${t('render.openFolder')}</button>
          <button type="button" class="rpas-button rpas-render">${t('render.start')}</button>
          <button type="button" class="rpas-button rpas-cancel" hidden>${t('render.cancel')}</button>
        </div>
      </footer>`;
    this.root = root;
    this.display = root.querySelector('.rpas-display');
    this.seek = root.querySelector('.rpas-seek');
    this.time = root.querySelector('.rpas-time');
    this.playButton = root.querySelector('.rpas-play');
    this.loopInput = root.querySelector('.rpas-loop input');
    this.settingsHost = root.querySelector('.rpas-settings');
    this.summary = root.querySelector('.rpas-summary');
    this.progress = root.querySelector('.rpas-progress');
    this.progressText = root.querySelector('.rpas-progress-text');
    this.renderButton = root.querySelector('.rpas-render');
    this.downloadButton = root.querySelector('.rpas-download');
    this.openFolderButton = root.querySelector('.rpas-open-folder');
    this.cancelButton = root.querySelector('.rpas-cancel');
    this.loading = root.querySelector('.rpas-loading');
    this.loadingText = root.querySelector('.rpas-loading-text');
    this.statusNode = root.querySelector('.rpas-status');
    this.projectNode = root.querySelector('.rpas-project');
    root.querySelector('.rpas-close').onclick = () => this.close();
    root.querySelector('.rpas-retry').onclick = () => { this.close(); void this.open(); };
    this.playButton.onclick = () => this.togglePlay();
    this.display.onclick = () => this.togglePlay();
    // 进度条：拖动时先暂停，拖完恢复原来的播放状态。不做这层处理的话
    // 播放循环每帧都会把 value 写回去，看起来就是「拖不动」。
    const startSeek = () => {
      // 渲染中进度条是锁死的（见 setSeekLocked）；这里再兜一层，防止键盘/程序化改值。
      if (this.rendering) return;
      this.seeking = true;
      this.resumeAfterSeek = this.playing;
      this.pause();
      this.seek.classList.add('rpas-seeking');
    };
    const scrubTo = value => {
      this.previewTime = clamp(Number(value) || 0, 0, this.duration);
      this.renderCurrent();
      this.updateTime();
    };
    const endSeek = () => {
      if (!this.seeking) return;
      this.seeking = false;
      this.seek.classList.remove('rpas-seeking');
      if (this.resumeAfterSeek) { this.resumeAfterSeek = false; this.play(); }
    };
    this.seek.onpointerdown = startSeek;
    this.seek.oninput = () => {
      if (this.rendering) return;
      if (!this.seeking && this.playing) startSeek();
      scrubTo(this.seek.value);
    };
    this.seek.onchange = endSeek;
    this.seek.onpointerup = endSeek;
    this.seek.onpointercancel = endSeek;
    this.seek.addEventListener('lostpointercapture', endSeek);
    // 首次交互时解锁 AudioContext：打开面板不算用户手势，浏览器会把自动播放挂起。
    root.addEventListener('pointerdown', () => this.ensureAudioContext(), { capture: true });
    this.loopInput.checked = this.settings.loop;
    this.loopInput.onchange = () => this.update('loop', this.loopInput.checked);
    this.renderButton.onclick = () => this.render();
    this.downloadButton.onclick = () => this.downloadLast();
    this.openFolderButton.onclick = () => this.openFolderLast();
    this.cancelButton.onclick = () => this.abort?.abort();
    this.buildSettings();
    this.refreshCodecSelects();
    this.isOpen = true;
    this.duration = 1;
    this.previewTime = 0;
    this.refreshSummary();
  }

  setLoading(visible, message = '', failed = false) {
    if (!this.loading) return;
    this.loading.hidden = !visible;
    this.loadingText.textContent = message;
    this.loading.classList.toggle('failed', failed);
    this.loading.querySelector('.rpas-retry').hidden = !failed;
    this.root.classList.toggle('rpas-loading-on', visible);
  }

  status(message, level = '') {
    if (!this.statusNode) return;
    this.statusNode.textContent = message;
    this.statusNode.dataset.level = level;
  }

  buildSettings() {
    const host = this.settingsHost;
    host.replaceChildren();
    this.controls.clear();
    const output = section(t('render.ui.fb04addb4'), t('render.ui.df5e8e2c6'));
    const format = el('select');
    for (const [id, info] of Object.entries(FORMATS)) format.append(new Option(info.label + ' · .' + info.ext, id));
    this.registerSelect('format', format);
    output.append(row(t('render.ui.e4e86807e'), format));
    const preset = el('select');
    for (const [id, width, height] of [['720p', 1280, 720], ['1080p', 1920, 1080], ['1440p', 2560, 1440], ['4K', 3840, 2160], ['custom', 0, 0]]) preset.append(new Option(id === 'custom' ? t('render.ui.1b43c95ce') : `${id} · ${width}×${height}`, id));
    this.registerSelect('preset', preset);
    output.append(row(t('render.ui.863063bd0'), preset));
    const dimensions = el('div', 'rpas-inline');
    const width = el('input'); width.type = 'number'; width.min = '64'; width.max = '7680'; width.step = '2'; width.className = 'rpas-number';
    const height = el('input'); height.type = 'number'; height.min = '64'; height.max = '4320'; height.step = '2'; height.className = 'rpas-number';
    this.registerInput('width', width, 'number'); this.registerInput('height', height, 'number');
    dimensions.append(width, el('span', '', '×'), height, el('span', 'rpas-hint', 'px'));
    output.append(row(t('render.ui.d9091912e'), dimensions));
    const fps = el('select');
    for (const value of [24, 25, 30, 50, 60, 90, 120, 144, 240]) fps.append(new Option(value + ' fps', value));
    this.registerSelect('fps', fps);
    output.append(row(t('render.ui.f9404bf33'), fps));
    const videoCodec = el('select'); this.registerSelect('videoCodec', videoCodec);
    output.append(row(t('render.ui.780da4f96'), videoCodec));
    output.append(this.rangeField('videoBitrate', t('render.ui.01045c06d'), 1, 60, 1, value => value + ' Mbps'));
    const audioCodec = el('select'); this.registerSelect('audioCodec', audioCodec);
    output.append(row(t('render.ui.116df04d5'), audioCodec));
    const audioBitrate = el('select');
    for (const value of [64, 96, 128, 192, 256, 320, 512, 1024]) audioBitrate.append(new Option(value + ' kbps', value));
    this.registerSelect('audioBitrate', audioBitrate);
    output.append(row(t('render.ui.478ee5d78'), audioBitrate));
    const sampleRate = el('select');
    for (const value of [32000, 44100, 48000, 88200, 96000]) sampleRate.append(new Option((value / 1000) + ' kHz', value));
    this.registerSelect('sampleRate', sampleRate);
    output.append(row(t('render.ui.0f5498537'), sampleRate));
    const fileName = el('input'); fileName.type = 'text'; fileName.maxLength = 160; fileName.placeholder = '{name} - Autoplay'; fileName.className = 'rpas-text';
    this.registerInput('fileName', fileName, 'text');
    output.append(row(t('render.ui.a6e48adc2'), fileName, t('render.ui.8f92f5fa2')));
    this.capability = el('p', 'rpas-hint rpas-capability', t('render.ui.bd38638c9'));
    output.append(this.capability);
    host.append(output);

    const picture = section(t('render.ui.d051df30a'), t('render.ui.854d44881'));
    const display = el('select');
    for (const [id, label] of Object.entries(DISPLAY_MODES)) display.append(new Option(label, id));
    this.registerSelect('display', display);
    picture.append(row(t('render.ui.8b91a1312'), display));
    const noteSkin = el('select'); noteSkin.className = 'rpas-text'; this.registerSelect('noteSkin', noteSkin);
    picture.append(row(t('render.ui.bb5c5c207'), noteSkin));
    const noteChecks = el('div', 'rpas-checks');
    for (const [key, label] of [['noteHighlight', t('render.ui.ce741b517')], ['shaders', t('render.ui.b8f6a09d2')], ['showHitEffects', t('render.ui.eebd99b5f')], ['noise', t('render.ui.b98c97de7')]]) {
      const check = el('label', 'rpas-check'); const input = el('input'); input.type = 'checkbox';
      this.registerInput(key, input, 'checkbox'); check.append(input, label); noteChecks.append(check);
    }
    picture.append(noteChecks);
    picture.append(this.rangeField('noteScale', t('render.ui.e19860738'), 30, 300, 1, value => value + '%'));
    picture.append(this.rangeField('lineScale', t('render.ui.af687b1b7'), 0.2, 3, 0.05, value => Number(value).toFixed(2) + '×'));
    picture.append(this.rangeField('backgroundDim', t('render.ui.f47005098'), 0, 1, 0.01, value => Math.round(value * 100) + '%'));
    picture.append(this.rangeField('backgroundBlur', t('render.ui.80faf20d6'), 0, 200, 1, value => value + ' px'));
    host.append(picture);

    const hud = section('HUD', t('render.ui.5b6faadf4'));
    const autoplayText = el('input'); autoplayText.type = 'text'; autoplayText.maxLength = 40; autoplayText.className = 'rpas-text';
    this.registerInput('autoplayText', autoplayText, 'text');
    hud.append(row(t('render.ui.ca710e930'), autoplayText, t('render.ui.8089584a1')));
    const hudChecks = el('div', 'rpas-checks');
    for (const [key, label] of [
      ['showCombo', t('render.ui.086b8a15f')], ['showOffsetBar', t('render.ui.91b5c1a3e')], ['showApBadge', t('render.ui.b048af7b0')],
      ['showProgress', t('render.ui.9cb91cb3a')], ['showPause', t('render.ui.d18ad10ec')], ['showChartName', t('render.ui.9b15ebef9')], ['showChartLevel', t('render.ui.87b1bf8b5')],
    ]) {
      const check = el('label', 'rpas-check'); const input = el('input'); input.type = 'checkbox';
      this.registerInput(key, input, 'checkbox'); check.append(input, label); hudChecks.append(check);
    }
    hud.append(hudChecks);
    const watermark = el('input'); watermark.type = 'text'; watermark.maxLength = 120; watermark.className = 'rpas-text'; watermark.placeholder = t('render.ui.673940bc6');
    this.registerInput('watermark', watermark, 'text');
    hud.append(row(t('render.ui.fb9add999'), watermark));
    host.append(hud);

    const policy = el('select'); policy.className='rpas-select';
    policy.append(new Option(t('render.policyRender'),'render'), new Option(t('render.policySkin'),'skin'));
    this.registerSelect('skinPolicy', policy);
    host.append(row(t('render.conflictPolicy'),policy,t('render.conflictHelp')));

    const sound = section(t('render.ui.296c632ec'), t('render.ui.7c8edde18'));
    sound.append(this.rangeField('musicVolume', t('render.ui.e190990e7'), 0, 1, 0.01, value => Math.round(value * 100) + '%'));
    sound.append(this.rangeField('hitVolume', t('render.ui.cf79aaee9'), 0, 1, 0.01, value => Math.round(value * 100) + '%'));
    const hitCheck = el('label', 'rpas-check'); const hitEnabled = el('input'); hitEnabled.type = 'checkbox';
    this.registerInput('hitSounds', hitEnabled, 'checkbox'); hitCheck.append(hitEnabled, t('render.ui.b1f3aa636')); sound.append(hitCheck);
    host.append(sound);

    const sync = section(t('render.ui.dcfe516d1'), t('render.ui.da9e8269a'));
    const offset = el('input'); offset.type = 'number'; offset.step = '1'; offset.min = '-60000'; offset.max = '60000'; offset.className = 'rpas-number';
    this.registerInput('offset', offset, 'number');
    const offsetInline = el('div', 'rpas-inline');
    offsetInline.append(offset, el('span', 'rpas-hint', 'ms'));
    sync.append(row(t('render.ui.021faa46a'), offsetInline));
    const followWrap = el('label', 'rpas-check');
    const follow = el('input'); follow.type = 'checkbox';
    this.registerInput('offsetAuto', follow, 'checkbox');
    this.offsetAutoText = el('span', '', t('render.ui.815ae2869'));
    followWrap.append(follow, this.offsetAutoText);
    sync.append(followWrap);
    this.offsetHint = el('p', 'rpas-hint', '');
    sync.append(this.offsetHint);
    host.append(sync);

    const range = section(t('render.ui.5203ca9f5'), t('render.ui.7d4ed8086'));
    const start = el('input'); start.type = 'number'; start.min = '0'; start.step = '0.1'; start.className = 'rpas-number';
    const end = el('input'); end.type = 'number'; end.min = '0'; end.step = '0.1'; end.className = 'rpas-number';
    this.registerInput('start', start, 'number'); this.registerInput('end', end, 'number');
    const rangeRow = el('div', 'rpas-inline'); rangeRow.append(start, el('span', '', '→'), end, el('span', 'rpas-hint', t('render.ui.9dcdc2b28')));
    range.append(row(t('render.ui.7c3873c69'), rangeRow));
    this.rangeHint = el('p', 'rpas-hint', '');
    range.append(this.rangeHint);
    host.append(range);
    this.updateOffsetHint();
  }

  /** 谱面自身的偏移（毫秒）。跟随模式下就是它，手动模式用用户填的值。 */
  effectiveOffset() {
    if (this.settings.offsetAuto) return Number(this.project?.chartOffset) || 0;
    return Number(this.settings.offset) || 0;
  }

  updateOffsetHint() {
    const chartOffset = Math.round((Number(this.project?.chartOffset) || 0) * 100) / 100;
    if (this.offsetAutoText) this.offsetAutoText.textContent = t('render.ui.da16258cd',{p0:(chartOffset)});
    if (!this.offsetHint) return;
    const current = Math.round(this.effectiveOffset() * 100) / 100;
    this.offsetHint.textContent = this.settings.offsetAuto
      ? t('render.ui.4c1155abd',{p0:(current)})
      : t('render.ui.563192e8c',{p0:(current),p1:(chartOffset)});
  }

  registerInput(key, input, type) {
    input.dataset.rpasKey = key;
    this.controls.set(key, { input, type });
    const handler = () => {
      if(type==='number'&&(!input.value.trim()||!Number.isFinite(Number(input.value))||!input.validity.valid))return;
      const value = type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value;
      void this.update(key, value).catch(error=>{if(error.name!=='AbortError')this.failPreview(error);});
    };
    input.addEventListener('input', handler);
    if (type === 'text') input.addEventListener('change', handler);
  }

  registerSelect(key, select) {
    select.dataset.rpasKey = key;
    this.controls.set(key, { input: select, type: 'select' });
    select.addEventListener('change', () => {void this.update(key, select.value).catch(error=>{if(error.name!=='AbortError')this.failPreview(error);});});
  }

  rangeField(key, label, min, max, step, format) {
    const wrap = el('label', 'rpas-field rpas-range-field');
    const heading = el('span', 'rpas-range-head'); const title = el('span', 'rpas-field-label', label); const output = el('output', 'rpas-range-value');
    heading.append(title, output);
    const input = el('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.dataset.rpasKey = key;
    this.controls.set(key, { input, output, format, type: 'range' });
    input.addEventListener('input', () => {
      output.textContent = format(Number(input.value));
        void this.update(key, Number(input.value)).catch(error=>{if(error.name!=='AbortError')this.failPreview(error);});
    });
    wrap.append(heading, input);
    return wrap;
  }

  rebuildSkinSelect() {
    const control = this.controls.get('noteSkin');
    if (!control) return;
    control.input.replaceChildren();
    control.input.append(new Option(t('render.ui.9648bb7f5'), 'default'));
    for (const [id, record] of this.skins) {
      if (id === 'default') continue;
      const name = record?.info?.name ?? id;
      control.input.append(new Option(record?.info?.author ? `${name} · ${record.info.author}` : name, id));
    }
    control.input.value = this.settings.noteSkin;
  }

  refreshCodecSelects() {
    const video = this.controls.get('videoCodec')?.input;
    if (video) {
      video.replaceChildren(new Option(VIDEO_CODEC_LABELS.auto, 'auto'));
      for (const codec of FORMATS[this.settings.format].video) video.append(new Option(VIDEO_CODEC_LABELS[codec] ?? codec, codec));
      video.value = this.settings.videoCodec;
    }
    const audio = this.controls.get('audioCodec')?.input;
    if (audio) {
      audio.replaceChildren(new Option(AUDIO_CODEC_LABELS.auto, 'auto'));
      for (const codec of FORMATS[this.settings.format].audio) audio.append(new Option(AUDIO_CODEC_LABELS[codec] ?? codec, codec));
      audio.value = this.settings.audioCodec;
    }
  }

  syncControls() {
    for (const [key, control] of this.controls) {
      const value = this.settings[key];
      if (control.type === 'checkbox') control.input.checked = Boolean(value);
      else if (control.type === 'range') { control.input.value = value; control.output.textContent = control.format(Number(value)); }
      else if (control.type === 'select') control.input.value = String(value);
      else if (document.activeElement !== control.input) control.input.value = String(value ?? '');
    }
    if (this.controls.get('format')) this.controls.get('format').input.value = this.settings.format;
    if (this.controls.get('preset')) this.controls.get('preset').input.value = this.settings.preset;
    // 偏移框显示「实际生效」的值：跟随谱面时是谱面的 offset，而不是存档里的旧数字。
    const offsetControl = this.controls.get('offset');
    if (offsetControl && document.activeElement !== offsetControl.input) offsetControl.input.value = String(this.effectiveOffset());
    const loop = this.root?.querySelector('.rpas-loop input'); if (loop) loop.checked = this.settings.loop;
  }

  async update(key, rawValue) {
    if (this.rendering) return;
    if (key === 'musicVolume' && Number(rawValue) > 0 && this.project?.musicError) throw this.project.musicError;
    if (key === 'musicVolume' || key === 'hitVolume') { this.settings[key] = rawValue; this.applyAudioVolume(); }
    if (!this.isOpen) return;
    let next;
    if (key === 'preset') {
      next = rawValue === 'custom'
        ? normalizeSettings({ ...this.settings, preset: 'custom' })
        : applyResolutionPreset(this.settings, rawValue);
    } else {
      const patch = { ...this.settings, [key]: rawValue };
      if (key === 'width' || key === 'height') patch.preset = 'custom';
      // 手动改偏移就固定用它，不再跟着谱面走（勾回「跟随谱面偏移」才恢复）。
      if (key === 'offset') patch.offsetAuto = false;
      next = normalizeSettings(patch);
    }
    // 勾上「跟随谱面偏移」时立刻回到谱面自己的值。
    if (key === 'offsetAuto' && next.offsetAuto) next = normalizeSettings({ ...next, offset: this.project?.chartOffset ?? next.offset });
    const previous = this.settings;
    this.settings = next;
    this.saveSettings();
    this.syncControls();
    if (key === 'offset' || key === 'offsetAuto') this.updateOffsetHint();
    if (key === 'format') this.refreshCodecSelects();
    if (['format','width','height','preset','fps','sampleRate','videoCodec','audioCodec','videoBitrate','audioBitrate'].includes(key)) void this.probe();
    if (key === 'noteSkin') {
      const record = this.skins.get(this.settings.noteSkin) ?? null;
      const scene=this.scene; if (scene) await scene.setNoteSkin(record);
      if (!this.isOpen || scene !== this.scene) return;
      await this.loadPreviewHits();
    }
    if (key === 'hitSounds') await this.loadPreviewHits();
    if (this.scene && (previous.width !== next.width || previous.height !== next.height)) this.scene.setSize(...this.previewSize(next));
    this.scene?.applySettings({...this.settings,width:this.scene.width,height:this.scene.height});
    this.syncRange();
    // 改偏移等于把音乐相对谱面平移，正在播就按新偏移重新起播，否则要等到下次播放才对齐。
    if (['offset','offsetAuto','start','end'].includes(key) && this.playing) this.startAudio();
    this.refreshSummary();
    this.renderCurrent();
  }

  saveSettings() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try { this.api.storage.write({ ...this.api.storage.read({}), [STORAGE_KEY]: this.settings }); }
      catch (error) { console.warn(t('render.ui.1e4a9506d'), error); }
    }, 120);
  }

  effectiveRange() {
    const start = Math.max(0, Number(this.settings.start) || 0);
    const autoEnd = Math.max(start + 0.1, this.project?.duration ?? 1);
    const end = Number(this.settings.end) > 0 ? Math.max(start + 0.1, Number(this.settings.end)) : autoEnd;
    return { start, end };
  }

  syncRange() {
    if (!this.project) return;
    // 偏移会改变「曲子末尾对应的谱面秒」，总时长跟着重算（HUD 进度条也读 project.duration）。
    if (this.project.range) this.project.duration = rangeEndAtOffset(this.project.range, this.effectiveOffset());
    const { start, end } = this.effectiveRange();
    this.range = { start, end };
    this.duration = Math.max(0.1, end - start);
    if (this.seek) this.seek.max = String(this.duration);
    this.previewTime = clamp(this.previewTime, 0, this.duration);
    if (this.seek) this.seek.value = String(this.previewTime);
    if (this.rangeHint) this.rangeHint.textContent = t('render.ui.a394859ef',{p0:(formatDuration(this.duration, this.settings.fps)),p1:(Math.round(this.duration * this.settings.fps))});
  }

  previewSize(settings=this.settings) { const scale=Math.min(1,1280/settings.width,720/settings.height);return [Math.max(2,Math.round(settings.width*scale/2)*2),Math.max(2,Math.round(settings.height*scale/2)*2)]; }
  async buildScene(signal) {
    this.scene?.dispose?.();
    this.scene = null;
    this.setLoading(true, t('render.ui.e6fc9cf3b'));
    const record = this.skins.get(this.settings.noteSkin) ?? null;
    const [width,height]=this.previewSize();
    const scene = new AutoplayScene(this.project, {...this.settings,width,height}, {purpose:'autoplay',signal,overlays:this.api.drawOverlays});
    try {
      await scene.init(record);
      if (!this.isOpen || signal?.aborted) { scene.dispose(); return; }
      this.scene = scene;
      this.projectNode.textContent = `${this.project.title} · ${this.settings.width}×${this.settings.height} · ${this.settings.fps} fps`;
      this.syncRange();
      await this.loadPreviewAudio();
      await this.loadPreviewHits();
      checkRenderAbort(signal);
      if (!this.isOpen || this.scene !== scene) return;
      this.setLoading(false);
      this.renderCurrent();
    } catch (error) {
      scene.dispose();
      throw error;
    }
  }

  resetPlayback() {
    this.previewTime = 0;
    this.scene?.applySettings({...this.settings,width:this.scene.width,height:this.scene.height});
    this.syncRange();
    this.renderCurrent();
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  /** 预览音乐：用实时 AudioContext 播同一份音乐，跟着 previewTime 起停/跳转。 */
  async loadPreviewAudio() {
    this.stopAudio(); this.audioBuffer=this.project.musicSource?.buffer??null;
    this.musicElement=this.project.musicSource?.createElement?.()??null;
    if(this.musicElement){const c=this.ensureAudioContext();this.elementSource=c.createMediaElementSource(this.musicElement);this.elementSource.connect(this.musicGain);}
  }
  async loadPreviewHits() {
    const generation=this.hitsGeneration=(this.hitsGeneration??0)+1,project=this.project;
    this.stopHitVoices(); this.hitEntries=[];this.hitCursor=0;this.hitWindow=null;
    if(!project||this.settings.hitSounds===false)return;
    const buffers=await loadHitBuffers({assets:project.assets,chartName:project.chartName,noteSkinRecord:this.skins.get(this.settings.noteSkin),sampleRate:48000,signal:this.loadAbort?.signal,names:project.hitSoundNames});
    if(!this.isOpen||this.project!==project||generation!==this.hitsGeneration)return;
    this.hitBuffers=buffers;this.previewHitTrack=createRenderAudioTrack(project,{...this.settings,start:0,musicVolume:0,hitVolume:1,offset:0,sampleRate:this.ensureAudioContext().sampleRate},buffers,this.loadAbort?.signal);this.hitScheduleAt=null;
  }
  ensureAudioContext() {
    if (!this.audioContext) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.audioContext = new Ctor();
      this.musicGain = this.audioContext.createGain();
      this.musicGain.connect(this.audioContext.destination);
      this.hitGain = this.audioContext.createGain();
      this.hitGain.connect(this.audioContext.destination);
      this.hitVoices = new Set();
    }
    if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
    return this.audioContext;
  }

  startAudio() {
    const context = this.ensureAudioContext();
    this.seekHitCursor();
    if (!context) return;
    this.stopAudio();
    // 记录「音乐从哪个谱面秒开始」和对应的 AudioContext 时间：
    // 打击音效按这条锚点提前排程，才不会晚一帧才响。
    this.hitScheduleAt=null;
    this.audioAnchor = { chartSeconds: (this.range?.start ?? 0) + this.previewTime, contextTime: context.currentTime };
    this.applyAudioVolume();
    const at=(this.range?.start??0)+this.previewTime+this.effectiveOffset()/1000;
    if(this.musicElement){const element=this.musicElement;element.pause();clearTimeout(this.musicStartTimer);element.currentTime=Math.max(0,at);const play=()=>{if(this.playing&&this.isOpen)element.play().catch(e=>this.status(t('render.audioBlocked'),'warning'));};if(at<0)this.musicStartTimer=setTimeout(play,-at*1000);else play();return;}
    if (!this.audioBuffer) { this.applyAudioVolume(); return; }
    try {
      const source = context.createBufferSource();
      source.buffer = this.audioBuffer;
      source.connect(this.musicGain);
      this.applyAudioVolume();
      // 音乐位置 = 谱面时间 + 偏移，与离线混音保持一致。
      // 偏移可以在面板里改；没改时 effectiveOffset() 就是谱面自己的 META.offset。
      const position = (this.range?.start ?? 0) + this.previewTime + this.effectiveOffset() / 1000;
      if (position >= this.audioBuffer.duration) return;
      // 偏移把音乐起点推到 0 之前时，延迟 -position 秒再从头播；clamp 成 0 会整体错开。
      if (position < 0) source.start(context.currentTime - position, 0);
      else source.start(0, position);
      this.musicSource = source;
    } catch (error) { this.failPreview(error); }
  }

  stopAudio() {
    clearTimeout(this.musicStartTimer); this.musicElement?.pause();
    if (this.musicSource) {
      try { this.musicSource.stop(); } catch { /* 已停止 */ }
      try { this.musicSource.disconnect(); } catch { /* 忽略 */ }
      this.musicSource = null;
    }
  }

  /** 打击音效：只补播当前时刻这一小段，跳转后按新位置重新对齐游标。 */
  seekHitCursor() { this.hitScheduleAt=null;this.stopHitVoices(); }

  stopHitVoices() {
    if (!this.hitVoices) return;
    for (const source of this.hitVoices) { try { source.stop(); } catch { /* 已停止 */ } }
    this.hitVoices.clear();
  }

  /**
   * 打击音效排程：按 AudioContext 时间提前 0.25s 预约，而不是「这一帧到了才播」。
   * 后者最多少响 1~2 帧（16~33ms），换皮肤后音效表重新解码时还会再抖一下，
   * 听起来就是「打击音延迟好高」。
   */
  async scheduleHits() {
    if(!this.playing||this.settings.hitSounds===false||!this.previewHitTrack||this.audioContext?.state!=='running')return;
    const context=this.audioContext,anchor=this.audioAnchor,generation=this.frameGeneration;
    const chartNow=anchor.chartSeconds+context.currentTime-anchor.contextTime;
    if(this.hitScheduleAt===null||this.hitScheduleAt===undefined||this.hitScheduleAt<chartNow-.05)this.hitScheduleAt=chartNow;
    const end=(this.range?.start??0)+this.duration;
    while(this.hitScheduleAt<Math.min(end,chartNow+.3)){
      const start=this.hitScheduleAt,frames=Math.max(1,Math.min(Math.round(.2*context.sampleRate),Math.round((end-start)*context.sampleRate)));
      const data=await this.previewHitTrack.read(start,frames);
      if(generation!==this.frameGeneration||!this.playing)return;
      const buffer=context.createBuffer(2,frames,context.sampleRate);buffer.copyToChannel(data.subarray(0,frames),0);buffer.copyToChannel(data.subarray(frames),1);
      const source=context.createBufferSource();source.buffer=buffer;source.connect(this.hitGain);source.onended=()=>{this.hitVoices.delete(source);source.disconnect();};
      source.start(Math.max(context.currentTime,anchor.contextTime+start-anchor.chartSeconds));this.hitVoices.add(source);this.hitScheduleAt=start+frames/context.sampleRate;
    }
  }

  applyAudioVolume() {
    const volume = value => Math.max(0, Math.min(1, Number(value) || 0));
    if (this.musicGain) this.musicGain.gain.value = volume(this.settings.musicVolume);
    if (this.hitGain) this.hitGain.gain.value = volume(this.settings.hitVolume);
  }

  play() {
    if (!this.scene || this.rendering) return;
    if(this.previewTime>=this.duration){this.previewTime=0;this.scene.reset();}
    this.playing = true;
    if (this.playButton) this.playButton.textContent = t('render.ui.8d12fc0d4');
    this.lastFrame = performance.now();
    this.startAudio();
    // 用代次标记：只有最新一代的循环能续帧，避免 play() 与上一帧结尾的
    // requestAnimationFrame 撞在一起跑出两条循环（时间走两倍 = 进度条抽搐）。
    const generation = this.frameGeneration = (this.frameGeneration ?? 0) + 1;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(now => this.tick(now, generation));
  }

  pause() {
    this.playing = false;
    this.frameGeneration = (this.frameGeneration ?? 0) + 1;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.stopAudio();
    this.stopHitVoices();
    if (this.playButton) this.playButton.textContent = t('render.ui.c3396195e');
  }

  async tick(now, generation) {
    if (generation !== this.frameGeneration || !this.isOpen || !this.playing) return;
    try {
      // 和编辑器 platform/audio.js 的 time 一样：用 AudioContext 时钟当锚点推进，
      // 而不是把每帧的 rAF 增量累加起来。差一帧就差一点，几十秒后音乐和谱面会明显错开，
      // 进度条也会因为增量抖动来回跳。
      const anchor = this.audioAnchor;
      const context = this.audioContext;
      if (anchor && context && context.state === 'running') {
        this.previewTime = (anchor.chartSeconds - (this.range?.start ?? 0)) + (context.currentTime - anchor.contextTime);
      } else if (!context) {
        this.previewTime += Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
      } else if (!this.audioWaiting) {
        this.audioWaiting=true;this.status(t('render.audioBlocked'),'warning');
      }
      if(context?.state==='running'&&this.audioWaiting){this.audioWaiting=false;this.status('');}
      this.lastFrame = now;
      if (this.previewTime >= this.duration) {
        if (this.settings.loop) { this.previewTime %= this.duration; this.previewHitTrack=createRenderAudioTrack(this.project,{...this.settings,start:0,musicVolume:0,hitVolume:1,offset:0,sampleRate:this.audioContext.sampleRate},this.hitBuffers,this.loadAbort?.signal); this.startAudio(); }
        else { this.previewTime = this.duration; this.pause(); await this.renderCurrent(); return; }
      }
      this.renderCurrent();
      await this.scheduleHits();
    } catch (error) {
      // 单帧出错不能让循环断掉（换皮肤、丢贴图时最容易碰到），否则整个面板看起来就像卡死。
      if(error.name!=='AbortError')this.failPreview(error); return;
    }
    if (generation === this.frameGeneration && this.playing) this.raf = requestAnimationFrame(next => this.tick(next, generation));
  }

  /** 把一帧合成结果贴到左侧预览画布（预览和渲染中的实时画面共用）。 */
  blitFrame(canvas) {
    if (!this.display || !canvas) return;
    const maxPreview = 1920;
    const scale = Math.min(1, maxPreview / canvas.width);
    const width = Math.max(2, Math.round(canvas.width * scale));
    const height = Math.max(2, Math.round(canvas.height * scale));
    if (this.display.width !== width || this.display.height !== height) { this.display.width = width; this.display.height = height; }
    const context = this.display.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(canvas, 0, 0, width, height);
  }

  failPreview(error) { this.pause(); this.status(error.message,'error'); this.api.notify(error.message,'error'); }
  async renderCurrent() {
    // 编码期间绝不能插入预览帧：它用一个跳跃的时间去 render，会把打击粒子的时间
    // 窗口（effectsSince）重置掉 —— 用户拖动进度条时看到的「粒子突然消失」就是这个。
    // 渲染中的左侧画面由 paintEncodedFrame() 从编码帧同步过去，不走这里。
    if (this.rendering || !this.scene || !this.range) return;
    const scene=this.scene,generation=this.generation,time=this.range.start+this.previewTime;
    if(this.previewDrawing?.scene===scene){this.previewDrawing.pending=time;return this.previewDrawing.promise;}
    const state={scene,pending:time};this.previewDrawing=state;
    state.promise=(async()=>{
      try {
        while(state.pending!==null&&this.previewDrawing===state){
          const next=state.pending;state.pending=null;
          const canvas=await scene.frame(next,{hud:true,signal:this.loadAbort?.signal});
          if(scene!==this.scene||generation!==this.generation||this.rendering)return;
          if(state.pending===null){this.blitFrame(canvas);this.updateTime();}
        }
      }catch(error){if(error.name!=='AbortError'&&this.isOpen&&generation===this.generation)this.failPreview(error);}
      finally{if(this.previewDrawing===state)this.previewDrawing=null;}
    })();
    return state.promise;
  }

  /**
   * 渲染中：把刚编码的这一帧显示到左侧，进度条按渲染进度走。
   * 进度条在渲染期间是 disabled 的，所以这里直接写 value 不会被用户拖动干扰；
   * 文字用「已渲染 / 总时长」，让用户知道走的是渲染而不是播放。
   */
  paintEncodedFrame(canvas, time, index, frames, duration) {
    this.blitFrame(canvas);
    const progress = frames > 0 ? clamp((index + 1) / frames, 0, 1) : 0;
    const rendered = Math.min(duration, (index + 1) * (duration / Math.max(1, frames)));
    if (this.seek) this.seek.value = String(clamp(progress, 0, 1) * this.duration);
    if (this.time) {
      this.time.textContent = t('render.ui.cc5296a10') + formatDuration(Math.min(rendered, duration), this.settings.fps)
        + ' / ' + formatDuration(duration, this.settings.fps);
    }
  }

  updateTime() {
    if (this.seek && !this.seeking) {
      // 按 step=0.01 取整后只在真的变了才写：每帧无条件赋值会让滑杆
      // 在同一个像素上来回抖（尤其是 120Hz 屏上），看起来像在抽搐。
      const next = Math.round(this.previewTime * 100) / 100;
      if (Number(this.seek.value) !== next) this.seek.value = String(next);
    }
    if (this.time) this.time.textContent = formatDuration(this.previewTime, this.settings.fps) + ' / ' + formatDuration(this.duration, this.settings.fps);
  }

  refreshSummary() {
    if (!this.summary || !this.project) return;
    this.syncRange();
    const bytes = estimateBytes(this.settings, this.duration);
    const capability = this.capability;
    const name = this.outputName();
    this.summary.textContent = t('render.ui.71e3dc114',{p0:(formatLabel(this.settings.format)),p1:(this.settings.width),p2:(this.settings.height),p3:(this.settings.fps),p4:(formatDuration(this.duration, this.settings.fps)),p5:(formatBytes(bytes)),p6:(safeFileName(name)),p7:(fileExtension(this.settings.format))});
    this.projectNode.textContent = `${this.project.title} · ${this.settings.width}×${this.settings.height} · ${this.settings.fps} fps`;
    if (capability && this.capabilities) {
      const video = Object.entries(this.capabilities.video).filter(([, ok]) => ok).map(([codec]) => VIDEO_CODEC_LABELS[codec] ?? codec);
      const audio = Object.entries(this.capabilities.audio).filter(([, ok]) => ok).map(([codec]) => AUDIO_CODEC_LABELS[codec] ?? codec);
      capability.textContent = t('render.ui.88e8c2da9',{p0:(video.length ? video.join(' / ') : t('render.noVideo')),p1:(audio.length ? ' · ' + audio.join(' / ') : ' · '+t('render.noAudio'))});
    }
  }

  async probe() {
    const generation=this.probeGeneration=(this.probeGeneration??0)+1;
    if (!this.capability) return;
    try {
      const capabilities=await probeCodecs(this.settings);
      if(generation!==this.probeGeneration||!this.isOpen)return;
      this.capabilities=capabilities;
      this.refreshSummary();
    } catch (error) {
      this.capabilities = null;
      this.capability.textContent = t('render.ui.6d88434b1') + (error?.message ?? error);
    }
  }

  outputName() {
    const date = new Date();
    const stamped = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return String(this.settings.fileName || '{name} - Autoplay')
      .replaceAll('{name}', this.project?.title ?? 'chart')
      .replaceAll('{date}', stamped);
  }

  /**
   * 渲染期间锁住进度条与播放按钮。拖动进度条会插入一次跳跃的预览渲染，
   * 既打断逐帧编码的连续性（粒子窗口被重置），也可能让音频和画面错位。
   * 桌面和 APP 用的是同一个面板，这一处即双端生效。
   */
  setSeekLocked(locked) {
    if (this.seek) {
      this.seek.disabled = locked;
      this.seek.classList.toggle('rpas-seek-locked', locked);
      this.seek.title = locked ? t('render.ui.b719897dd') : '';
    }
    if (this.playButton) this.playButton.disabled = locked;
    if (this.display) this.display.classList.toggle('rpas-display-locked', locked);
  }

  setProgress(progress, message = '') {
    this.progress.hidden = progress == null;
    if (progress != null) this.progress.value = clamp(progress, 0, 1);
    this.progressText.textContent = message;
  }

  async render() {
    if(!this.scene||this.rendering)return;
    this.pause();this.rendering=true;this.closeRequested=false;
    this.syncResultActions();
    const controller=this.abort=new AbortController(),signal=controller.signal;
    const cancelFromClose=()=>controller.abort();this.loadAbort?.signal.addEventListener('abort',cancelFromClose,{once:true});
    this.root.classList.add('rpas-rendering');this.settingsHost.inert=true;
    for(const control of this.controls.values())control.input.disabled=true;
    this.setSeekLocked(true);this.renderButton.hidden=true;this.cancelButton.hidden=false;
    const {start,end}=this.effectiveRange();
    const settings=Object.freeze({...this.settings,start,end,offset:this.effectiveOffset()});
    let output,scene;
    try {
      // The picker is invoked before an asynchronous preparation loses the user gesture.
      if(settings.width*settings.height*4*8>512*1024**2)throw Error(t('render.frameBudget'));
      if(settings.musicVolume>0&&this.project.musicError)throw this.project.musicError;
      output=await createVideoOutput(safeFileName(this.outputName())+'.'+fileExtension(settings.format),fileMime(settings.format),{signal,expectedBytes:estimateBytes(settings,end-start)});
      if(!output){this.status(t('render.saveCancelled'));return;}
      this.lastResult?.dispose?.();this.lastResult=null;this.syncResultActions();
      this.status(t('render.preparing'));this.setProgress(0,t('render.preparing'));
      scene=new AutoplayScene(this.project,settings,{purpose:'export',signal,overlays:this.api.drawOverlays});
      await renderAwait(scene.init(this.skins.get(settings.noteSkin)??null),signal);
      checkRenderAbort(signal);scene.reset();
      const hits=settings.hitSounds?await loadHitBuffers({assets:this.project.assets,chartName:this.project.chartName,noteSkinRecord:this.skins.get(settings.noteSkin),sampleRate:settings.sampleRate,signal,names:this.project.hitSoundNames}):new Map();
      const audioTrack=createRenderAudioTrack(this.project,settings,hits,signal);
      const result=await encodeVideo({canvas:scene.output,audioTrack,settings,duration:end-start,signal,stream:output,
        drawFrame:(time,_index,_frames,frameSignal)=>scene.frame(start+time,{hud:true,signal:frameSignal}),
        onFrame:({canvas,time,index,frames,duration})=>this.paintEncodedFrame(canvas,time,index,frames,duration),
        report:message=>this.status(message),onProgress:({frame,frames,progress,videoCodec,audioCodec})=>{this.setProgress(progress,t('render.encoding',{frame,frames,video:VIDEO_CODEC_LABELS[videoCodec]??videoCodec,audio:audioCodec?AUDIO_CODEC_LABELS[audioCodec]??audioCodec:t('render.silent')}));}
      });
      checkRenderAbort(signal);const saved=await output.commit();this.lastResult={...saved,extension:result.extension};
      const message=saved.status==='saved'?t('render.saved',{name:saved.path??saved.name}):t('render.downloadStarted',{name:saved.name});
      this.setProgress(1,message);this.status(message,'success');this.api.notify(message,'success');
    }catch(error){await output?.abort().catch(()=>{});if(error.name==='AbortError'){this.setProgress(null,t('render.cancelled'));this.status(t('render.cancelled'));}else{this.setProgress(null,t('render.failed'));this.status(error.message,'error');this.api.notify(error.message,'error');}}
    finally {
      this.loadAbort?.signal.removeEventListener('abort',cancelFromClose);
      scene?.dispose();this.rendering=false;this.abort=null;this.settingsHost.inert=false;
      for(const control of this.controls.values())control.input.disabled=false;
      this.setSeekLocked(false);this.root?.classList.remove('rpas-rendering');
      if(this.closeRequested){this.closeRequested=false;this.close();return;}
      this.renderButton.hidden=false;this.cancelButton.hidden=true;this.syncResultActions();
      this.scene?.reset();void this.renderCurrent();
    }
  }
  async downloadLast(){if(this.lastResult?.file){const {videoDownload}=await import('../../platform/video-output.mjs');videoDownload(this.lastResult.file,this.lastResult.name);}}

  syncResultActions() {
    this.downloadButton.hidden=this.rendering||!this.lastResult?.file;
    this.openFolderButton.hidden=this.rendering||typeof this.lastResult?.openFolder!=='function';
    this.openFolderButton.disabled=Boolean(this.openingFolder);
  }

  async openFolderLast() {
    const result=this.lastResult;
    if(this.rendering||this.openingFolder||typeof result?.openFolder!=='function')return;
    this.openingFolder=true;this.syncResultActions();
    try { await result.openFolder(); }
    catch(error) {
      const message=t('render.openFolderFailed',{reason:error?.message??String(error)});
      if(this.isOpen&&this.lastResult===result)this.status(message,'error');
      this.api.notify(message,'error');
    } finally {this.openingFolder=false;this.syncResultActions();}
  }

  close() {
    if (!this.isOpen) return;
    if (this.rendering) {
      this.closeRequested = true;
      this.abort?.abort();
      this.status(t('render.ui.2420d14da'), 'warning');
      return;
    }
    this.isOpen = false; this.opening=false;
    this.generation=(this.generation??0)+1;this.loadAbort?.abort();
    this.probeGeneration=(this.probeGeneration??0)+1;this.hitsGeneration=(this.hitsGeneration??0)+1;
    this.pause();
    this.stopAudio();
    this.stopHitVoices();
    try { this.audioContext?.close?.(); } catch { /* 忽略 */ }
    this.audioContext = null; this.musicGain = null; this.hitGain = null; this.audioBuffer = null;
    this.hitBuffers = new Map(); this.hitEntries = []; this.hitCursor = 0;
    clearTimeout(this.saveTimer);
    try { this.api.storage.write({ ...this.api.storage.read({}), [STORAGE_KEY]: this.settings }); } catch { /* 忽略 */ }
    this.scene?.dispose?.();
    this.scene = null;
    this.project?.dispose?.();this.project=null;this.previewHitTrack=null;this.hitRequest=null;
    this.elementSource?.disconnect();this.elementSource=null;this.musicElement=null;disposeDecodeContext();
    this.releaseLock();
    this.root?.remove();
    this.root = null;
    document.documentElement.classList.remove('rpen-render-active');
    this.lastResult?.dispose?.();this.lastResult = null;this.controls.clear();
    // 打开时为了不出现两份音频而暂停了制谱器，关掉后把它接回去。
    if (this.editorWasPlaying) {
      this.editorWasPlaying = false;
      try { if(this.api.editor?.hasDocument&&!this.api.editor?.home&&this.api.editor.session===this.sourceSession&&this.api.editor.chart===this.sourceChart)this.api.editor?.play?.()?.catch?.(e=>this.api.notify(e.message,'error')); } catch (error) { console.warn(t('render.ui.b18d53996'), error); }
    }
  }

  /**
   * Restore the editor's original inert state and focus exactly once.
   */
  releaseLock() {
    const unlock = this.unlock;
    this.unlock = null;
    if (typeof unlock === 'function') { try { unlock(); } catch (error) { console.warn(t('render.ui.b71a2e56b'), error); } }
  }
}
