import { SceneRuntime } from '../core/scene.mjs';
import { TempoMap } from '../core/tempo.mjs';
import { previewViewport, previewPositionScale } from '../core/editor-display.mjs';
import { DEFAULT_LINE_WIDTH, DEFAULT_LINE_HEIGHT } from '../core/visual-constants.mjs';
import { NoteSpriteBatch } from './note-sprite-batch.mjs';
import { RpeSkin } from './skin.mjs';
import { t } from '../i18n.mjs';

// Repeated equal sprites accumulate their texel alpha, without instantiating or
// drawing millions of copies. Ordering between different groups is approximate.
const REPEATED_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray pictures;
uniform vec2 extents[128];
in vec3 uv;
in vec4 tint;
out vec4 outputColor;
void main() {
  vec4 pixel = vec4(1.0);
  if (uv.z >= 0.0) {
    vec2 halfPixel = 0.5 / vec2(textureSize(pictures, 0).xy);
    pixel = texture(pictures, vec3(clamp(uv.xy, halfPixel, extents[int(uv.z)] - halfPixel), uv.z));
  }
  float alpha = 1.0 - pow(max(0.0, 1.0 - pixel.a), max(1.0, tint.a));
  outputColor = vec4(pixel.rgb * tint.rgb * (alpha / max(pixel.a, 0.000001)), alpha);
}`;
const mib = value => `${((value ?? 0) / 1024 ** 2).toFixed(1)} MiB`;
function node(tag, className, text) { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; }
async function call(action, id, value) { const response = await window.rpenLargePreview.call(action, id, value); if (!response.ok) throw Error(response.error); return response.result; }

export class LargeChartPreview {
  constructor({ skin, settings = {}, onClose = () => {}, onEdit } = {}) {
    this.skin = skin; this.settings = settings; this.onClose = onClose; this.onEdit = onEdit; this.revision = 0;
    this.batch = new NoteSpriteBatch({ fragment: REPEATED_FRAGMENT }); this.scene = new SceneRuntime(); this.audio = new Audio(); this.audio.preload = 'metadata'; this.audio.volume = Math.max(0, Math.min(1, settings.volume ?? .7));
    const dialog = this.dialog = node('dialog', 'large-chart-preview'); dialog.id = 'large-chart-preview';
    const heading = node('div', 'modal-heading'); this.title = node('h2', '', '超大谱 · 查看与编辑'); heading.append(this.title, node('span', 'large-preview-badge', '按窗口加载'));
    const close = node('button', '', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭预览并清理缓存'); close.onclick = () => this.close(); heading.append(close);
    const toolbar = node('div', 'large-preview-toolbar'); this.choose = node('button', '', '选择谱面'); this.choose.id = 'large-preview-choose'; this.choose.onclick = () => this.select();
    this.play = node('button', '', '播放'); this.play.id = 'large-preview-play'; this.play.disabled = true; this.play.onclick = () => this.toggle();
    this.seek = node('input'); this.seek.type = 'range'; this.seek.min = '0'; this.seek.max = '1'; this.seek.step = '.001'; this.seek.value = '0'; this.seek.disabled = true; this.seek.setAttribute('aria-label', '播放位置'); this.seek.oninput = () => this.go(Number(this.seek.value));
    this.timeLabel = node('output', 'large-preview-time', '0.00 / 0.00 s');
    this.rate = node('select'); this.rate.setAttribute('aria-label', '播放速度'); for (const speed of [.25, .5, .75, 1, 1.5, 2]) { const option = node('option', '', `${speed}×`); option.value = String(speed); this.rate.append(option); } this.rate.value = '1'; this.rate.onchange = () => { const current = this.currentTime(); this.clock = current; this.clockAt = performance.now(); this.audio.playbackRate = Number(this.rate.value); };
    this.volume = node('input'); this.volume.type = 'range'; this.volume.min = '0'; this.volume.max = '1'; this.volume.step = '.01'; this.volume.value = String(this.audio.volume); this.volume.setAttribute('aria-label', '音量'); this.volume.oninput = () => { this.audio.volume = Number(this.volume.value); };
    toolbar.append(this.choose, this.play, this.seek, this.timeLabel, this.rate, this.volume);
    if (onEdit) {
      this.edit = node('button', 'primary', '进入编辑'); this.edit.id = 'large-chart-enter-editor'; this.edit.disabled = true;
      this.edit.onclick = async () => {
        this.pause(); this.edit.disabled = true;
        try { const summary = await call('editable', this.summary.id); await this.onEdit(summary); await this.close({ keepDocument: true }); }
        catch (error) { this.error(error); this.edit.disabled = false; }
      }; toolbar.append(this.edit);
    }
    this.stage = node('div', 'large-preview-stage'); this.canvas = node('canvas'); this.context = this.canvas.getContext('2d'); this.stage.append(this.canvas);
    this.overlay = node('div', 'large-preview-overlay'); this.message = node('p', '', '选择 PEC 压缩包开始预览'); this.progress = node('progress'); this.progress.max = 1; this.progress.value = 0; this.progress.hidden = true;
    this.overlay.append(this.message, this.progress); this.stage.append(this.overlay);
    const footer = node('div', 'large-preview-footer'); this.stats = node('span'); this.cache = node('button', 'large-preview-cache', t('large-chart.cache')); this.cache.onclick = () => call('openCache').catch(error => this.error(error)); footer.append(this.stats, this.cache);
    const hint = node('p', 'large-preview-hint', 'PEC · 音乐、音符与判定线预览 · 暂不播放打击音效及特效。相同音符合成绘制，重叠混色可能有差异。关闭后清理缓存。');
    dialog.append(heading, toolbar, this.stage, footer, hint); dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) { event.preventDefault(); this.toggle(); } });
    this.unsubscribe = window.rpenLargePreview.onProgress(value => {
      if (!this.loading || this.disposed) return;
      this.progress.value = value.ratio; this.message.textContent = `${value.phase === 'index' ? '流式读取' : value.phase === 'ready' ? '准备预览' : '建立索引'} ${(value.ratio * 100).toFixed(1)}%`;
      this.stats.textContent = `${(value.notes ?? 0).toLocaleString()} 音符 · 缓存 ${mib(value.diskBytes)} · JS ${mib(value.memory)}`;
      this.cache.textContent = value.cacheRoot;
    });
    this.audio.addEventListener('ended', () => { this.pause(); this.dirty = true; });
    this.audio.addEventListener('loadedmetadata', () => { this.duration = this.audio.duration; this.seek.max = String(this.duration); this.dirty = true; });
    this.audio.addEventListener('error', () => { if (!this.disposed && this.summary?.media.music) this.error(Error('预览音频加载失败')); });
    this.resize = new ResizeObserver(() => { this.dirty = true; }); this.resize.observe(this.stage);
    document.body.append(dialog); dialog.showModal(); this.dirty = true; this.frame();
  }
  async select() {
    if (this.loading || this.summary) return;
    this.loading = true; this.choose.disabled = true; this.overlay.hidden = false; this.progress.hidden = false; this.message.textContent = t('large-chart.chooseLocations');
    try {
      const summary = await call('choose'); if (this.disposed) return;
      if (!summary) { this.overlay.hidden = false; this.message.textContent = '选择 PEC 压缩包开始预览'; return; }
      await this.load(summary);
    } catch (error) { this.error(error); }
    finally { this.loading = false; this.progress.hidden = true; this.choose.disabled = Boolean(this.summary); }
  }
  async load(summary) {
    this.summary = summary; this.title.textContent = summary.chart.META.name || '超大谱预览';
    if (this.edit) this.edit.disabled = false;
    this.tempo = new TempoMap(summary.chart.BPMList); this.scene.compile(summary.chart, this.tempo);
    this.offset = (summary.chart.META.offset ?? 0) / 1000; this.duration = Math.max(1, summary.endTime + this.offset); this.seek.max = String(this.duration); this.clock = 0;
    // Only the built-in PEC field set is accepted; no arbitrary shader, script,
    // image path or full-chart runtime is created in this experiment.
    let maximum = 0;
    for (const line of summary.chart.judgeLineList) {
      const bounds = ['moveXEvents', 'moveYEvents'].map(kind => (line.eventLayers ?? []).reduce((sum, layer) => sum + (layer[kind] ?? []).reduce((max, event) => Math.max(max, Math.max(Math.abs(event.start), Math.abs(event.end)) + Math.abs(event.end - event.start)), 0), 0));
      maximum = Math.max(maximum, Math.hypot(...bounds));
    }
    this.radius = 1600 + maximum; if (this.radius > 20000) throw Error('判定线移动范围超过实验预览预算');
    if (!this.skin?.noteBatchCompatible) { this.skin = new RpeSkin(() => { this.dirty = true; }); await this.skin.load(); }
    if (summary.media.cover) {
      const image = new Image(); image.src = summary.media.cover;
      try { await image.decode(); if (image.naturalWidth * image.naturalHeight <= 16 * 1024 ** 2) this.cover = image; } catch { /* A cover is optional. */ }
    }
    if (summary.media.music) { this.audio.src = summary.media.music; this.audio.load(); }
    this.cache.textContent = summary.cacheRoot;
    this.stats.textContent = `${summary.total.toLocaleString()} 音符 · ${summary.unique.toLocaleString()} 组 · 缓存 ${mib(summary.diskBytes)}`;
    await this.fetchWindow(-this.offset); this.play.disabled = this.seek.disabled = false; this.overlay.hidden = true; this.dirty = true;
    if (this.edit) this.edit.disabled = false;
  }
  currentTime() { return this.summary?.media.music ? this.audio.currentTime : this.playing ? this.clock + (performance.now() - this.clockAt) / 1000 * Number(this.rate.value) : this.clock ?? 0; }
  pause() { this.clock = this.currentTime(); this.startIntent = (this.startIntent ?? 0) + 1; this.starting = false; this.playing = false; this.audio.pause(); this.play.textContent = '播放'; }
  async toggle() {
    if (!this.summary || this.disposed) return;
    if (this.playing || this.starting || this.resumeAfterRead) { this.resumeAfterRead = false; this.pause(); return; }
    if (this.currentTime() >= this.duration) this.go(0);
    try { await this.start(); } catch (error) { this.error(error); }
  }
  async start() {
    if (this.disposed) return;
    const intent = this.startIntent = (this.startIntent ?? 0) + 1; this.starting = true; this.play.textContent = '暂停';
    try {
      while (!this.contains(this.currentTime() - this.offset)) {
        await this.fetchWindow(this.currentTime() - this.offset);
        if (this.disposed || this.startIntent !== intent) return;
      }
      if (this.disposed || this.startIntent !== intent) return;
      if (this.summary.media.music) await this.audio.play();
      if (this.disposed || this.startIntent !== intent) { this.audio.pause(); return; }
      this.clockAt = performance.now(); this.playing = true; this.overlay.hidden = true;
    } finally { if (this.startIntent === intent) this.starting = false; }
  }
  go(time) {
    this.revision++; this.failedWindow = null; this.clock = time; this.clockAt = performance.now(); if (this.summary?.media.music) this.audio.currentTime = time; this.dirty = true;
    if (!this.contains(time - this.offset)) this.buffer = null;
  }
  contains(seconds) { return this.buffer && seconds >= this.buffer.seconds && seconds <= this.buffer.end; }
  async fetchWindow(seconds) {
    if (this.request) return this.request;
    const revision = this.revision, start = Math.floor(seconds * 2) / 2;
    this.request = call('window', this.summary.id, { seconds: start, span: .75, radius: this.radius }).then(value => {
      if (!this.disposed && revision === this.revision) {
        value.lines = this.scene.lines.map(() => [[], []]);
        for (let offset = 0; offset < value.notes.length; offset += value.stride) value.lines[value.notes[offset]][value.notes[offset + 1] === 2 ? 0 : 1].push(offset);
        for (const line of value.lines) for (let kind = 0; kind < 2; kind++) line[kind] = Uint32Array.from(line[kind]);
        this.buffer = value; this.dirty = true;
      }
    }).finally(() => { this.request = null; });
    return this.request;
  }
  error(error) { if (this.disposed) return; this.resumeAfterRead = false; this.pause(); this.overlay.hidden = false; this.message.textContent = error.message; this.progress.hidden = true; this.failedWindow = this.currentTime(); }
  frame() {
    if (this.disposed) return; this.animation = requestAnimationFrame(() => this.frame());
    const time = this.currentTime(), seconds = time - (this.offset ?? 0);
    if (this.summary && !this.request && this.failedWindow !== time && (!this.contains(seconds) || this.playing && seconds > this.buffer.end - .25)) {
      const missing = !this.contains(seconds);
      if (missing && this.playing) { this.pause(); this.resumeAfterRead = true; this.overlay.hidden = false; this.message.textContent = '读取预览区间…'; }
      this.fetchWindow(seconds).then(() => { if (this.resumeAfterRead) { this.resumeAfterRead = false; return this.start(); } if (this.contains(this.currentTime() - this.offset)) this.overlay.hidden = true; }).catch(error => this.error(error));
    }
    if (this.playing && time >= this.duration) this.pause();
    if (this.dirty || this.playing) {
      this.dirty = false;
      try { this.draw(seconds); } catch (error) { this.error(error); }
      if (performance.now() - (this.lastLabel ?? 0) > 100 || !this.playing) {
        this.lastLabel = performance.now(); this.seek.value = String(time); this.timeLabel.textContent = `${time.toFixed(2)} / ${(this.duration ?? 0).toFixed(2)} s`;
      }
    }
  }
  draw(seconds) {
    const box = this.stage.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 1920 / Math.max(1, box.width), 1080 / Math.max(1, box.height));
    const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    const ctx = this.context; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#080b10'; ctx.fillRect(0, 0, width, height);
    if (!this.summary || !this.contains(seconds)) return;
    const aspect = this.settings.aspectRatio ?? 1.5, viewport = previewViewport(width, height, aspect), scale = viewport.scale, position = previewPositionScale(aspect);
    ctx.save(); ctx.beginPath(); ctx.rect(viewport.left, viewport.top, viewport.width, viewport.height); ctx.clip();
    try {
    if (this.cover) { const size = Math.max(viewport.width / this.cover.naturalWidth, viewport.height / this.cover.naturalHeight); ctx.globalAlpha = .3; ctx.drawImage(this.cover, (width - this.cover.naturalWidth * size) / 2, (height - this.cover.naturalHeight * size) / 2, this.cover.naturalWidth * size, this.cover.naturalHeight * size); ctx.globalAlpha = 1; }
    const states = this.scene.sample(seconds, position);
    for (const index of this.scene.order) {
      const state = states[index]; if (state.alpha <= 0) continue;
      ctx.save(); ctx.translate(width / 2 + state.x * scale, height / 2 - state.y * scale); ctx.rotate(state.rotation * Math.PI / 180); ctx.scale(state.scaleX, state.scaleY); ctx.globalAlpha = Math.min(1, state.alpha / 255);
      const color = this.skin.resourcePack?.perfectColor?.rgb ?? state.color; ctx.fillStyle = `rgb(${color.join(',')})`; ctx.fillRect(-DEFAULT_LINE_WIDTH / 2 * scale, -DEFAULT_LINE_HEIGHT / 2 * scale, DEFAULT_LINE_WIDTH * scale, DEFAULT_LINE_HEIGHT * scale); ctx.restore();
    }
    const target = this.batch.begin(ctx, width, height, this.skin); if (!target) throw Error('超大谱预览需要 WebGL2，当前无法启用受控的批量绘制');
    const noteSize = (this.settings.noteSize ?? 175) * scale;
    const rows = this.buffer.notes;
    for (const hold of [true, false]) for (const index of this.scene.order) {
      const state = states[index], line = this.scene.lines[index].line; if (state.alpha < 0) continue;
      target.save(); target.translate(width / 2 + state.x * scale, height / 2 - state.y * scale); target.rotate(state.rotation * Math.PI / 180);
      for (const offset of this.buffer.lines[index][hold ? 0 : 1]) {
        const start = rows[offset + 2], end = rows[offset + 3], speed = rows[offset + 7], floor = rows[offset + 10], endFloor = rows[offset + 11];
        if (end < seconds || start - seconds > 999999 || line.isCover === 1 && speed !== 0 && (hold ? endFloor : floor) < state.floor) continue;
        const side = rows[offset + 5] ? 1 : -1, y = (hold && start <= seconds ? 0 : floor - state.floor) * speed * side * position.y, tail = (endFloor - state.floor) * speed * side * position.y;
        const x = rows[offset + 4] * position.x * scale; target.globalAlpha = rows[offset + 9];
        if (hold) this.skin.hold(target, x, -y * scale, -tail * scale, noteSize * rows[offset + 8], Boolean(rows[offset + 12]), start > seconds, undefined, noteSize, side);
        else this.skin.head(target, rows[offset + 1], x, -y * scale, noteSize * rows[offset + 8], Boolean(rows[offset + 12]), undefined, 5, noteSize);
      }
      target.restore();
    }
    if (!this.batch.end()) throw Error('超大谱预览的图形上下文已停止');
    let combo = this.buffer.combo; const changes = this.buffer.completions;
    for (let offset = 0; offset < changes.length; offset += 2) { if (changes[offset] >= seconds) break; combo = changes[offset + 1]; }
    ctx.globalAlpha = .9; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `${Math.max(16, 35 * scale)}px sans-serif`; ctx.fillText(combo.toLocaleString(), width / 2, viewport.top + 48 * scale);
    ctx.textAlign = 'right'; ctx.font = `${Math.max(14, 28 * scale)}px sans-serif`; ctx.fillText(String(Math.round(combo / Math.max(1, this.summary.realNotes) * 1000000)).padStart(7, '0'), viewport.left + viewport.width - 25 * scale, viewport.top + 42 * scale);
    } finally { ctx.restore(); }
  }
  async close({ keepDocument = false } = {}) {
    if (this.disposed) return; this.disposed = true; this.pause(); cancelAnimationFrame(this.animation); this.resize.disconnect(); this.unsubscribe();
    this.audio.removeAttribute('src'); this.audio.load(); this.cover = null; this.buffer = null;
    if (this.batch.gl) { this.batch.resetTexture(); this.batch.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    this.message.textContent = '正在清理预览缓存…'; this.overlay.hidden = false;
    try { if (!keepDocument) await call('close'); }
    catch (error) { this.message.textContent = `缓存清理失败：${error.message}`; this.disposed = false; return; }
    this.dialog.close(); this.dialog.remove(); this.onClose();
  }
}

export function showLargeChartPreview(options) {
  if (!window.rpenLargePreview || document.querySelector('#large-chart-preview')) return;
  const preview = new LargeChartPreview(options); preview.select(); return preview;
}
