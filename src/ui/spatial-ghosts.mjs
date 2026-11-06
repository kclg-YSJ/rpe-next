import { largeChartCommand } from '../platform/native.mjs';
import { LargeChartView } from './large-chart-view.mjs';
import { SceneRuntime } from '../core/scene.mjs';
import { NotePreview } from '../core/note-preview.mjs';
import { SpatialNoteSprites } from './spatial-note-sprites.mjs';
import { spatialGhostTimes, spatialBoundaryFade } from './spatial-display.mjs';
import { t } from '../i18n.mjs';

export class SpatialGhosts {
  constructor(invalidate, fail) {
    this.invalidate = invalidate; this.fail = fail; this.entries = new Map(); this.generation = 0; this.layers = new Map(); this.samples = new Map(); this.quads = 0;
  }
  surfaces(renderer) {
    let layer = this.layers.get(renderer); if (layer) return layer;
    layer = {};
    for (const side of ['far', 'near']) {
      const canvas = document.createElement('canvas'); canvas.className = 'spatial-layer spatial-ghost';
      canvas.style.zIndex = side === 'far' ? '0' : '3'; renderer.canvas.parentElement.append(canvas);
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
      if (!gl) { canvas.remove(); throw Error(t('spatial.notesContext')); }
      layer[side] = { canvas, sprites: new SpatialNoteSprites(gl, canvas) };
    }
    this.layers.set(renderer, layer); return layer;
  }
  draw(renderer, tempo, current, camera, scale, positionScale, options, progress) {
    const layer = this.surfaces(renderer), mapping = renderer.spatialMapping;
    const signature = [renderer.chart, renderer.scene, renderer.skin, renderer.aspectRatio, scale, mapping, renderer.largeChartView?.owner.revision,renderer.noteSize,renderer.highlight];
    if (!this.signature || signature.some((v, i) => v !== this.signature[i])) { this.samples.clear(); this.quads = 0; this.signature = signature; this.sampleLimit=192; }
    const times = spatialGhostTimes(current, options,this.sampleLimit).sort((a, b) => Math.abs(a.beat - current) - Math.abs(b.beat - current));
    const wanted=new Set(times.map(time=>time.beat));
    for(const[beat,sample]of this.samples)if(!wanted.has(beat)){this.quads-=sample.commands.length;this.samples.delete(beat);}
    const until = performance.now() + 4; this.pending = false;
    for (const time of times) {
      if (this.samples.has(time.beat)) continue;
      if (performance.now() >= until) { this.pending = true; break; }
      const source = this.get(renderer, tempo, time.beat);
      if (!source) { this.pending = true; break; }
      const seconds = tempo.seconds(time.beat), ghost = Object.create(renderer), scene = source.scene;
      ghost.scene = scene; ghost.noteDraft = new NotePreview(); ghost.noteDraft.update(scene, null);
      ghost.spatialForeground = false; ghost.spatialElements = null;
      ghost.simultaneous = source.simultaneous ?? renderer.simultaneous; ghost.simultaneousCounts = source.simultaneousCounts ?? renderer.simultaneousCounts;
      ghost.passes = renderer.passes.filter(pass => pass.kind !== 'line'); ghost.showHitEffects = false; ghost.allLines = true;
      ghost.noteBatch = { failed: true }; ghost.noteHitAreas = []; ghost.noteCenters = null; ghost.noteOpacity = 1;
      const frame = { width: camera.width, height: camera.height, scale, divisor: renderer.viewDivisor ?? 1, viewport: renderer.viewport, states: scene.sample(seconds, positionScale), positionScale, cullNotes: true };
      const commands = layer.far.sprites.capture(context => renderer.constructor.prototype.drawScene.call(ghost, context, renderer.chart, tempo, seconds, -1, frame), frame);
      if(commands.length>60000)throw Error(t('spatial.notesBudget'));
      const limit=Math.max(2,Math.floor(120000/Math.max(1,commands.length))-1);
      if(limit<this.sampleLimit){this.sampleLimit=limit;this.samples.clear();this.quads=0;this.pending=true;break;}
      // An enabled chart camera is evaluated at each sample's time, before the editor camera.
      if (mapping) for (const c of commands) {
        const points=c.points.map(p=>{const q=mapping.project(p,seconds,frame,renderer.chart,tempo);return q&&{...p,x:q.x,y:q.y};});
        if(points.some(p=>!p)){c.color[3]=0;continue;}c.points=points;
      }
      const sample = { ...time, commands }; this.samples.set(time.beat, sample); this.quads += commands.length;
      while (this.samples.size > 256 || this.quads > 120000 && this.samples.size > 1) {
        const key = this.samples.keys().next().value; this.quads -= this.samples.get(key).commands.length; this.samples.delete(key);
      }
    }
    for (const side of ['far', 'near']) { layer[side].canvas.hidden = false; layer[side].sprites.start(camera,current,scale,options,progress,this.quads); }
    for (const time of [...times].sort((a,b)=>b.beat-a.beat)) {
      const sample = this.samples.get(time.beat); if (!sample) continue;
      const opacity = Math.min(.85, time.weight * 2.5) * Math.exp(-Math.abs(time.beat - current) * options.fade) * spatialBoundaryFade(time.beat, current, options.past, options.future) * progress;
      if (opacity < .00005) continue;
      layer[time.beat < current ? 'near' : 'far'].sprites.replay(sample);
    }
    for (const side of ['far', 'near']) layer[side].sprites.finish();
    if (this.pending) this.invalidate();
  }
  get(renderer, tempo, beat) {
    if (!renderer.largeChartView) return { scene: renderer.scene };
    const owner = renderer.largeChartView.owner, revision = owner.revision, seconds = Math.floor(tempo.seconds(beat));
    const key = `${revision}:${seconds}:${renderer.viewDivisor}:${renderer.aspectRatio}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, owner, revision, tempo, renderer, seconds, status: 'waiting' }; this.entries.set(key, entry);
      while (this.entries.size > 8) { const first = this.entries.keys().next().value; this.entries.get(first).view?.dispose(); this.entries.delete(first); }
      this.pump();
    }
    if(entry.status==='ready'){entry.view.prepare(entry.preview,renderer.chart,tempo);return entry.preview;}return null;
  }
  async pump() {
    if (this.running || this.disposed) return;
    const entry = [...this.entries.values()].find(e => e.status === 'waiting'); if (!entry) return;
    this.running = true; entry.status = 'loading'; const generation = this.generation;
    try {
      const value = await largeChartCommand('window', entry.owner.summary.id, { seconds: entry.seconds, span: 1, radius: Math.min(20000, 2000 * Math.max(1, entry.renderer.viewDivisor ?? 1)), historySpan: 0 });
      if (this.disposed || generation !== this.generation || entry.owner.revision !== entry.revision || !this.entries.has(entry.key)) return;
      const view = new LargeChartView(entry.owner), preview = { scene: new SceneRuntime(), noteDraft: new NotePreview() };
      view.set(value); view.prepare(preview, entry.owner.session.chart, entry.tempo);
      entry.view = view; entry.preview = preview; entry.status = 'ready'; this.invalidate();
    } catch (error) { entry.status = 'failed'; if (!this.disposed) this.fail(error); }
    finally { this.running = false; if (!this.disposed) this.pump(); }
  }
  hide(renderer) { const layer = this.layers.get(renderer); if (layer) for (const side of ['far', 'near']) layer[side].canvas.hidden = true; }
  dispose() {
    this.disposed = true; this.generation++;
    for (const entry of this.entries.values()) entry.view?.dispose(); this.entries.clear(); this.samples.clear();
    for (const layer of this.layers.values()) for (const side of ['far', 'near']) { layer[side].sprites.dispose(); layer[side].canvas.remove(); }
    this.layers.clear();
  }
}
