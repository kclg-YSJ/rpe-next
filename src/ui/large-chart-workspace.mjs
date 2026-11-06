import { LargeChartEditor } from '../application/large-chart-editor.mjs';
import { largeChartCommand } from '../platform/native.mjs';
import { LargeChartView } from './large-chart-view.mjs';
import { SceneRuntime } from '../core/scene.mjs';
import { NoteSpriteBatch } from './note-sprite-batch.mjs';
import { previewPositionScale } from '../core/editor-display.mjs';
import { t } from '../i18n.mjs';
import { LargeChartHitSounds } from '../platform/large-chart-hitsounds.mjs';

// Owns the lifetime of the disk document and its two bounded read windows.
export class LargeChartWorkspace {
  constructor(session, summary, { timeline, previews, audio, playback, invalidate, reportError }) {
    Object.assign(this, { session, timeline, previews, audio, playback, invalidate, reportError });
    this.document = new LargeChartEditor(session, summary, largeChartCommand, {
      changed: () => { this.update(); invalidate(); }, error: error => this.handleError(error),
      gestureActive: () => Boolean(timeline.drag || timeline.eventInteraction.drag || session.liveNoteEdit || session.liveEventEdit || timeline.pending),
    });
    this.view = new LargeChartView(this.document); this.loadingPage = true;
    this.hitSounds = new LargeChartHitSounds(this.document, playback.sounds, largeChartCommand);
    for (const preview of previews) preview.largeChartView = this.view;
    const button = this.button = document.createElement('button'); button.type = 'button'; button.id = 'large-chart-document';
    button.className = 'large-chart-document-button'; button.textContent = '▤'; button.setAttribute('aria-label', t('large-chart.title'));
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    document.querySelector('.view-buttons').after(button);
    const host = this.host = document.createElement('div'); host.className = 'selection-interval-panel large-chart-options'; host.hidden = true;
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-label', t('large-chart.title'));
    const heading = document.createElement('div'); heading.className = 'selection-interval-heading';
    const title = document.createElement('strong'); title.textContent = t('large-chart.title');
    const close = document.createElement('button'); close.textContent = '×'; close.type = 'button'; close.onclick = () => this.hideOptions();
    heading.append(title, close);
    this.label = document.createElement('p'); this.label.className = 'hint'; this.label.setAttribute('role', 'status');
    const quantityLabel = document.createElement('label'); quantityLabel.className = 'field'; quantityLabel.textContent = t('large-chart.singleCount');
    const quantity = document.createElement('input'); quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.value = '1'; quantity.id = 'large-chart-edit-count';
    quantity.setAttribute('aria-label', t('large-chart.singleCount'));
    quantity.onchange = () => { const count = Number(quantity.value); if (Number.isSafeInteger(count) && count > 0) { this.document.editCount = count; all.checked = false; } else quantity.value = String(this.document.editCount === 'all' ? 1 : this.document.editCount); };
    quantityLabel.append(quantity);
    const allLabel = document.createElement('label'); const all = document.createElement('input'); all.type = 'checkbox'; all.id = 'large-chart-edit-all';
    all.onchange = () => { this.document.editCount = all.checked ? 'all' : Math.max(1, Number(quantity.value)); quantity.disabled = all.checked; };
    allLabel.className = 'field'; allLabel.append(all, t('large-chart.wholeGroup'));
    const saveAs = document.createElement('button'); saveAs.type = 'button'; saveAs.className = 'wide-button'; saveAs.textContent = t('large-chart.saveAs'); saveAs.onclick = () => this.document.save(true).catch(reportError);
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('large-chart.reopenHint');
    host.append(heading, this.label, quantityLabel, allLabel, saveAs, hint); document.body.append(host);
    button.onclick = () => {
      if (!host.hidden) return this.hideOptions();
      host.hidden = false; button.setAttribute('aria-expanded', 'true');
      const point = button.getBoundingClientRect(), bounds = host.getBoundingClientRect();
      host.style.left = `${Math.max(4, Math.min(innerWidth - bounds.width - 4, point.left))}px`;
      host.style.top = `${Math.max(4, Math.min(innerHeight - bounds.height - 4, point.bottom + 4))}px`;
    };
    this.dismiss = event => { if (!host.contains(event.target) && event.target !== button) this.hideOptions(); };
    this.dismissKey = event => { if (event.key === 'Escape' && !host.hidden) { this.hideOptions(); event.preventDefault(); event.stopImmediatePropagation(); } };
    window.addEventListener('pointerdown', this.dismiss, true); window.addEventListener('keydown', this.dismissKey, true);
    this.blockInput = event => {
      if (!this.document.busy && !this.loadingPage || event.target.closest?.('dialog, .large-chart-options') || event.target === button) return;
      if(event.type==='keydown'&&(event.code==='Space'||!this.document.busy&&event.key==='Escape'))return;
      if (!this.document.busy && (this.timeline.drag || this.timeline.eventInteraction.drag)) return;
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 's') return;
      if (!this.document.busy && this.loadingPage && event.type !== 'keydown' && !event.target.closest?.('#notes, #events, #properties, #event-properties, .batch-controls, .selection-overlay')) return;
      if (event.target.closest?.('.editor, .preview-wrap, aside, header') || event.type === 'keydown') { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    for (const type of ['pointerdown', 'mousedown', 'click', 'contextmenu', 'keydown', 'input', 'change']) window.addEventListener(type, this.blockInput, true);
    this.update();
  }
  hideOptions() { this.host.hidden = true; this.button.setAttribute('aria-expanded', 'false'); }
  update() {
    if (!this.document || !this.label) return;
    const summary = this.document.summary;
    if (this.windowRevision !== summary.revision) { this.windowRevision = summary.revision; this.view?.set(null); this.failedWindow = null; }
    this.label.textContent = `${summary.total.toLocaleString()} ${t('large-chart.notes')} · ${summary.dirty ? t('large-chart.unsaved') : summary.savedPath ? t('large-chart.saved') : t('large-chart.notSaved')}`;
    this.button.classList.toggle('active', this.document.busy || this.loadingPage);
    this.button.title = `${t('large-chart.title')} · ${this.document.busy ? t('large-chart.committing') : this.loadingPage ? t('large-chart.loading') : summary.total.toLocaleString() + ' ' + t('large-chart.notes')}`;
  }
  handleError(error) {
    if (this.disposed || this.closing) return;
    if (/可见编辑区的不同音符过多|编辑页属性超过/.test(error.message) && this.timeline.scale < 2000) {
      this.scaleBeforeAutomaticZoom ??= this.timeline.scale;
      this.timeline.scale = this.lastAutomaticScale = Math.min(2000, this.timeline.scale * 2);
      this.document.failedRead = null;
      for (const id of ['y-scale', 'y-scale-slider']) document.getElementById(id).value = String(this.timeline.scale);
      this.button.title = t('large-chart.autoZoom', { scale: this.timeline.scale });
      this.invalidate(); return;
    }
    this.reportError(error);
  }
  range() {
    const indices = this.session.multiLineActive && this.session.multiLineMode === 'notes' ? this.session.targetLineIndices : [this.session.lineIndex];
    const ranges = indices.map(index => this.timeline.beatRangeForLine(index));
    return { lines: [...indices].sort((a, b) => a - b), start: ranges.length ? Math.min(...ranges.map(range => range[0])) : 0, end: ranges.length ? Math.max(...ranges.map(range => range[1])) : 0 };
  }
  tick(seconds) {
    if (this.disposed || this.closing) return;
    const preview = this.previews[0];
    const footprint = `${preview.aspectRatio}:${preview.viewDivisor}:${this.previews.some(view => view.visible && view.showHitEffects)}`;
    if (this.windowFootprint !== footprint) { this.windowFootprint = footprint; this.view.set(null); this.failedWindow = null; }
    const range = this.range(), loading = !this.document.covers(range);
    if (loading !== this.loadingPage) { this.loadingPage = loading; this.update(); }
    this.document.ensurePage(range);
    const soundsReady = !this.playback.sounds.enabled || this.hitSounds.contains(seconds);
    if (!this.view.contains(seconds) || !soundsReady) this.playback.waitForData();
    if (soundsReady) this.hitSounds.tick(seconds);
    this.hitSounds.ensure(seconds).catch(this.reportError);
    if (this.document.busy) return;
    if (this.view.contains(seconds) && soundsReady && this.playback.buffering) this.playback.resumeWhenReady().catch(this.reportError);
    const overlap = this.view.buffer ? Math.min(.25, (this.view.buffer.end - this.view.buffer.seconds) / 2) : 0;
    if (!this.view.contains(seconds) || this.audio.playing && seconds > this.view.buffer.end - overlap) this.readPreview(seconds).catch(this.reportError);
  }
  async prepareRecordingFrame(seconds) {
    const preview = this.previews[0];
    const footprint = `${preview.aspectRatio}:${preview.viewDivisor}:${this.previews.some(view => view.visible && view.showHitEffects)}`;
    if (this.windowFootprint !== footprint) { this.windowFootprint = footprint; this.view.set(null); this.failedWindow = null; }
    await this.document.pending;
    await this.document.ensurePage(this.range());
    if (!this.document.covers(this.range())) throw Error('超大谱当前编辑页尚未就绪，请结束拖拽或等待数据加载');
    if (this.windowRequest) await this.windowRequest;
    if (!this.view.contains(seconds)) await this.readPreview(seconds, { recording: true });
    if (!this.view.contains(seconds)) throw Error('超大谱预览数据尚未就绪');
  }
  async readPreview(seconds, { recording = false } = {}) {
    if (this.windowRequest) return this.windowRequest;
    if (this.failedWindow === `${this.document.revision}:${seconds}`) return;
    const revision = this.document.revision, footprint = this.windowFootprint;
    if (!recording && !this.view.contains(seconds)) this.playback.waitForData();
    this.windowRequest = (async () => {
      try {
        const preview = this.previews[0], scale = previewPositionScale(preview.aspectRatio ?? 1.5);
        const runtime = new SceneRuntime(); runtime.compile(this.document.header, this.session.tempo);
        const maximum = Math.max(0, ...runtime.sample(seconds).map(state => Math.hypot(state.x, state.y)));
        const radius = Math.min(20000, (2000 * Math.max(1, preview.viewDivisor ?? 1) + maximum) / scale.y);
        const historySpan = this.previews.some(preview => preview.visible && preview.showHitEffects) ? .75 : 0;
        let span = this.prefetchSpan ?? .75, value;
        for (;;) {
          try { value = await largeChartCommand('window', this.document.summary.id, { seconds, span, radius, historySpan }); break; }
          catch (error) { if (!/不同音符组超过/.test(error.message) || span < .025) throw error; span /= 2; }
        }
        this.prefetchSpan = value.noteCount < 12000 ? Math.min(.75, span * 2) : span;
        if (this.disposed || this.closing || revision !== this.document.revision || footprint !== this.windowFootprint) return;
        this.view.set(value); this.invalidate();
        const current = this.audio.time - (this.document.header.META.offset ?? 0) / 1000;
        if (!recording && this.view.contains(current) && (!this.playback.sounds.enabled || this.hitSounds.contains(current))) await this.playback.resumeWhenReady();
      } catch (error) { if (this.disposed || this.closing) return; this.failedWindow = `${revision}:${seconds}`; this.playback.pause(); throw error; }
      finally { this.windowRequest = null; }
    })();
    return this.windowRequest;
  }
  async close({ discard = false } = {}) {
    this.closing = true; this.playback.pause(); this.audio.clear();
    await this.document.pending.catch(() => {});
    await largeChartCommand('close', this.document.summary.id, { discard }); this.dispose();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.hitSounds.dispose(); this.document.dispose(); this.view.dispose(); this.host.remove(); this.button.remove();
    window.removeEventListener('pointerdown', this.dismiss, true); window.removeEventListener('keydown', this.dismissKey, true);
    if (this.scaleBeforeAutomaticZoom !== undefined && this.timeline.scale === this.lastAutomaticScale) {
      this.timeline.scale = this.scaleBeforeAutomaticZoom;
      for (const id of ['y-scale', 'y-scale-slider']) document.getElementById(id).value = String(this.timeline.scale);
    }
    for (const type of ['pointerdown', 'mousedown', 'click', 'contextmenu', 'keydown', 'input', 'change']) window.removeEventListener(type, this.blockInput, true);
    for (const preview of this.previews) { preview.largeChartView = null; preview.noteBatch.dispose?.(); preview.noteBatch = new NoteSpriteBatch(); preview.scene = new SceneRuntime(); preview.preparedChart = null; preview.largeGeneration = null; }
  }
}
