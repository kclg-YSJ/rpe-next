export const PERFORMANCE_METRICS = ['appCpu', 'systemCpu', 'appMemory', 'systemMemory', 'gpu', 'gpuMemory', 'heap'];

export class PerformanceFrameWindow {
  constructor() { this.last = null; this.clear(); }
  clear() { this.count = 0; this.elapsed = 0; this.renderTotal = 0; this.renderMax = 0; this.renders = 0; }
  frame(now, renderMs) {
    if (this.last !== null && now > this.last) { this.elapsed += now - this.last; this.count++; }
    this.last = now; this.renderTotal += renderMs; this.renderMax = Math.max(this.renderMax, renderMs); this.renders++;
  }
  sample() {
    const result = { fps: this.elapsed ? this.count * 1000 / this.elapsed : null, render: this.renders ? this.renderTotal / this.renders : null, peak: this.renders ? this.renderMax : null };
    if (!this.renders) this.last = null;
    this.clear(); return result;
  }
}

export class PerformanceSeries {
  constructor(capacity = 240) { this.values = new Float32Array(capacity); this.length = 0; this.cursor = 0; }
  push(value) { this.values[this.cursor] = value; this.cursor = (this.cursor + 1) % this.values.length; this.length = Math.min(this.length + 1, this.values.length); }
  at(index) { return this.values[(this.cursor - this.length + this.values.length + index) % this.values.length]; }
  clear() { this.length = this.cursor = 0; }
}

export class PerformanceRun {
  constructor(now, metadata = {}) {
    this.start = now; this.metadata = metadata; this.frames = 0; this.renderTotal = 0; this.renderMax = 0;
    this.frameElapsed = 0; this.lastFrame = null; this.histogram = new Uint32Array(40001); this.intervals = 0;
    this.metrics = Object.fromEntries(PERFORMANCE_METRICS.map(key => [key, { sum: 0, weight: 0, peak: 0 }]));
    this.points = []; this.level = 0; this.pending = null; this.lastHardware = null;
  }
  frame(now, renderMs) {
    this.frames++; this.renderTotal += renderMs; this.renderMax = Math.max(this.renderMax, renderMs);
    if (this.lastFrame !== null && now > this.lastFrame) {
      const elapsed = now - this.lastFrame; this.frameElapsed += elapsed; this.intervals++;
      this.histogram[Math.min(this.histogram.length - 1, Math.round(elapsed * 4))]++;
    }
    this.lastFrame = now;
  }
  hardware(now, values) {
    this.integrateHardware(now);
    this.lastHardware = { now, values };
    for (const key of PERFORMANCE_METRICS) if (Number.isFinite(values[key])) this.metrics[key].peak = Math.max(this.metrics[key].peak, values[key]);
  }
  integrateHardware(now) {
    if (!this.lastHardware) return;
    const weight = Math.min(2000, Math.max(0, now - this.lastHardware.now));
    for (const key of PERFORMANCE_METRICS) {
      const value = this.lastHardware.values[key]; if (!Number.isFinite(value)) continue;
      this.metrics[key].sum += value * weight; this.metrics[key].weight += weight;
    }
    this.lastHardware.now = now;
  }
  point(seconds, fps) {
    const point = { seconds, fps, count: 1 };
    if (this.level) {
      if (!this.pending) this.pending = point;
      else { this.pending.fps += fps; this.pending.count++; this.pending.seconds = seconds; }
      if (this.pending.count < 2 ** this.level) return;
      point.fps = this.pending.fps / this.pending.count; this.pending = null;
    }
    this.points.push(point);
    if (this.points.length >= 512) {
      this.points = this.points.filter((_, i) => i % 2 === 0).map((p, i) => ({ seconds: this.points[i * 2 + 1].seconds, fps: (p.fps + this.points[i * 2 + 1].fps) / 2, count: 1 })); this.level++;
    }
  }
  finish(now, reason, position = 0) {
    this.integrateHardware(now);
    const percentile = fraction => {
      let count = 0; const target = Math.ceil(this.intervals * fraction);
      if (!target) return null;
      for (let i = 1; i < this.histogram.length; i++) { count += this.histogram[i]; if (count >= target) return i / 4; }
      return null;
    };
    let needed = Math.ceil(this.intervals * .01), slowCount = 0, slowTime = 0;
    for (let i = this.histogram.length - 1; i > 0 && needed > 0; i--) { const count = Math.min(needed, this.histogram[i]); slowCount += count; slowTime += count * i / 4; needed -= count; }
    const elapsed = Math.max(0, now - this.start);
    return { ...this.metadata, reason, position, elapsed, frames: this.frames, averageFps: this.frameElapsed ? this.intervals * 1000 / this.frameElapsed : 0,
      lowFps: slowTime ? slowCount * 1000 / slowTime : null, frameP95: percentile(.95), renderAverage: this.frames ? this.renderTotal / this.frames : 0, renderMax: this.renderMax,
      metrics: Object.fromEntries(PERFORMANCE_METRICS.map(key => [key, { average: this.metrics[key].weight ? this.metrics[key].sum / this.metrics[key].weight : null, peak: this.metrics[key].weight ? this.metrics[key].peak : null }])),
      points: [...this.points, ...(this.pending ? [{ seconds: this.pending.seconds, fps: this.pending.fps / this.pending.count }] : [])] };
  }
}
