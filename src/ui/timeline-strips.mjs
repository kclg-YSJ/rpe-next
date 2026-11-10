import { editorSkinContext, editorCanvasRevision } from './editor-skin-canvas.mjs';
import { clipboardTimeRange } from '../application/clipboard-time-range.mjs';
import { easing } from '../core/easing.mjs';
import { DEFAULT_TIMELINE_STRIPS } from '../core/timeline-strip-settings.mjs';
import { drawSelectionRange, stripRangeRectangle, CLIPBOARD_RANGE_COLOR } from './selection-range-strip.mjs';

export const TIMELINE_STRIP_COLOR = '#ccb200';

export function drawStripDensity(context, width, height, density, brightness = DEFAULT_TIMELINE_STRIPS.densityStripBrightness) {
  const { bins, noteBins, eventBins } = density;
  const notes = Math.log1p(density.noteMaximum ?? density.maximum), events = Math.log1p(density.eventMaximum ?? density.maximum);
  const half = width / 2, step = height / bins, ratio = context.getTransform?.().d || globalThis.devicePixelRatio || 1;
  context.save(); context.fillStyle = TIMELINE_STRIP_COLOR;
  for (let index = 0; index < bins; index++) {
    // Adjacent bins meet exactly, including at fractional device pixel ratios.
    const y = Math.round((height - (index + 1) * step) * ratio) / ratio;
    const size = Math.round((height - index * step) * ratio) / ratio - y;
    if (size <= 0) continue;
    if (noteBins[index]) { context.globalAlpha = brightness * (Math.log1p(noteBins[index]) / notes) ** 2; context.fillRect(0, y, half, size); }
    if (eventBins[index]) { context.globalAlpha = brightness * (Math.log1p(eventBins[index]) / events) ** 2; context.fillRect(half, y, width - half, size); }
  }
  context.restore();
}

export function drawStripHistory(context, width, height, duration, commands, lineIndices) {
  const visible = new Set(lineIndices), entries = [];
  for (const command of commands) {
    const ranges = command.ranges?.filter(range => visible.has(range.lineIndex)) ?? (command.lineIndex === undefined || visible.has(command.lineIndex) ? [command] : []);
    if (ranges.length) entries.push({ command, ranges });
  }
  context.save(); context.fillStyle = TIMELINE_STRIP_COLOR;
  for (const [index, { command, ranges }] of entries.entries()) {
    const age = (index + 1) / entries.length;
    const opacity = Math.max(.3, easing(age, 2));
    context.globalAlpha = command.point || command.start === command.end ? opacity : Math.max(.2, opacity * .5);
    for (const range of ranges) {
      const rectangle = stripRangeRectangle(width, height, duration, range.start, range.end);
      if (rectangle.height > 0) context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    }
  }
  context.restore();
}

export function drawStripMarker(context, width, height, duration, seconds) {
  const y = height - Math.max(0, Math.min(duration, seconds)) / duration * height;
  context.save(); context.strokeStyle = '#ffffff'; context.globalAlpha = .8; context.lineWidth = 1;
  context.strokeRect(.5, Math.max(.5, Math.min(height - 2.5, y - 1)), Math.max(0, width - 1), 2); context.restore();
}

function backing(width, height, role) {
  const canvas = document.createElement('canvas'), ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  // Older Classic packages recolor their own legacy rasters. The shared host
  // renderer already supplies the colour and squared opacity for this raster.
  if (role === 'density') canvas.dataset.timelineDensity = 'rpe';
  const context = editorSkinContext(canvas.getContext('2d'), role); context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  return { canvas, context };
}

function prepareStrip(canvas, width, height) {
  const ratio = globalThis.devicePixelRatio || 1, pixelsWide = Math.round(width * ratio), pixelsHigh = Math.round(height * ratio);
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) { canvas.width = pixelsWide; canvas.height = pixelsHigh; }
  const context = canvas.getContext('2d');
  // Clear every backing pixel; a CSS-sized clear leaves a fractional fringe
  // when CSS dimensions times devicePixelRatio round up.
  context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  return editorSkinContext(context);
}

export class TimelineStrips {
  constructor(density, history) { this.density = density; this.history = history; this.options = DEFAULT_TIMELINE_STRIPS; }
  draw(session, tempo, activity, duration, seconds, selectionRange, layer = 0, extended = false) {
    const options = this.options;
    if (!options.densityStrip && !options.historyStrip) { this.note = this.edits = this.key = null; return; }
    const dw = options.densityStrip ? this.density.clientWidth : 0, dh = options.densityStrip ? this.density.clientHeight : 0, hw = options.historyStrip ? this.history.clientWidth : 0, hh = options.historyStrip ? this.history.clientHeight : 0;
    if (!(dw > 0 && dh > 0 || hw > 0 && hh > 0)) return;
    const multi = session.multiLineActive, order = multi ? session.multiLineIndices : session.lineIndex;
    const commands = session.recentEdits ?? [], revision = editorCanvasRevision(), ratio = globalThis.devicePixelRatio || 1;
    const key = [session.chart, tempo, order, layer, extended, duration, dw, dh, hw, hh, revision, ratio, commands.length, commands.at(-1), options.densityStripBrightness, options.densityStripWindow];
    if (!this.key || key.some((value, i) => value !== this.key[i])) {
      if (dw && dh) activity.compile(session.chart, tempo);
      this.note = dw && dh ? backing(dw, dh, 'density') : null;
      this.edits = hw && hh ? backing(hw, hh, 'history') : null;
      if (this.note) drawStripDensity(this.note.context, dw, dh, activity.density(order, layer, extended, duration, dh, options.densityStripWindow), options.densityStripBrightness);
      if (this.edits) drawStripHistory(this.edits.context, hw, hh, duration, commands, multi ? order : [order]);
      this.key = key;
    }
    for (const [canvas, picture, width, height] of [[this.density, this.note, dw, dh], [this.history, this.edits, hw, hh]]) {
      if (!picture || !(width > 0 && height > 0)) continue;
      const context = prepareStrip(canvas, width, height);
      canvas.getContext('2d').drawImage(picture.canvas, 0, 0, width, height);
      drawStripMarker(context, width, height, duration, seconds);
      if (canvas === this.history) {
        drawSelectionRange(context, width, height, duration, selectionRange);
        drawSelectionRange(context, width, height, duration, clipboardTimeRange(session, tempo), CLIPBOARD_RANGE_COLOR);
      }
    }
  }
}
