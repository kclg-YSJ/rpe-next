import { parseBeat, beatValue, formatBeat, fromNumber } from '../core/beat.mjs';
import { parseLineExpression } from '../application/multi-line-edit.mjs';
import { textLinesChart } from '../application/text-lines.mjs';

const action = (label, run) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = run; return button; };

export class TextLinesPanel {
  constructor(host, getContext, { activate, invalidate, notify }) {
    Object.assign(this, { host, getContext, activate, invalidate, notify }); this.generation = 0;
    this.options = { text: 'RPE', font: 'sans-serif', lines: '', beat: '0', width: 900, x: 0, y: 0, size: 0.4, noteType: 4, tolerance: 30, coverage: 95, spacing: 1.2, replace: false, addNotes: false, show: true };
    this.fonts = ['sans-serif', 'Microsoft YaHei', 'Arial', 'Times New Roman', 'Segoe UI Emoji', 'RPEGame'];
    this.fontNames = new Map();
    this.render();
  }
  open() {
    const { session, tempo, seconds } = this.getContext();
    if (!this.options.lines) this.options.lines = String(session.lineIndex);
    this.options.beat = formatBeat(fromNumber(tempo.beat(seconds))); this.active = true; this.render(); this.activate('text-lines'); this.refresh();
  }
  hide() { this.active = false; this.cancel(); this.previewChart = null; }
  cancel() { this.generation++; clearTimeout(this.timer); this.worker?.terminate(); this.worker = null; }
  render() {
    this.host.replaceChildren(); const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = '文字拼合'; this.host.append(title);
    const text = document.createElement('textarea'); text.rows = 3; text.maxLength = 1000; text.value = this.options.text; text.setAttribute('aria-label', '拼合文本'); this.host.append(text);
    text.oninput = () => { this.options.text = text.value; this.refresh(); };
    this.controls = new Map();
    const field = (key, labelText, type = 'number', minimum, maximum, step = 'any') => {
      const label = document.createElement('label'); label.className = 'field'; label.append(labelText);
      const input = document.createElement(['font', 'noteType'].includes(key) ? 'select' : 'input'); input.setAttribute('aria-label', labelText);
      if (key === 'font') input.replaceChildren(...this.fonts.map(name => new Option(this.fontNames.get(name) ?? name, name)));
      else if (key === 'noteType') input.replaceChildren(...[[4, 'Drag'], [1, 'Tap'], [3, 'Flick']].map(([value, name]) => new Option(name, value)));
      else input.type = type;
      if (minimum !== undefined) input.min = minimum; if (maximum !== undefined) input.max = maximum; input.step = step;
      if (type === 'checkbox') input.checked = this.options[key]; else input.value = this.options[key];
      input.oninput = () => { this.options[key] = type === 'checkbox' ? input.checked : type === 'number' ? (input.value.trim() ? Number(input.value) : NaN) : input.value; this.refresh(); };
      label.append(input); this.host.append(label); this.controls.set(key, input); return input;
    };
    field('font', '字体', 'text');
    const fontFile = document.createElement('input'); fontFile.type = 'file'; fontFile.accept = '.ttf,.otf,.woff,.woff2'; fontFile.hidden = true;
    fontFile.onchange = async () => {
      try {
        const file = fontFile.files[0]; if (!file) return;
        const name = 'TextFont' + this.fonts.length; const font = new FontFace(name, await file.arrayBuffer()); await font.load(); document.fonts.add(font); this.fonts.push(name); this.fontNames.set(name, file.name); this.options.font = name; this.render(); this.refresh();
      } catch (error) { this.fail('字体载入失败：' + error.message); }
    };
    this.host.append(action('导入字体文件', () => fontFile.click()), fontFile);
    field('lines', '参与线号 / 组名', 'text');
    this.host.append(action('使用全部判定线', () => { this.options.lines = `0:${this.getContext().session.chart.judgeLineList.length - 1}`; this.controls.get('lines').value = this.options.lines; this.refresh(); }));
    field('beat', '生成拍数', 'text'); field('width', '文字总宽度', 'number', 10, 10000); field('x', '中心 X'); field('y', '中心 Y');
    field('spacing', '行距倍率', 'number', 0.5, 4, 0.1); field('noteType', '音符种类'); field('size', '音符大小', 'number', 0.05, 4, 0.05); field('tolerance', '容忍度 / %', 'number', 0, 90, 1);
    field('coverage', '骨架覆盖度下限 / %', 'number', 0, 100, 0.1);
    field('replace', '替换生成时刻的位移 / 旋转', 'checkbox'); field('addNotes', '同时添加零速假音符', 'checkbox'); field('show', '左侧预览（固定在生成时刻）', 'checkbox');
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '规则、字体与误差说明'; const help = document.createElement('p'); help.className = 'hint';
    help.textContent = '音符贴图为拟合结果，青色为原字形。可选择 Drag、Tap 或 Flick，按对应贴图比例重新拟合。先提取字形骨架并统一笔画宽度，减少为填满粗笔画而叠加音符；优先水平、竖直与 45° 斜向，曲线和其他斜笔画仍可使用其他角度。骨架误差 = 1 − 音符与统一宽度后的骨架交集面积 / 并集面积；每个独立连通部分的骨架覆盖度还须达到设定下限（默认 95%，可调 0–100%）。覆盖下限和误差容忍度独立，降低覆盖下限可减少用线，也可能遗漏小笔画；设为 0% 只检查误差。未达标不生成，不保证理论最少用线。线号支持 0 2:8 组名，最多使用指定数量。文字、字体仅在本机处理；系统字体缺失时浏览器可能回退，emoji 按单色剪影提取骨架。导入字体仅本次会话使用，结果事件不依赖字体。事件写入基础层 0，补偿父线和其他层；生成前的事件保留，生成后保持到该轴下一事件。穿过 Bezier 或整体轨迹时请先拆分。父线之后继续运动仍会影响结果。已有音符应与所选类型一致，并为零速、X=0、Y 偏移=0、相同大小；新增假音符在生成时刻后一秒判定，不发打击音。'; details.append(summary, help); this.host.append(details);
    this.canvas = document.createElement('canvas'); this.canvas.width = 500; this.canvas.height = 260; this.canvas.className = 'trajectory-preview'; this.canvas.setAttribute('aria-label', '文字与音符拟合预览'); this.host.append(this.canvas);
    this.message = document.createElement('p'); this.message.className = 'hint'; this.message.setAttribute('role', 'status'); this.host.append(this.message);
    const noteHelp = document.createElement('p'); noteHelp.className = 'hint'; noteHelp.textContent = '误差比较骨架结构，不要求填满青色原字形，也不计高亮光晕。若线本体遮挡文字，可先把参与线的透明度设为 0；负透明度会隐藏音符。非默认音符尺寸控制仍会影响实际效果。'; details.append(noteHelp);
    const previewPosition = this.controls.get('font').parentElement;
    this.host.insertBefore(this.canvas, previewPosition); this.host.insertBefore(this.message, previewPosition);
    const footer = document.createElement('div'); footer.className = 'text-lines-footer'; this.applyButton = action('生成判定线事件', () => this.apply()); this.applyButton.disabled = true;
    footer.append(action('返回谱面工具', () => this.activate('chart')), this.applyButton); this.host.append(footer);
    const scroll = document.createElement('div'); scroll.className = 'text-lines-scroll';
    scroll.append(...[...this.host.children].filter(child => child !== footer)); this.host.insertBefore(scroll, footer);
  }
  fail(message) { this.previewChart = null; this.result = null; this.applyButton.disabled = true; this.message.textContent = message; this.invalidate(); }
  refresh() {
    this.cancel(); this.result = null; this.previewChart = null; this.applyButton.disabled = true; this.message.textContent = '正在计算…'; this.invalidate();
    if (!this.active) return;
    const generation = this.generation;
    this.timer = setTimeout(() => this.calculate(generation).catch(error => { if (generation === this.generation) this.fail(error.message); }), 220);
  }
  async calculate(generation) {
    const options = { ...this.options }; const { session, skin, noteSize = 175 } = this.getContext(); const chart = session.chart;
    if (!options.text.trim()) throw new Error('请输入可见文字');
    if (![options.width, options.x, options.y, options.spacing, options.size, options.tolerance].every(Number.isFinite) || options.width < 10 || options.width > 10000 || options.spacing < 0.5 || options.spacing > 4 || options.size < 0.05 || options.size > 4 || options.tolerance < 0 || options.tolerance > 90) throw new Error('布局、音符大小或容忍度无效');
    if (!Number.isFinite(options.coverage) || options.coverage < 0 || options.coverage > 100) throw new Error('骨架覆盖度下限须为 0–100%');
    if (![4, 1, 3].includes(options.noteType)) throw new Error('请选择 Drag、Tap 或 Flick');
    for (const token of options.lines.split(/\s+/)) if (/^[+-]?\d+(?::[+-]?\d+)?$/.test(token) && token.split(':').some(value => Number(value) < 0 || Number(value) >= chart.judgeLineList.length)) throw new Error('线号超出谱面范围');
    const indices = parseLineExpression(options.lines, chart.judgeLineList.length, chart); if (!indices.length || indices.length > 5000) throw new Error('请选择 1–5000 条现有判定线');
    const beatTime = parseBeat(options.beat); const beat = beatValue(beatTime);
    await document.fonts.load(`96px "${options.font}"`, options.text); if (generation !== this.generation) return;
    const lines = options.text.split(/\r?\n/); if (lines.length > 16) throw new Error('一次最多拟合 16 行文字');
    const measure = document.createElement('canvas').getContext('2d'); const font = `96px "${options.font}", sans-serif`; measure.font = font;
    const metrics = lines.map(line => measure.measureText(line));
    const naturalWidth = Math.max(1, ...metrics.map(entry => Math.max(entry.width, entry.actualBoundingBoxLeft + entry.actualBoundingBoxRight)));
    const ascent = Math.max(80, ...metrics.map(entry => entry.actualBoundingBoxAscent)); const descent = Math.max(20, ...metrics.map(entry => entry.actualBoundingBoxDescent));
    const lineHeight = (ascent + descent) * options.spacing; const naturalHeight = ascent + descent + lineHeight * (lines.length - 1);
    const worldHeight = options.width * naturalHeight / naturalWidth; const scale = Math.min(384 / options.width, 384 / worldHeight);
    const texture = skin.images.get({ 4: 'Drag2', 1: 'Tap2', 3: 'Flick2' }[options.noteType]); const length = noteSize * options.size * scale; const thickness = Math.max(5, noteSize * options.size * (texture ? texture.naturalHeight / texture.naturalWidth : 0.2)) * scale;
    if (thickness < 1 || length < 1) throw new Error('笔画相对文字太细，请增大音符大小、减少文字或减小总宽度');
    if (length * thickness > 2048) throw new Error('笔画相对文字太大，请减小音符大小或增大文字总宽度');
    const padding = Math.ceil(Math.hypot(length, thickness) / 2) + 2;
    const width = Math.ceil(options.width * scale) + padding * 2; const height = Math.ceil(worldHeight * scale) + padding * 2;
    const raster = document.createElement('canvas'); raster.width = width; raster.height = height; const context = raster.getContext('2d');
    const fontScale = options.width / naturalWidth * scale; context.font = `${96 * fontScale}px "${options.font}", sans-serif`; context.fillStyle = '#fff'; context.textBaseline = 'alphabetic';
    lines.forEach((line, index) => context.fillText(line, (width - metrics[index].width * fontScale) / 2, padding + (ascent + index * lineHeight) * fontScale));
    const pixels = context.getImageData(0, 0, width, height).data; const mask = Uint8Array.from({ length: width * height }, (unused, index) => pixels[index * 4 + 3] >= 100 ? 1 : 0);
    const worker = new Worker(new URL('../core/text-fit-worker.mjs', import.meta.url), { type: 'module' }); this.worker = worker;
    worker.onerror = () => { if (generation === this.generation) { this.cancel(); this.fail('后台拟合启动失败，请重新打开工具'); } };
    worker.onmessage = event => {
      worker.terminate(); if (this.worker === worker) this.worker = null;
      if (generation !== this.generation || !this.active) return;
      if (session !== this.getContext().session || chart !== session.chart) { this.refresh(); return; }
      if (event.data.error) { this.fail(event.data.error); return; }
      const fit = event.data.result; const strokes = fit.strokes.map(stroke => ({ x: options.x + (stroke.x - width / 2) / scale, y: options.y - (stroke.y - height / 2) / scale, angle: stroke.angle }));
      this.result = { ...fit, strokes, indices, beat, beatTime, size: options.size, noteType: options.noteType, addNotes: options.addNotes, replace: options.replace, chart, session };
      this.drawResult(raster, fit, length, thickness, texture);
      const statistics = `使用 ${strokes.length} / ${indices.length} 条线 · 骨架误差 ${(fit.error * 100).toFixed(1)}% / 容忍度 ${options.tolerance}% · 最低骨架覆盖 ${(fit.skeletonCoverage * 100).toFixed(1)}%（要求 ${(fit.requiredCoverage * 100).toFixed(1)}%）`;
      if (!fit.passed) { this.message.textContent = statistics + '。误差或覆盖未达标，不会生成；可增加线数或调整音符大小。'; this.invalidate(); return; }
      try {
        this.previewChart = textLinesChart(chart, { ...this.result, preview: true }); this.applyButton.disabled = false; this.message.textContent = statistics + ' · 已达标';
      } catch (error) { this.previewChart = null; this.message.textContent = statistics + '。' + error.message; }
      this.invalidate();
    };
    worker.postMessage({ mask, width, height, length, thickness, limit: indices.length, tolerance: options.tolerance / 100, requiredCoverage: options.coverage / 100 }, [mask.buffer]);
  }
  drawResult(raster, fit, length, thickness, texture) {
    const context = this.canvas.getContext('2d'); const scale = Math.min(480 / raster.width, 240 / raster.height);
    context.clearRect(0, 0, 500, 260); context.save(); context.translate((500 - raster.width * scale) / 2, (260 - raster.height * scale) / 2); context.scale(scale, scale);
    context.globalAlpha = 0.45; context.drawImage(raster, 0, 0); context.globalCompositeOperation = 'source-atop'; context.fillStyle = '#6de3ff'; context.fillRect(0, 0, raster.width, raster.height); context.globalCompositeOperation = 'source-over'; context.globalAlpha = 0.85;
    for (const stroke of fit.strokes) { context.save(); context.translate(stroke.x, stroke.y); context.rotate(stroke.angle); if (texture) context.drawImage(texture, -length / 2, -thickness / 2, length, thickness); else { context.fillStyle = '#f0d363'; context.fillRect(-length / 2, -thickness / 2, length, thickness); } context.restore(); }
    context.restore();
  }
  view() {
    this.sync();
    if (!this.active || !this.options.show || !this.previewChart || this.result?.chart !== this.getContext().session.chart) return null;
    return { chart: this.previewChart, seconds: this.getContext().tempo.seconds(this.result.beat) };
  }
  sync() { if (this.active && this.result && this.result.chart !== this.getContext().session.chart) this.refresh(); }
  apply() {
    try {
      const result = this.result; const { session } = this.getContext();
      if (!result?.passed || !this.previewChart) throw new Error('拟合尚未达标，未生成');
      if (result.session !== session || result.chart !== session.chart) { this.refresh(); throw new Error('谱面已改变，正在重新拟合，请等待预览'); }
      const next = textLinesChart(session.chart, result); this.previewChart = null; this.result = null; this.applyButton.disabled = true;
      session.commit('文字拼合', next); this.message.textContent = `已生成 ${result.strokes.length} 条线的位移和旋转事件，可一次撤销。`; this.notify(this.message.textContent, 'success'); this.invalidate();
    } catch (error) { this.message.textContent = error.message; this.notify(error.message, 'error'); }
  }
}
