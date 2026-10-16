import { beatValue, formatBeat, fromNumber, parseBeat } from '../core/beat.ts';
import { NOISE_REVEALS } from '../core/noise-fit.mjs';
import { noiseLayers } from '../core/noise-skin.mjs';
import { previewViewport } from '../core/editor-display.ts';
import { fittedNoiseAreas, noiseFitChart } from '../application/noise-fit.mjs';
import { beatInputControl } from './beat-input.ts';
import { createEasingPicker, EASING_NAMES } from './easing-picker.ts';
import { prepareCanvas } from './timeline.ts';
import { editorSkinContext } from './editor-skin-canvas.mjs';

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
    this.overlay.setAttribute('aria-label', '噪域图案布局：拖动中心移动、右下角缩放、上方圆点旋转'); stage.append(this.overlay);
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
    const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = '噪域图案'; this.scroll.append(title);
    const modes = document.createElement('div'); modes.className = 'noise-fit-modes'; this.scroll.append(modes);
    for (const [mode, text] of [['text', '文字'], ['image', '图片']]) {
      const choice = button(text, () => { this.options.mode = mode; this.render(); this.refresh(); }); choice.classList.toggle('active', this.options.mode === mode); choice.setAttribute('aria-pressed', String(this.options.mode === mode)); modes.append(choice);
    }
    this.sourceCanvas = document.createElement('canvas'); this.sourceCanvas.width = 480; this.sourceCanvas.height = 180; this.sourceCanvas.className = 'noise-fit-source';
    this.sourceCanvas.setAttribute('aria-label', '二值化图案和矩形分布预览'); this.scroll.append(this.sourceCanvas);
    const source = document.createElement('div'); this.scroll.append(source);
    if (this.options.mode === 'text') {
      const text = document.createElement('textarea'); text.rows = 3; text.maxLength = 1000; text.value = this.options.text; text.setAttribute('aria-label', '噪域拟合文字');
      text.oninput = () => { this.options.text = text.value; this.refresh(); }; source.append(text);
      this.field(source, 'font', '字体', { choices: [...this.fonts], refit: true });
      const customFont = document.createElement('input'); customFont.type = 'file'; customFont.accept = '.ttf,.otf,.woff,.woff2'; customFont.hidden = true;
      customFont.setAttribute('aria-label', '噪域图案字体文件');
      customFont.onchange = () => this.loadFont(customFont.files[0]); source.append(button('导入本地字体', () => customFont.click()), customFont);
      this.field(source, 'spacing', '行距', { min: 0.5, max: 4, step: 0.05, refit: true });
    } else {
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,image/avif'; file.hidden = true;
      file.setAttribute('aria-label', '噪域拟合图片'); file.onchange = () => this.loadImage(file.files[0]); source.append(button('选择本地图片', () => file.click()), file);
      const name = document.createElement('p'); name.className = 'hint'; name.textContent = this.imageName || '支持 PNG、JPEG、WebP、BMP、GIF、AVIF；透明像素保留为空白。'; source.append(name);
      this.field(source, 'polarity', '图案前景', { choices: [['dark', '深色部分'], ['light', '浅色部分'], ['alpha', '不透明部分']], refit: true });
      this.field(source, 'invertImage', '反选二值图案', { type: 'checkbox', refit: true });
    }
    this.field(this.scroll, 'precision', '精细程度（长边格数）', { type: 'range', min: 16, max: 512, step: 1, refit: true });
    this.precisionValue = document.createElement('p'); this.precisionValue.className = 'hint'; this.scroll.append(this.precisionValue);
    this.field(this.scroll, 'threshold', '二值化阈值', { type: 'range', min: 1, max: 254, step: 1, refit: true });
    this.field(this.scroll, 'merge', '合并相邻矩形', { type: 'checkbox', refit: true });
    this.field(this.scroll, 'maxSpan', '矩形最大边长（格）', { min: 1, max: 512, step: 1, refit: true });
    this.field(this.scroll, 'trim', '裁掉外围空白', { type: 'checkbox', refit: true });
    this.heading('布局');
    this.field(this.scroll, 'width', '图案宽度', { min: 1, max: 20000 });
    this.field(this.scroll, 'x', '中心 X'); this.field(this.scroll, 'y', '中心 Y'); this.field(this.scroll, 'rotation', '整体旋转（顺时针）');
    this.scroll.append(button('居中并适配画面', () => {
      this.options.x = this.options.y = this.options.rotation = 0;
      this.options.width = this.fit ? Math.min(1100, 700 * this.fit.width / this.fit.height) : 900;
      this.syncControls(['x', 'y', 'width', 'rotation']); this.rebuild();
    }));
    this.field(this.scroll, 'layerId', '目标噪域层', { choices: noiseLayers(this.getContext().session.chart).map(layer => [layer.id, layer.name]) });
    this.field(this.scroll, 'name', '名称前缀', { type: 'text' }); this.field(this.scroll, 'invert', '生成反转噪域', { type: 'checkbox' });
    this.heading('出现与生命周期');
    this.field(this.scroll, 'first', '第一个出现拍', { beat: true });
    this.field(this.scroll, 'last', '最后一个出现拍', { beat: true });
    this.scroll.append(button('末拍跟随首拍', () => { this.lastLinked = true; this.options.last = this.options.first; this.syncControls(['last']); this.rebuild(); }));
    this.field(this.scroll, 'duration', '每块存在时间（拍）', { beat: true });
    this.field(this.scroll, 'reveal', '浮现方式', { choices: NOISE_REVEALS });
    this.field(this.scroll, 'easingType', '出现缓动', { choices: EASING_NAMES.map((name, index) => [index + 1, `${index + 1} · ${name}`]) });
    const picker = createEasingPicker(Number(this.options.easingType), value => { this.options.easingType = value; this.syncControls(['easingType']); this.rebuild(); }, this.easingState); this.scroll.append(picker.element);
    this.field(this.scroll, 'seed', '随机种子', { min: 0, max: 4294967295, step: 1 });
    this.scroll.append(button('随机种子', () => { this.options.seed = crypto.getRandomValues(new Uint32Array(1))[0]; this.syncControls(['seed']); this.rebuild(); }));
    this.heading('激活');
    this.field(this.scroll, 'active', '生成激活时间段', { type: 'checkbox' });
    this.field(this.scroll, 'activeStart', '相对出现后的激活起拍', { beat: true }); this.field(this.scroll, 'activeEnd', '相对出现后的激活止拍', { beat: true });
    this.field(this.scroll, 'readyFlash', '预备闪烁（秒）', { min: 0, max: 600, step: 0.001 });
    this.scroll.append(button('激活覆盖整个存在时间', () => { this.fullActivation(); this.rebuild(); }));
    this.heading('实时预览');
    this.field(this.scroll, 'show', '左侧显示实时预览', { type: 'checkbox' });
    this.playButton = button(this.options.animate ? 'Ⅱ 暂停演示' : '▶ 播放演示', () => { this.fullPreview = false; this.options.animate = !this.options.animate; this.animationEpoch = null; this.updatePlay(); this.invalidate(); });
    this.progressInput = document.createElement('input'); this.progressInput.type = 'range'; this.progressInput.min = 0; this.progressInput.max = 1; this.progressInput.step = 0.001;
    this.progressInput.value = this.progress; this.progressInput.setAttribute('aria-label', '噪域图案预览进度');
    this.progressInput.oninput = () => { this.fullPreview = false; this.options.animate = false; this.progress = Number(this.progressInput.value); this.animationEpoch = null; this.updatePlay(); this.invalidate(); };
    this.previewTime = document.createElement('output'); this.previewTime.className = 'hint';
    const playback = document.createElement('div'); playback.className = 'noise-fit-playback'; playback.append(this.playButton, this.progressInput, this.previewTime); this.scroll.append(playback);
    this.scroll.append(button('查看完整形状', () => { this.options.animate = false; this.progress = 0.5; this.fullPreview = true; this.updatePlay(); this.invalidate(); }));
    const help = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '拟合与时间说明';
    const description = document.createElement('p'); description.className = 'hint';
    description.textContent = '提高精细程度可保留细节，也会增加噪域。矩形完整覆盖二值图案，不填充孔洞；相邻格可合并，减小矩形最大边长可让浮现更细腻。首尾出现拍控制每块的出生时间，各块分别存活指定拍数；若存在时间短于整个浮现过程，早出现的块可能先消失。缓动图的横轴是已过去的时间比例，纵轴是已出现的数量比例：Out 型先快后慢，In 型先慢后快。回弹、弹性按第一次达到对应比例的时刻安排，已经出现的块不因曲线回落而撤回；首块和末块保留指定的首尾出现拍。未编辑的末拍跟随首拍；激活范围相对每一块的出生时刻。左侧拖动图案移动、方块缩放、圆点旋转；滚轮缩放图案。预览不写入谱面，图片和字体仅在本机使用，生成结果是可独立编辑的普通噪域。';
    help.append(summary, description); this.scroll.append(help);
    const footer = document.createElement('div'); footer.className = 'noise-fit-footer';
    this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status');
    this.count = document.createElement('strong'); this.count.setAttribute('aria-live', 'polite');
    this.applyButton = button('生成噪域', () => this.apply()); this.applyButton.className = 'primary'; this.applyButton.disabled = true;
    footer.append(this.count, this.message, button('返回谱面工具', () => this.activate('chart')), this.applyButton); this.host.append(footer); this.updateVisibility();
  }

  heading(text) { const heading = document.createElement('h3'); heading.textContent = text; this.scroll.append(heading); }
  syncControls(keys) { for (const key of keys) { const control = this.controls.get(key); if (control) control.value = this.options[key]; } }
  fullActivation() { this.activeLinked = true; this.options.activeStart = '0:0/1'; this.options.activeEnd = this.options.duration; this.syncControls(['activeStart', 'activeEnd']); }
  updatePlay() { if (this.playButton) this.playButton.textContent = this.options.animate ? 'Ⅱ 暂停演示' : '▶ 播放演示'; }
  updateVisibility() {
    for (const key of ['activeStart', 'activeEnd', 'readyFlash']) if (this.controls.get(key)) this.controls.get(key).disabled = !this.options.active;
    if (this.controls.get('maxSpan')) this.controls.get('maxSpan').disabled = !this.options.merge;
    if (this.controls.get('seed')) this.controls.get('seed').closest('.field').hidden = this.options.reveal !== 'random';
    if (this.precisionValue) this.precisionValue.textContent = `长边 ${this.options.precision} 格 · 阈值 ${this.options.threshold} / 255`;
  }

  async loadFont(file) {
    if (!file) return;
    try {
      const name = 'NoiseFitFont' + this.fonts.size; const font = new FontFace(name, await file.arrayBuffer()); await font.load(); document.fonts.add(font);
      this.fonts.set(name, file.name); this.options.font = name;
      if (this.active) { this.render(); this.refresh(); }
    } catch (error) { this.fail('字体载入失败：' + error.message); }
  }

  async loadImage(file) {
    if (!file) return; const generation = ++this.imageGeneration;
    try {
      const bitmap = await createImageBitmap(file);
      if (generation !== this.imageGeneration) { bitmap.close(); return; }
      if (bitmap.width * bitmap.height > 64000000) { bitmap.close(); throw new Error('图片超过 6400 万像素，请先缩小图片'); }
      this.bitmap?.close(); this.bitmap = bitmap; this.imageName = file.name;
      if (this.active) { this.render(); this.refresh(); }
    } catch (error) { if (generation === this.imageGeneration) this.fail('图片载入失败：' + error.message); }
  }

  fail(message) { this.previewChart = null; this.areas = null; this.applyButton.disabled = true; this.message.textContent = message; this.message.classList.add('error'); this.overlay.hidden = true; this.invalidate(); }
  refresh() {
    this.cancel(); this.fit = null; this.previewChart = null; this.areas = null; this.applyButton.disabled = true; this.count.textContent = '计算中…'; this.message.textContent = '正在拟合图案…'; this.message.classList.remove('error'); this.overlay.hidden = true; this.invalidate();
    if (!this.active) return; const generation = this.generation;
    this.timer = setTimeout(() => this.calculate(generation).catch(error => { if (generation === this.generation) this.fail(error.message); }), 130);
  }

  async rasterize() {
    const { precision, mode, text, font, spacing } = this.options;
    if (!Number.isInteger(precision) || precision < 16 || precision > 512) throw new Error('精细程度须为 16–512 格');
    const raster = document.createElement('canvas'); const context = raster.getContext('2d', { willReadFrequently: true });
    if (mode === 'image') {
      if (!this.bitmap) throw new Error('请先选择本地图片');
      const scale = precision / Math.max(this.bitmap.width, this.bitmap.height);
      raster.width = Math.max(1, Math.round(this.bitmap.width * scale)); raster.height = Math.max(1, Math.round(this.bitmap.height * scale));
      context.drawImage(this.bitmap, 0, 0, raster.width, raster.height);
    } else {
      if (!text.trim()) throw new Error('请输入可见文字');
      const lines = text.split(/\r?\n/); if (lines.length > 16 || text.length > 1000) throw new Error('一次最多拟合 16 行、1000 个字符');
      if (!Number.isFinite(spacing) || spacing < 0.5 || spacing > 4) throw new Error('行距须在 0.5–4 之间');
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
    worker.onerror = () => { if (generation === this.generation) { this.cancel(); this.fail('后台拟合失败，请重新调整参数'); } };
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
    if (!Number.isInteger(values.seed) || values.seed < 0 || values.seed > 4294967295) throw new Error('随机种子须为 0–4294967295 的整数');
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
      this.timing = values; this.animationEpoch = null; this.count.textContent = `${this.areas.length} 个噪域`;
      this.message.textContent = `二值图案 ${this.fit.width} × ${this.fit.height} 格 · ${this.fit.pixels} 个前景格 · 修改参数实时更新，生成前不写入谱面。`;
      this.message.classList.remove('error'); this.applyButton.disabled = false; this.applyButton.textContent = `生成 ${this.areas.length} 个噪域`; this.invalidate();
    } catch (error) { this.count.textContent = `${this.fit.rectangles.length} 个噪域`; this.fail(error.message); }
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
    this.progressInput.value = Math.min(1, this.progress); this.previewTime.textContent = this.fullPreview ? '完整形状（仅检查布局，不代表同一时刻全部存活）' : `预览拍数 ${formatBeat(fromNumber(tempo.beat(viewSeconds)))}`;
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
    const angle = this.options.rotation * Math.PI / 180; const cosine = Math.cos(angle); const sine = Math.sin(angle);
    const center = { x: rectangle.width / 2 + this.options.x * scale, y: rectangle.height / 2 - this.options.y * scale };
    const point = (x, y) => ({ x: center.x + x * cosine - y * sine, y: center.y + x * sine + y * cosine });
    return { scale, center, width, height, corners: [point(-width / 2, -height / 2), point(width / 2, -height / 2), point(width / 2, height / 2), point(-width / 2, height / 2)], resize: point(width / 2, height / 2), rotate: point(0, -height / 2 - 28) };
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
    this.drag = { kind, start: point, x: this.options.x, y: this.options.y, width: this.options.width, rotation: this.options.rotation, center: layout.center, scale: layout.scale, radius: Math.max(1, Math.hypot(point.x - layout.center.x, point.y - layout.center.y)), angle: Math.atan2(point.y - layout.center.y, point.x - layout.center.x) };
    this.overlay.setPointerCapture(event.pointerId);
  }
  move(event) {
    if (!this.drag) return; event.preventDefault(); const point = this.pointer(event); const drag = this.drag;
    if (drag.kind === 'move') { this.options.x = Math.round((drag.x + (point.x - drag.start.x) / drag.scale) * 1000) / 1000; this.options.y = Math.round((drag.y - (point.y - drag.start.y) / drag.scale) * 1000) / 1000; }
    else if (drag.kind === 'scale') this.options.width = limited(drag.width * Math.hypot(point.x - drag.center.x, point.y - drag.center.y) / drag.radius, 1, 20000);
    else this.options.rotation = Math.round((drag.rotation + (Math.atan2(point.y - drag.center.y, point.x - drag.center.x) - drag.angle) * 180 / Math.PI) * 1000) / 1000;
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
      const { session } = this.getContext(); if (session !== this.owner) throw new Error('谱面已切换，请重新打开工具');
      const areas = this.areas; const next = noiseFitChart(session.chart, areas);
      this.pause(); this.active = false; this.cancel(); this.previewChart = null; this.overlay.hidden = true; this.stage.closest('.editor').classList.remove('noise-fit-mode');
      session.commit('噪域图案生成', next); this.activate('chart'); this.notify(`已生成 ${areas.length} 个噪域，可一次撤销`, 'success'); this.invalidate();
    } catch (error) { this.fail(error.message); this.notify(error.message, 'error'); }
  }
}
