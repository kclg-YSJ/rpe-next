import { beatValue, formatBeat, fromNumber, parseBeat } from '../core/beat.mjs';
import { NOISE_REVEALS } from '../core/noise-fit.mjs';
import { noiseLayers } from '../core/noise-skin.mjs';
import { previewViewport, previewPositionScale } from '../core/editor-display.mjs';
import { fittedNoiseAreas, noiseFitChart } from '../application/noise-fit.mjs';
import { beatInputControl } from './beat-input.mjs';
import { createEasingPicker, EASING_NAMES } from './easing-picker.mjs';
import { prepareCanvas } from './timeline.mjs';
import { editorSkinContext } from './editor-skin-canvas.mjs';
import { t } from '../i18n.mjs';

const button = (text, run) => { const element = document.createElement('button'); element.type = 'button'; element.textContent = text; element.onclick = run; return element; };
const limited = (value, low, high) => Math.max(low, Math.min(high, value));

export class NoiseFitPanel {
  constructor(host, stage, getContext, { activate, invalidate, notify, pause }) {
    Object.assign(this, { host, stage, getContext, activate, invalidate, notify, pause });
    this.options = { mode: 'text', text: 'RPE', font: 'sans-serif', spacing: 1.2, precision: 128, threshold: 128, polarity: 'dark', invertImage: false, trim: true, merge: true, maxSpan: 12,
      width: 900, x: 0, y: 0, rotation: 0, first: '0:0/1', last: '0:0/1', duration: '4:0/1', easingType: 1, reveal: 'left', seed: 1,
      active: true, activeStart: '0:0/1', activeEnd: '4:0/1', readyFlash: 0.5, layerId: 'default', invert: false, name: '', show: true, animate: true };
    this.fonts = new Map(['sans-serif', 'Microsoft YaHei', 'Arial', 'Times New Roman', 'Segoe UI Emoji', 'RPEGame'].map(name => [name, name]));
    this.generation = 0; this.imageGeneration = 0; this.progress = 0.5; this.lastLinked = true; this.activeLinked = true; this.easingState = { open: false };
    this.overlay = document.createElement('canvas'); this.overlay.className = 'noise-fit-overlay'; this.overlay.hidden = true;
    this.overlay.setAttribute('aria-label', t('noise-fit.s1358840')); stage.append(this.overlay);
    this.overlay.onpointerdown = event => this.down(event);
    this.overlay.onpointermove = event => this.move(event);
    this.overlay.onpointerup = event => this.endDrag(event);
    this.overlay.onpointercancel = event => this.endDrag(event);
    this.overlay.oncontextmenu = event => event.preventDefault();
    this.overlay.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); this.scaleLayout(this.options.width * Math.exp(-event.deltaY * 0.001)); }, { passive: false });
    this.render();
  }

  open() {
    this.pause(); const context = this.getContext(); this.owner = context.session;
    this.options.first = formatBeat(fromNumber(context.tempo.beat(context.seconds())));
    if (this.lastLinked) this.options.last = this.options.first;
    if (!noiseLayers(context.session.chart).some(layer => layer.id === this.options.layerId)) this.options.layerId = noiseLayers(context.session.chart)[0].id;
    this.active = true; this.stage.closest('.editor').classList.add('noise-fit-mode'); this.render(); this.activate('noise-fit'); this.refresh();
  }

  hide() {
    this.active = false; this.cancel(); this.previewChart = null; this.overlay.hidden = true; this.drag = null;
    if (this.dragFrame) cancelAnimationFrame(this.dragFrame); this.dragFrame = null;
    this.stage.closest('.editor').classList.remove('noise-fit-mode'); this.invalidate();
  }

  reset() { this.hide(); this.bitmap?.close(); this.bitmap = null; this.imageName = ''; this.fit = null; this.owner = null; this.imageGeneration++; }
  cancel() { this.generation++; clearTimeout(this.timer); this.worker?.terminate(); this.worker = null; }
  action(action) {
    if (!this.active) return false;
    if (action === 'Esc') { this.activate('chart'); return true; }
    return ['SelectAll', 'Copy', 'Shear', 'Paste', 'PasteMirror', 'KeepTimePaste', 'KeepTimePasteMirror', 'ClipboardHistory', 'NumberMirror', 'NumberFill', 'Delete', 'QuickDelete', 'ToggleMultiLine', 'SwitchMultiLineMode', 'SwitchUI', 'CurveBegin', 'CurveEnd', 'AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action) || Boolean(action?.startsWith('Page'));
  }

  field(parent, key, title, { type = 'number', choices, min, max, step = 'any', beat = false, refit = false } = {}) {
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    const input = document.createElement(choices ? 'select' : 'input'); input.setAttribute('aria-label', title); input.dataset.key = key;
    if (choices) input.replaceChildren(...choices.map(([value, text]) => new Option(text, value)));
    else { input.type = beat ? 'text' : type; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; input.step = step; }
    if (type === 'checkbox') input.checked = this.options[key]; else input.value = this.options[key];
    const update = () => {
      this.options[key] = type === 'checkbox' ? input.checked : choices || beat || type === 'text' ? input.value : input.value.trim() ? Number(input.value) : NaN;
      if (key === 'easingType') this.options[key] = Number(input.value);
      if (key === 'first' && this.lastLinked) { this.options.last = input.value; this.controls.get('last').value = input.value; }
      if (key === 'last') this.lastLinked = false;
      if (key === 'activeStart' || key === 'activeEnd') this.activeLinked = false;
      if (key === 'duration' && this.activeLinked) { this.options.activeEnd = input.value; this.controls.get('activeEnd').value = input.value; }
      if (key === 'active' && input.checked) this.fullActivation();
      if (key === 'animate') { this.fullPreview = false; this.animationEpoch = null; this.updatePlay(); }
      this.updateVisibility(); if (refit) this.refresh(); else this.rebuild();
    };
    input.oninput = update;
    if (beat) {
      label.append(beatInputControl(input, () => this.getContext().timeline.division, error => this.fail(error.message)));
      input.addEventListener('change', () => { try { input.value = formatBeat(parseBeat(input.value)); update(); } catch (error) { input.setAttribute('aria-invalid', 'true'); this.fail(error.message); } });
    } else label.append(input);
    parent.append(label); this.controls.set(key, input); return input;
  }

  render() {
    this.host.replaceChildren(); this.controls = new Map();
    this.scroll = document.createElement('div'); this.scroll.className = 'noise-fit-scroll'; this.host.append(this.scroll);
    const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = t('noise-fit.s9835372'); this.scroll.append(title);
    const modes = document.createElement('div'); modes.className = 'noise-fit-modes'; this.scroll.append(modes);
    for (const [mode, text] of [['text', t('noise-fit.sf4d3dab')], ['image', t('noise-fit.sbe8da62')]]) {
      const choice = button(text, () => { this.options.mode = mode; this.render(); this.refresh(); }); choice.classList.toggle('active', this.options.mode === mode); choice.setAttribute('aria-pressed', String(this.options.mode === mode)); modes.append(choice);
    }
    this.sourceCanvas = document.createElement('canvas'); this.sourceCanvas.width = 480; this.sourceCanvas.height = 180; this.sourceCanvas.className = 'noise-fit-source';
    this.sourceCanvas.setAttribute('aria-label', t('noise-fit.s3624824')); this.scroll.append(this.sourceCanvas);
    const source = document.createElement('div'); this.scroll.append(source);
    if (this.options.mode === 'text') {
      const text = document.createElement('textarea'); text.rows = 3; text.maxLength = 1000; text.value = this.options.text; text.setAttribute('aria-label', t('noise-fit.s09118cd'));
      text.oninput = () => { this.options.text = text.value; this.refresh(); }; source.append(text);
      this.field(source, 'font', t('noise-fit.sb50d4d8'), { choices: [...this.fonts], refit: true });
      const customFont = document.createElement('input'); customFont.type = 'file'; customFont.accept = '.ttf,.otf,.woff,.woff2'; customFont.hidden = true;
      customFont.setAttribute('aria-label', t('noise-fit.saa55f43'));
      customFont.onchange = () => this.loadFont(customFont.files[0]); source.append(button(t('noise-fit.s5b8a1ce'), () => customFont.click()), customFont);
      this.field(source, 'spacing', t('noise-fit.s514b541'), { min: 0.5, max: 4, step: 0.05, refit: true });
    } else {
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,image/avif'; file.hidden = true;
      file.setAttribute('aria-label', t('noise-fit.s08280ad')); file.onchange = () => this.loadImage(file.files[0]); source.append(button(t('noise-fit.sf40986d'), () => file.click()), file);
      const name = document.createElement('p'); name.className = 'hint'; name.textContent = this.imageName || t('noise-fit.s25e40e2'); source.append(name);
      this.field(source, 'polarity', t('noise-fit.s0e0a151'), { choices: [['dark', t('noise-fit.s0f7f96b')], ['light', t('noise-fit.sb84b26b')], ['alpha', t('noise-fit.s020899b')]], refit: true });
      this.field(source, 'invertImage', t('noise-fit.s8e0c890'), { type: 'checkbox', refit: true });
    }
    this.field(this.scroll, 'precision', t('noise-fit.s8844342'), { type: 'range', min: 16, max: 512, step: 1, refit: true });
    this.precisionValue = document.createElement('p'); this.precisionValue.className = 'hint'; this.scroll.append(this.precisionValue);
    this.field(this.scroll, 'threshold', t('noise-fit.s32c0bdc'), { type: 'range', min: 1, max: 254, step: 1, refit: true });
    this.field(this.scroll, 'merge', t('noise-fit.s9cce970'), { type: 'checkbox', refit: true });
    this.field(this.scroll, 'maxSpan', t('noise-fit.sb7bfaeb'), { min: 1, max: 512, step: 1, refit: true });
    this.field(this.scroll, 'trim', t('noise-fit.s31fb756'), { type: 'checkbox', refit: true });
    this.heading(t('noise-fit.sb0961e1'));
    this.field(this.scroll, 'width', t('noise-fit.s3071ee0'), { min: 1, max: 20000 });
    this.field(this.scroll, 'x', t('noise-fit.s902ce65')); this.field(this.scroll, 'y', t('noise-fit.s97b96fe')); this.field(this.scroll, 'rotation', t('noise-fit.sd555d09'));
    this.scroll.append(button(t('noise-fit.s30ee1a6'), () => {
      this.options.x = this.options.y = this.options.rotation = 0;
      this.options.width = this.fit ? Math.min(1100, 700 * this.fit.width / this.fit.height) : 900;
      this.syncControls(['x', 'y', 'width', 'rotation']); this.rebuild();
    }));
    this.field(this.scroll, 'layerId', t('noise-fit.s660dfdf'), { choices: noiseLayers(this.getContext().session.chart).map(layer => [layer.id, layer.name]) });
    this.field(this.scroll, 'name', t('noise-fit.sdd4f174'), { type: 'text' }); this.field(this.scroll, 'invert', t('noise-fit.s1bd19ee'), { type: 'checkbox' });
    this.heading(t('noise-fit.s58df1a9'));
    this.field(this.scroll, 'first', t('noise-fit.sa3c43dd'), { beat: true });
    this.field(this.scroll, 'last', t('noise-fit.s173b4c0'), { beat: true });
    this.scroll.append(button(t('noise-fit.s7539ce7'), () => { this.lastLinked = true; this.options.last = this.options.first; this.syncControls(['last']); this.rebuild(); }));
    this.field(this.scroll, 'duration', t('noise-fit.sc4f8d6f'), { beat: true });
    this.field(this.scroll, 'reveal', t('noise-fit.sac7b420'), { choices: NOISE_REVEALS });
    this.field(this.scroll, 'easingType', t('noise-fit.sa629734'), { choices: EASING_NAMES.map((name, index) => [index + 1, `${index + 1} · ${name}`]) });
    const picker = createEasingPicker(Number(this.options.easingType), value => { this.options.easingType = value; this.syncControls(['easingType']); this.rebuild(); }, this.easingState); this.scroll.append(picker.element);
    this.field(this.scroll, 'seed', t('noise-fit.sed73926'), { min: 0, max: 4294967295, step: 1 });
    this.scroll.append(button(t('noise-fit.sed73926'), () => { this.options.seed = crypto.getRandomValues(new Uint32Array(1))[0]; this.syncControls(['seed']); this.rebuild(); }));
    this.heading(t('noise-fit.s4c25820'));
    this.field(this.scroll, 'active', t('noise-fit.sbc5a4e1'), { type: 'checkbox' });
    this.field(this.scroll, 'activeStart', t('noise-fit.s5c123f9'), { beat: true }); this.field(this.scroll, 'activeEnd', t('noise-fit.s0e93a7f'), { beat: true });
    this.field(this.scroll, 'readyFlash', t('noise-fit.s0c9f597'), { min: 0, max: 600, step: 0.001 });
    this.scroll.append(button(t('noise-fit.s5cfdf1e'), () => { this.fullActivation(); this.rebuild(); }));
    this.heading(t('noise-fit.sf95aacf'));
    this.field(this.scroll, 'show', t('noise-fit.s658d908'), { type: 'checkbox' });
    this.playButton = button(this.options.animate ? t('noise-fit.s41852e3') : t('noise-fit.s1d50e9d'), () => { this.fullPreview = false; this.options.animate = !this.options.animate; this.animationEpoch = null; this.updatePlay(); this.invalidate(); });
    this.progressInput = document.createElement('input'); this.progressInput.type = 'range'; this.progressInput.min = 0; this.progressInput.max = 1; this.progressInput.step = 0.001;
    this.progressInput.value = this.progress; this.progressInput.setAttribute('aria-label', t('noise-fit.s87e8387'));
    this.progressInput.oninput = () => { this.fullPreview = false; this.options.animate = false; this.progress = Number(this.progressInput.value); this.animationEpoch = null; this.updatePlay(); this.invalidate(); };
    this.previewTime = document.createElement('output'); this.previewTime.className = 'hint';
    const playback = document.createElement('div'); playback.className = 'noise-fit-playback'; playback.append(this.playButton, this.progressInput, this.previewTime); this.scroll.append(playback);
    this.scroll.append(button(t('noise-fit.sc0ccad2'), () => { this.options.animate = false; this.progress = 0.5; this.fullPreview = true; this.updatePlay(); this.invalidate(); }));
    const help = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = t('noise-fit.s0e0472c');
    const description = document.createElement('p'); description.className = 'hint';
    description.textContent = t('noise-fit.sd39782e');
    help.append(summary, description); this.scroll.append(help);
    const footer = document.createElement('div'); footer.className = 'noise-fit-footer';
    this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status');
    this.count = document.createElement('strong'); this.count.setAttribute('aria-live', 'polite');
    this.applyButton = button(t('noise-fit.s6cbec60'), () => this.apply()); this.applyButton.className = 'primary'; this.applyButton.disabled = true;
    footer.append(this.count, this.message, button(t('noise-fit.sb3669b2'), () => this.activate('chart')), this.applyButton); this.host.append(footer); this.updateVisibility();
  }

  heading(text) { const heading = document.createElement('h3'); heading.textContent = text; this.scroll.append(heading); }
  syncControls(keys) { for (const key of keys) { const control = this.controls.get(key); if (control) control.value = this.options[key]; } }
  fullActivation() { this.activeLinked = true; this.options.activeStart = '0:0/1'; this.options.activeEnd = this.options.duration; this.syncControls(['activeStart', 'activeEnd']); }
  updatePlay() { if (this.playButton) this.playButton.textContent = this.options.animate ? t('noise-fit.s41852e3') : t('noise-fit.s1d50e9d'); }
  updateVisibility() {
    for (const key of ['activeStart', 'activeEnd', 'readyFlash']) if (this.controls.get(key)) this.controls.get(key).disabled = !this.options.active;
    if (this.controls.get('maxSpan')) this.controls.get('maxSpan').disabled = !this.options.merge;
    if (this.controls.get('seed')) this.controls.get('seed').closest('.field').hidden = this.options.reveal !== 'random';
    if (this.precisionValue) this.precisionValue.textContent = t('noise-fit.sc9514ab', { p0: this.options.precision, p1: this.options.threshold });
  }

  async loadFont(file) {
    if (!file) return;
    try {
      const name = 'NoiseFitFont' + this.fonts.size; const font = new FontFace(name, await file.arrayBuffer()); await font.load(); document.fonts.add(font);
      this.fonts.set(name, file.name); this.options.font = name;
      if (this.active) { this.render(); this.refresh(); }
    } catch (error) { this.fail(t('noise-fit.s0823434') + error.message); }
  }

  async loadImage(file) {
    if (!file) return; const generation = ++this.imageGeneration;
    try {
      const bitmap = await createImageBitmap(file);
      if (generation !== this.imageGeneration) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 64000000) { bitmap.close(); throw new Error(t('noise-fit.s51a96aa')); }
      this.bitmap?.close(); this.bitmap = bitmap; this.imageName = file.name;
      if (this.active) { this.render(); this.refresh(); }
    } catch (error) { if (generation === this.imageGeneration) this.fail(t('noise-fit.s0d557ab') + error.message); }
  }

  fail(message) { this.previewChart = null; this.areas = null; this.applyButton.disabled = true; this.message.textContent = message; this.message.classList.add('error'); this.overlay.hidden = true; this.invalidate(); }
  refresh() {
    this.cancel(); this.fit = null; this.previewChart = null; this.areas = null; this.applyButton.disabled = true; this.count.textContent = t('noise-fit.s7011734'); this.message.textContent = t('noise-fit.s98445c4'); this.message.classList.remove('error'); this.overlay.hidden = true; this.invalidate();
    if (!this.active) return; const generation = this.generation;
    this.timer = setTimeout(() => this.calculate(generation).catch(error => { if (generation === this.generation) this.fail(error.message); }), 130);
  }

  async rasterize() {
    const { precision, mode, text, font, spacing } = this.options;
    if (!Number.isInteger(precision) || precision < 16 || precision > 512) throw new Error(t('noise-fit.s0436b66'));
    const raster = document.createElement('canvas'); const context = raster.getContext('2d', { willReadFrequently: true });
    if (mode === 'image') {
      if (!this.bitmap) throw new Error(t('noise-fit.s29a36bd'));
      const scale = precision / Math.max(this.bitmap.width, this.bitmap.height);
      raster.width = Math.max(1, Math.round(this.bitmap.width * scale)); raster.height = Math.max(1, Math.round(this.bitmap.height * scale));
      context.drawImage(this.bitmap, 0, 0, raster.width, raster.height);
    } else {
      if (!text.trim()) throw new Error(t('noise-fit.s95e693e'));
      const lines = text.split(/\r?\n/); if (lines.length > 16 || text.length > 1000) throw new Error(t('noise-fit.s6c053ff'));
      if (!Number.isFinite(spacing) || spacing < 0.5 || spacing > 4) throw new Error(t('noise-fit.s9624a79'));
      await document.fonts.load(`96px "${font}"`, text);
      context.font = `96px "${font}", sans-serif`; const metrics = lines.map(line => context.measureText(line));
      const ascent = Math.max(1, ...metrics.map(metric => metric.actualBoundingBoxAscent || 72)); const descent = Math.max(1, ...metrics.map(metric => metric.actualBoundingBoxDescent || 18));
      const naturalWidth = Math.max(1, ...metrics.map(metric => Math.max(metric.width, metric.actualBoundingBoxLeft + metric.actualBoundingBoxRight)));
      const lineHeight = (ascent + descent) * spacing; const naturalHeight = ascent + descent + lineHeight * (lines.length - 1);
      const scale = (precision - 4) / Math.max(naturalWidth, naturalHeight);
      raster.width = Math.min(512, Math.max(1, Math.ceil(naturalWidth * scale) + 4)); raster.height = Math.min(512, Math.max(1, Math.ceil(naturalHeight * scale) + 4));
      context.font = `${96 * scale}px "${font}", sans-serif`; context.fillStyle = '#fff'; context.textBaseline = 'alphabetic';
      lines.forEach((line, index) => context.fillText(line, (raster.width - metrics[index].width * scale) / 2, 2 + (ascent + index * lineHeight) * scale));
    }
    return { pixels: context.getImageData(0, 0, raster.width, raster.height).data, width: raster.width, height: raster.height };
  }

  async calculate(generation) {
    const raster = await this.rasterize(); if (generation !== this.generation || !this.active) return;
    const worker = new Worker(new URL('../core/noise-fit-worker.mjs', import.meta.url), { type: 'module' }); this.worker = worker;
    worker.onerror = () => { if (generation === this.generation) { this.cancel(); this.fail(t('noise-fit.s3b85eed')); } };
    worker.onmessage = ({ data }) => {
      worker.terminate(); if (this.worker === worker) this.worker = null;
      if (generation !== this.generation || !this.active) return;
      if (data.error) { this.fail(data.error); return; }
      this.fit = data.result; this.drawSource(); this.rebuild();
    };
    worker.postMessage({ ...raster, options: { threshold: this.options.threshold, polarity: this.options.mode === 'text' ? 'alpha' : this.options.polarity, invert: this.options.mode === 'image' && this.options.invertImage, maxSpan: this.options.merge ? this.options.maxSpan : 1, merge: this.options.merge, trim: this.options.trim } }, [raster.pixels.buffer]);
  }

  values() {
    for (const control of this.controls.values()) control.removeAttribute('aria-invalid');
    const values = { ...this.options };
    for (const key of ['first', 'last', 'duration', ...(values.active ? ['activeStart', 'activeEnd'] : [])]) {
      try { values[key] = beatValue(parseBeat(values[key])); }
      catch (error) { this.controls.get(key)?.setAttribute('aria-invalid', 'true'); throw error; }
    }
    values.easingType = Number(values.easingType);
    if (!values.active) values.readyFlash = 0;
    if (!Number.isInteger(values.seed) || values.seed < 0 || values.seed > 4294967295) throw new Error(t('noise-fit.s55e4d0c'));
    return values;
  }

  rebuild() {
    this.fullPreview = false;
    if (!this.active || !this.fit) return;
    const { session } = this.getContext();
    this.baseChart = session.chart;
    try {
      const values = this.values(); this.areas = fittedNoiseAreas(this.fit, values);
      this.previewChart = noiseFitChart(session.chart, this.areas);
      this.fullChart = null;
      this.timing = values; this.animationEpoch = null; this.count.textContent = t('noise-fit.s8256364', { p0: this.areas.length });
      this.message.textContent = t('noise-fit.s6350d4f', { p0: this.fit.width, p1: this.fit.height, p2: this.fit.pixels });
      this.message.classList.remove('error'); this.applyButton.disabled = false; this.applyButton.textContent = t('noise-fit.sbda110c', { p0: this.areas.length }); this.invalidate();
    } catch (error) { this.count.textContent = t('noise-fit.se7ee071', { p0: this.fit.rectangles.length }); this.fail(error.message); }
  }

  sync() {
    if (!this.active) return;
    if (this.owner !== this.getContext().session) { this.reset(); return; }
    const layers = noiseLayers(this.getContext().session.chart); const control = this.controls.get('layerId');
    const signature = JSON.stringify(layers.map(layer => [layer.id, layer.name]));
    if (signature !== this.layerSignature) { this.layerSignature = signature; control.replaceChildren(...layers.map(layer => new Option(layer.name, layer.id))); control.value = this.options.layerId; }
    if (this.fit && this.baseChart !== this.getContext().session.chart) this.rebuild();
  }

  drawSource() {
    const context = editorSkinContext(this.sourceCanvas.getContext('2d')); context.fillStyle = '#191e27'; context.fillRect(0, 0, 480, 180);
    if (!this.fit) return; const scale = Math.min(456 / this.fit.width, 156 / this.fit.height);
    const left = (480 - this.fit.width * scale) / 2; const top = (180 - this.fit.height * scale) / 2;
    for (const rectangle of this.fit.rectangles) {
      context.fillStyle = '#d07474'; context.fillRect(left + rectangle.x * scale, top + rectangle.y * scale, rectangle.width * scale, rectangle.height * scale);
      if (rectangle.width * scale > 3 && rectangle.height * scale > 3) { context.strokeStyle = '#f3bbbb55'; context.lineWidth = 0.5; context.strokeRect(left + rectangle.x * scale, top + rectangle.y * scale, rectangle.width * scale, rectangle.height * scale); }
    }
  }

  tick(timestamp, seconds, playing, renderer) {
    this.sync();
    if (!this.active || !this.options.show || !this.previewChart) { this.overlay.hidden = true; return null; }
    const { tempo } = this.getContext(); const begin = tempo.seconds(this.timing.first); const end = tempo.seconds(this.timing.last + this.timing.duration);
    if (this.animationEpoch === null || this.animationEpoch === undefined) this.animationEpoch = timestamp - this.progress * (end - begin) * 1000;
    if (this.options.animate && !playing && !this.fullPreview) this.progress = ((timestamp - this.animationEpoch) / 1000 % (end - begin + 0.5)) / (end - begin);
    let viewSeconds = playing ? seconds : this.fullPreview ? tempo.seconds(this.timing.last) : begin + Math.min(1, this.progress) * (end - begin);
    if (this.fullPreview && this.timing.first === this.timing.last) viewSeconds += Math.min(0.001, (end - begin) / 2);
    this.progressInput.value = Math.min(1, this.progress); this.previewTime.textContent = this.fullPreview ? t('noise-fit.se3a491e') : t('noise-fit.s8468a30', { p0: formatBeat(fromNumber(tempo.beat(viewSeconds))) });
    this.drawLayout(renderer);
    if (this.fullPreview) {
      this.fullChart ??= noiseFitChart(this.baseChart, this.areas.map(area => ({ ...area, appearTime: fromNumber(this.timing.first), disappearTime: fromNumber(this.timing.last + this.timing.duration),
        activeIntervals: this.timing.active ? [{ startTime: fromNumber(this.timing.first), endTime: fromNumber(this.timing.last + this.timing.duration), readyFlash: 0 }] : [],
        rotateEvents: area.rotateEvents.map(event => ({ ...event, startTime: fromNumber(this.timing.first), endTime: fromNumber(this.timing.last + this.timing.duration) })) })));
    }
    return { chart: this.fullPreview ? this.fullChart : this.previewChart, seconds: viewSeconds };
  }

  layout(renderer) {
    if (!this.fit) return null;
    const rectangle = this.overlay.getBoundingClientRect(); const viewport = previewViewport(rectangle.width, rectangle.height, renderer.aspectRatio ?? 1.5);
    const scale = viewport.scale / (renderer.viewDivisor ?? 1); const width = this.options.width * scale; const height = width * this.fit.height / this.fit.width;
    const positionScale = previewPositionScale(renderer.aspectRatio ?? 1.5);
    const angle = this.options.rotation * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle);
    const center = { x: rectangle.width / 2 + this.options.x * scale * positionScale.x, y: rectangle.height / 2 - this.options.y * scale * positionScale.y };
    const point = (x, y) => ({ x: center.x + (x * cosine - y * sine) * positionScale.x, y: center.y + (x * sine + y * cosine) * positionScale.y });
    return { scale, positionScale, center, width, height, corners: [point(-width / 2, -height / 2), point(width / 2, -height / 2), point(width / 2, height / 2), point(-width / 2, height / 2)], resize: point(width / 2, height / 2), rotate: point(0, -height / 2 - 28) };
  }

  drawLayout(renderer) {
    if (this.getContext().previewVisible) { this.overlay.hidden = true; return; }
    this.overlay.hidden = false; this.renderer = renderer; const { context } = prepareCanvas(this.overlay); const layout = this.layout(renderer); if (!layout) return;
    context.strokeStyle = '#75edc2'; context.lineWidth = 1; context.setLineDash([5, 4]); context.beginPath();
    layout.corners.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath(); context.stroke(); context.setLineDash([]);
    context.fillStyle = '#202a31'; context.strokeStyle = '#adffdf';
    context.beginPath(); context.arc(layout.center.x, layout.center.y, 6, 0, Math.PI * 2); context.fill(); context.stroke();
    context.fillRect(layout.resize.x - 5, layout.resize.y - 5, 10, 10); context.strokeRect(layout.resize.x - 5, layout.resize.y - 5, 10, 10);
    context.beginPath(); context.arc(layout.rotate.x, layout.rotate.y, 6, 0, Math.PI * 2); context.fill(); context.stroke();
  }

  pointer(event) { const rectangle = this.overlay.getBoundingClientRect(); return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top }; }
  down(event) {
    if (event.button !== 0 || !this.previewChart) return;
    event.preventDefault(); event.stopPropagation(); const point = this.pointer(event); const layout = this.layout(this.renderer);
    const near = handle => Math.hypot(point.x - handle.x, point.y - handle.y) < 16;
    const kind = near(layout.resize) ? 'scale' : near(layout.rotate) ? 'rotate' : 'move';
    const relative = { x: (point.x - layout.center.x) / layout.positionScale.x, y: (point.y - layout.center.y) / layout.positionScale.y };
    this.drag = { kind, start: point, x: this.options.x, y: this.options.y, width: this.options.width, rotation: this.options.rotation, center: layout.center, scale: layout.scale, positionScale: layout.positionScale, radius: Math.max(1, Math.hypot(relative.x, relative.y)), angle: Math.atan2(relative.y, relative.x) };
    this.overlay.setPointerCapture(event.pointerId);
  }
  move(event) {
    if (!this.drag) return; event.preventDefault(); const point = this.pointer(event); const drag = this.drag;
    const relative = { x: (point.x - drag.center.x) / drag.positionScale.x, y: (point.y - drag.center.y) / drag.positionScale.y };
    if (drag.kind === 'move') { this.options.x = Math.round((drag.x + (point.x - drag.start.x) / (drag.scale * drag.positionScale.x)) * 1000) / 1000; this.options.y = Math.round((drag.y - (point.y - drag.start.y) / (drag.scale * drag.positionScale.y)) * 1000) / 1000; }
    else if (drag.kind === 'scale') this.options.width = limited(drag.width * Math.hypot(relative.x, relative.y) / drag.radius, 1, 20000);
    else this.options.rotation = Math.round((drag.rotation + (Math.atan2(relative.y, relative.x) - drag.angle) * 180 / Math.PI) * 1000) / 1000;
    this.syncControls(['x', 'y', 'width', 'rotation']);
    if (!this.dragFrame) this.dragFrame = requestAnimationFrame(() => { this.dragFrame = null; if (this.active) this.rebuild(); });
  }
  endDrag(event) {
    if (!this.drag) return;
    if (event.type === 'pointerup') this.move(event);
    this.drag = null; if (this.dragFrame) cancelAnimationFrame(this.dragFrame); this.dragFrame = null; this.rebuild();
  }
  scaleLayout(width) { if (!this.active || !this.fit) return; this.options.width = limited(width, 1, 20000); this.syncControls(['width']); this.rebuild(); }

  apply() {
    try {
      if (!this.active || !this.areas || this.applyButton.disabled) return;
      const { session } = this.getContext(); if (session !== this.owner) throw new Error(t('noise-fit.s6b2e64b'));
      const areas = this.areas; const next = noiseFitChart(session.chart, areas);
      this.pause(); this.active = false; this.cancel(); this.previewChart = null; this.overlay.hidden = true; this.stage.closest('.editor').classList.remove('noise-fit-mode');
      session.commit(t('noise-fit.sd15c8bd'), next); this.activate('chart'); this.notify(t('noise-fit.sa576945', { p0: areas.length }), 'success'); this.invalidate();
    } catch (error) { this.fail(error.message); this.notify(error.message, 'error'); }
  }
}
