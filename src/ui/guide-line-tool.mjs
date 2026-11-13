import { beatValue, fromNumber, upperBound } from '../core/beat.mjs';
import { GUIDE_LINES_KEY, guidePosition, guideLinesInRange, assertGuideLine, changeGuideLine, projectGuideLine } from '../core/guide-lines.mjs';
import { rebaseCustomEventValues } from '../core/event-easing.mjs';
import { captureGuideFollowers, previewGuideFollowers, commitGuideLine } from '../application/guide-line-commands.mjs';
import { renderGuideLineInspector } from './guide-line-inspector.mjs';
import { t } from '../i18n.mjs';
import { originalEditorContext } from './editor-skin-canvas.mjs';

const segmentDistance = (point, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const u = d ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / d)) : 0;
  return Math.hypot(point.x - a.x - u * dx, point.y - a.y - u * dy);
};
const strokePath = (context, path) => {
  if (path.geometry) { context.stroke(path.geometry); return; }
  context.beginPath(); path.points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
};

// A timeline tool only: it never runs from the playback or scene pipeline.
export class GuideLineTool {
  constructor(timeline, getSession, container, { activate, invalidate, reportError, enabled = () => true }) {
    Object.assign(this, { timeline, getSession, container, activate, invalidate, reportError, enabled });
    this.selected = null; this.adding = null; this.draft = null; this.drag = null;
    this.galleryState = { open: false };
  }
  get active() { return Boolean(this.selected || this.adding); }
  get animating() {
    if (this.timeline.guideLineBrightness === 0) return false;
    if (!this.selected && !this.snapFeedback) return false;
    if (!this.getSession().chart[GUIDE_LINES_KEY]?.length) { this.snapFeedback = null; return false; }
    if (!this.snapFeedback && this.selectedVisible === false) return false;
    return this.enabled();
  }
  read(id = this.selected) { return this.pendingCommit?.id === id ? this.pendingCommit.next : this.getSession().chart[GUIDE_LINES_KEY]?.find(guide => guide.id === id); }
  get guide() { return this.draft?.next ?? this.read(); }
  get noteOverrides() { return this.draft?.overrides ?? this.pendingCommit?.overrides; }
  get clipboardShowing() { return Boolean(this.clipboard && this.clipboardVisible && !this.adding && !this.drag && this.timeline.hoverArea !== 'events'); }
  clearClipboard() { this.clipboard = null; this.clipboardVisible = false; this.clipboardProjection = null; this.geometry = null; this.invalidate(); }
  copy(cut = false) {
    const source = this.guide; if (!source) return false;
    if (this.pendingCommit || this.getSession().largeDocument?.busy) throw Error(t('guide-lines.busy'));
    this.clipboard = structuredClone(source); this.clipboardVisible = true; this.clipboardProjection = null;
    this.getSession().clipboardVisible = false; this.timeline.clipboardMode = {};
    if (cut) this.remove();
    this.geometry = null; this.invalidate(); return true;
  }
  projectClipboard(options = this.timeline.clipboardMode ?? {}) {
    if (!this.clipboard) return null;
    const timeline = this.timeline, session = this.getSession(), point = timeline.clipboardPointer ?? timeline.cursor;
    const lineIndex = point ? timeline.lineIndexAt(point.x, timeline.notesCanvas.clientWidth, 'notes') : session.lineIndex;
    if (!session.chart.judgeLineList?.[lineIndex]) return null;
    const beat = point ? timeline.noteBeatAt(point.y, lineIndex) : Math.max(0, timeline.origin);
    const key = [this.clipboard, beat, lineIndex, Boolean(options.mirror), Boolean(options.keepTime)];
    if (this.clipboardProjection && key.every((value, i) => value === this.clipboardProjection.key[i])) return this.clipboardProjection;
    return this.clipboardProjection = { key, lineIndex, guide: projectGuideLine(this.clipboard, beat, { ...options, id: '__guide-clipboard-preview' }) };
  }
  insert(guide) {
    const session = this.getSession();
    if (session.largeDocument) {
      const document = session.largeDocument;
      if (commitGuideLine(session, guide.id, guide) === false) throw Error(t('guide-lines.busy'));
      this.clear(); document.flush().then(() => { if (this.getSession() === session && session.chart[GUIDE_LINES_KEY]?.some(current => current.id === guide.id)) this.select(guide.id); }).catch(this.reportError);
    } else { commitGuideLine(session, guide.id, guide); this.select(guide.id); }
  }
  paste(mirror = false, keepTime = false) {
    if (!this.clipboard || !this.enabled()) return false;
    if (this.pendingCommit || this.getSession().largeDocument?.busy) throw Error(t('guide-lines.busy'));
    this.timeline.clipboardMode = { mirror, keepTime }; this.clipboardVisible = true;
    const projected = this.projectClipboard(); if (!projected) return false;
    const guide = structuredClone({ ...projected.guide, id: crypto.randomUUID() });
    this.insert(guide); this.invalidate(); return true;
  }
  point(position, lineIndex = this.timeline.lineIndexAt(position.x, this.timeline.notesCanvas.clientWidth, 'notes'), excludeId = null) {
    const timeline = this.timeline;
    const side = timeline.noteView?.flow ? timeline.noteView.sideAt(position.y) : 1;
    const beat = timeline.noteBeatAt(position.y, lineIndex, side);
    const x = timeline.notePositionAt(position.x, lineIndex, beat, excludeId);
    return { beat, x, lineIndex, side };
  }
  begin(point) {
    if (!this.enabled()) return;
    this.clear(); this.timeline.cancelPlacement();
    this.activate('chart');
    this.adding = { ...point, chart: this.getSession().chart }; this.endpoint = { ...point };
    this.timeline.notesCanvas.style.cursor = 'crosshair';
    this.invalidate();
  }
  select(id) {
    this.clear(); this.timeline.cancelPlacement();
    const session = this.getSession(); this.selected = id;
    session.selection.clear(); session.eventSelection.clear(); session.multiLineSelection.clear(); session.multiEventSelection.clear(); session.multiSelectionIntent = null;
    session.focus = 'notes'; this.activate('guide-line'); session.notify(); this.sync();
  }
  clear() {
    if (this.drag && this.timeline.notesCanvas.hasPointerCapture?.(this.drag.pointerId)) this.timeline.notesCanvas.releasePointerCapture(this.drag.pointerId);
    this.cancelDraft(); this.selected = null; this.adding = null; this.endpoint = null; this.drag = null;
    this.pendingCommit = null;
    this.snapFeedback = null; this.lastSnapSignature = null;
    this.selectedVisible = false;
    this.geometry = null; this.renderedGuide = null; this.timeline.notesCanvas.style.cursor = 'default'; this.invalidate();
  }
  sync() {
    if (this.adding && this.adding.chart !== this.getSession().chart) this.adding = null;
    if (this.draft && this.draft.chart !== this.getSession().chart) { this.cancelDraft(); this.drag = null; }
    const guide = this.guide;
    if (this.selected && !guide) { this.clear(); this.activate('chart'); return; }
    if (guide && guide !== this.renderedGuide && !this.editingInput) {
      this.renderedGuide = guide; renderGuideLineInspector(this, this.container);
    }
  }
  beginDraft() {
    if (this.draft) return this.draft;
    if (this.pendingCommit || this.getSession().largeDocument?.busy) throw Error(t('guide-lines.busy'));
    const session = this.getSession(), before = this.guide; if (!before) return null;
    this.draft = { chart: session.chart, before, next: before, followers: null, overrides: null };
    session.liveNoteEdit = true; return this.draft;
  }
  update(patch, { preview = false } = {}) {
    const draft = this.beginDraft(); if (!draft) return;
    const next = typeof patch === 'function' ? assertGuideLine(rebaseCustomEventValues(draft.next, patch(draft.next))) : changeGuideLine(draft.next, patch);
    if (JSON.stringify(draft.next) === JSON.stringify(next)) { if (!preview) this.finishDraft(); return; }
    draft.followers ??= captureGuideFollowers(draft.chart, draft.before);
    draft.next = next; draft.overrides = previewGuideFollowers(draft.followers, draft.before, next);
    this.geometry = null; this.invalidate();
    if (!preview) this.finishDraft();
  }
  finishDraft() {
    const draft = this.draft; if (!draft) return;
    this.draft = null; this.getSession().liveNoteEdit = false;
    if (this.getSession().chart !== draft.chart) throw Error(t('guide-lines.stale'));
    if (JSON.stringify(draft.before) !== JSON.stringify(draft.next)) {
      const session = this.getSession(), id = this.selected, document = session.largeDocument;
      if (document) {
        const pending = this.pendingCommit = { id, next: draft.next, overrides: draft.overrides };
        if (commitGuideLine(session, id, draft.next, draft.followers) === false) { this.pendingCommit = null; throw Error(t('guide-lines.stale')); }
        document.flush().catch(this.reportError).finally(() => {
          if (this.pendingCommit !== pending) return;
          this.pendingCommit = null; this.renderedGuide = null; this.sync(); this.invalidate();
        });
      } else commitGuideLine(session, id, draft.next, draft.followers);
    }
    this.renderedGuide = null; this.geometry = null; this.invalidate();
  }
  cancelDraft() { this.draft = null; this.editingInput = false; this.getSession().liveNoteEdit = false; this.geometry = null; this.invalidate(); }
  indicateSnap(x, beat, lineIndex, side = 1, force = false) {
    const timeline = this.timeline, guides = this.getSession().chart[GUIDE_LINES_KEY];
    if (!timeline.snapX || !guides?.length) return;
    const guide = guideLinesInRange(guides, beat).find(guide => Math.abs(guidePosition(guide, beat) - x) <= 1e-5);
    if (!guide) { this.lastSnapSignature = null; return; }
    const signature = `${guide.id}:${lineIndex}:${side}:${beat}:${x}`;
    if (!force && signature === this.lastSnapSignature && this.snapFeedback && performance.now() < this.snapFeedback.until) return;
    this.lastSnapSignature = signature;
    this.snapFeedback = { id: guide.id, beat, lineIndex, side, until: performance.now() + 650 };
    this.invalidate();
  }
  remove() {
    const id = this.selected; if (!id) return;
    if (this.pendingCommit || this.getSession().largeDocument?.busy) throw Error(t('guide-lines.busy'));
    this.cancelDraft(); commitGuideLine(this.getSession(), id, null); this.clear(); this.activate('chart');
  }
  action(action) {
    if (action === 'Esc' && (this.active || this.clipboardShowing)) {
      const active = this.active; this.clipboardVisible = false; this.clear(); if (active) this.activate('chart'); return active;
    }
    if (!this.enabled()) return false;
    if (['Delete', 'QuickDelete'].includes(action) && this.selected) { this.remove(); return true; }
    if (['Copy', 'Shear'].includes(action) && this.selected) return this.copy(action === 'Shear');
    if (this.clipboard && !this.adding && this.timeline.hoverArea !== 'events' && ['Paste', 'PasteMirror', 'KeepTimePaste', 'KeepTimePasteMirror'].includes(action)) return this.paste(action.endsWith('Mirror'), action.startsWith('KeepTime'));
    if (!this.active) return false;
    if (this.adding && ['AddTap', 'AddDrag', 'AddFlick', 'AddHold', 'AddEvent'].includes(action)) return true;
    return false;
  }
  down(event, position, noteHit) {
    if (event.button !== 0 || !this.enabled()) return false;
    if (this.adding) {
      if (this.adding.chart !== this.getSession().chart) { this.clear(); throw Error(t('guide-lines.stale')); }
      const first = this.adding, last = this.point(position, first.lineIndex);
      if (Math.abs(first.beat - last.beat) < 1e-8) throw Error(t('guide-lines.duration'));
      const [a, b] = first.beat < last.beat ? [first, last] : [last, first];
      const guide = { id: crypto.randomUUID(), startTime: fromNumber(a.beat), endTime: fromNumber(b.beat), start: a.x, end: b.x,
        easingType: 1, easingLeft: 0, easingRight: 1, bezier: 0, bezierPoints: [0, 0, 1, 1], keepSnapped: true };
      this.insert(guide);
      return true;
    }
    if (noteHit || this.timeline.tool || this.timeline.pendingHold) { if (this.selected) this.clear(); return false; }
    if (event.ctrlKey || event.shiftKey) return false;
    const hit = this.hit(position); if (!hit) return false;
    if (hit.guide.id !== this.selected) this.select(hit.guide.id);
    this.beginDraft(); this.drag = { endpoint: hit.endpoint ?? 'body', lineIndex: hit.lineIndex, side: hit.side, pointerId: event.pointerId,
      start: position, origin: this.point(position, hit.lineIndex, hit.guide.id), moved: false };
    this.timeline.notesCanvas.setPointerCapture?.(event.pointerId);
    return true;
  }
  move(position) {
    if (this.adding) {
      const next = this.point(position, this.adding.lineIndex);
      if (!this.endpoint || next.beat !== this.endpoint.beat || next.x !== this.endpoint.x) { this.endpoint = next; this.geometry = null; this.invalidate(); }
      return true;
    }
    if (!this.drag) return false;
    if (Math.hypot(position.x - this.drag.start.x, position.y - this.drag.start.y) < 3 && !this.drag.moved) return true;
    this.drag.moved = true;
    const point = this.point(position, this.drag.lineIndex, this.selected), start = this.drag.endpoint === 'start';
    let next;
    if (this.drag.endpoint === 'body') {
      const before = this.draft.before, first = beatValue(before.startTime), last = beatValue(before.endTime);
      const deltaBeat = Math.max(-first, point.beat - this.drag.origin.beat), deltaX = point.x - this.drag.origin.x;
      next = { startTime: fromNumber(first + deltaBeat), endTime: fromNumber(last + deltaBeat), start: before.start + deltaX, end: before.end + deltaX };
    } else next = { [start ? 'startTime' : 'endTime']: fromNumber(point.beat), [start ? 'start' : 'end']: point.x };
    try { this.update(next, { preview: true }); this.drag.error = null; }
    catch (error) { this.drag.error = error; }
    return true;
  }
  up(event) {
    if (!this.drag) return false;
    try {
      this.move(this.timeline.point(event));
      if (this.drag.error) { const error = this.drag.error; this.cancelDraft(); throw error; }
      this.finishDraft();
    } finally { this.drag = null; this.timeline.notesCanvas.releasePointerCapture?.(event.pointerId); this.sync(); }
    return true;
  }
  paths(width, height) {
    const timeline = this.timeline, session = this.getSession(), guides = session.chart[GUIDE_LINES_KEY];
    const ghost = this.clipboardShowing ? this.projectClipboard() : null;
    const layout = timeline.multiLineLayout(width, 'notes');
    const indices = session.multiLineActive && session.multiLineMode === 'notes' ? layout.indices.slice(layout.first, layout.last) : [session.lineIndex];
    const key = [guides, this.draft?.next ?? this.pendingCommit?.next, this.endpoint, ghost?.guide, ghost?.lineIndex, timeline.origin, timeline.scale, timeline.cameraX, timeline.noteSpacing, timeline.noteScale, timeline.gridCount, timeline.snapX,
      width, height, timeline.tempo, session.lineIndex, session.multiLineActive, session.multiLineMode, session.multiLineMerge,
      layout.panelWidth, layout.offset, timeline.judgementOffset, timeline.noteView?.originX, timeline.noteView?.pixelsPerUnit, timeline.noteView?.currentDistance, timeline.noteView?.pixelsPerDistance, timeline.noteView?.flow,
      ...indices.flatMap(index => [index, timeline.factorForLine(index)])];
    if (this.geometry && key.length === this.geometry.key.length && key.every((value, index) => value === this.geometry.key[index])) return this.geometry.paths;
    const paths = [];
    for (const lineIndex of indices) {
      if (this.adding && this.adding.lineIndex !== lineIndex) continue;
      const [first, last] = timeline.beatRangeForLine(lineIndex, height);
      let visible = guideLinesInRange(guides, first, last).map(guide => guide.id === this.selected && (this.draft || this.pendingCommit) ? this.guide : guide);
      if (this.draft && !visible.some(guide => guide.id === this.selected) && beatValue(this.draft.next.startTime) <= last && beatValue(this.draft.next.endTime) >= first) visible.push(this.draft.next);
      if (this.adding && this.endpoint && this.adding.beat !== this.endpoint.beat) {
        const [a, b] = this.adding.beat < this.endpoint.beat ? [this.adding, this.endpoint] : [this.endpoint, this.adding];
        visible.push({ id: '__pending', startTime: fromNumber(a.beat), endTime: fromNumber(b.beat), start: a.x, end: b.x, easingType: 1 });
      }
      if (ghost && ghost.lineIndex === lineIndex && beatValue(ghost.guide.startTime) <= last && beatValue(ghost.guide.endTime) >= first) visible.push(ghost.guide);
      const steps = Math.min(512, Math.max(8, Math.floor(32768 / Math.max(1, visible.length * indices.length))), Math.max(24, Math.ceil(height / 3)));
      for (const guide of visible) for (const side of timeline.noteView?.flow ? [1, -1] : [1]) {
        const a = Math.max(first, beatValue(guide.startTime), timeline.noteView?.flow ? timeline.origin : 0), b = Math.min(last, beatValue(guide.endTime));
        if (b < a) continue;
        const beats = new Set([a, b]);
        const linear = guide.start === guide.end || !guide.bezier && !guide.customEasing && (guide.easingType ?? 1) === 1;
        if (!linear || timeline.noteView?.flow) for (let i = 1; i < steps; i++) beats.add(a + (b - a) * i / steps);
        if (!timeline.noteView?.flow) {
          for (let i = upperBound(timeline.tempo.points, a, point => point.beat); i < timeline.tempo.points.length && timeline.tempo.points[i].beat < b; i++) beats.add(timeline.tempo.points[i].beat);
        }
        if (guide.customEasing) {
          const [left, right] = guide.customEasing.domain ?? [0, 1], firstBeat = beatValue(guide.startTime), duration = beatValue(guide.endTime) - firstBeat;
          for (const node of guide.customEasing.curve.nodes) { const beat = firstBeat + (node.x - left) / (right - left) * duration; if (beat > a && beat < b) beats.add(beat); }
        }
        const points = [...beats].sort((a, b) => a - b).map(beat => ({ x: timeline.noteHorizontal(guidePosition(guide, beat), lineIndex), y: timeline.verticalForLine(beat, lineIndex, height, side) }));
        const geometry = typeof Path2D === 'function' ? new Path2D() : null;
        if (geometry) points.forEach((point, i) => i ? geometry.lineTo(point.x, point.y) : geometry.moveTo(point.x, point.y));
        const endpoints = ['start', 'end'].map(part => ({ part, x: timeline.noteHorizontal(guidePosition(guide, beatValue(guide[part + 'Time'])), lineIndex), y: timeline.verticalForLine(beatValue(guide[part + 'Time']), lineIndex, height, side) }));
        const panel = timeline.panelIndex(lineIndex, 'notes'), left = layout.count === 1 ? 0 : panel * layout.stride - layout.offset;
        paths.push({ guide, ghost: guide === ghost?.guide, lineIndex, side, points, geometry, endpoints, left, right: left + layout.panelWidth });
      }
    }
    this.geometry = { key, paths }; return paths;
  }
  hit(position) {
    const timeline = this.timeline, width = timeline.notesCanvas.clientWidth, height = timeline.notesCanvas.clientHeight;
    const paths = this.paths(width, height); let closest = null, distance = 7;
    for (const path of paths) {
      if (path.ghost) continue;
      if (position.x < path.left || position.x > path.right || timeline.noteView?.flow && timeline.noteView.sideAt(position.y) !== path.side) continue;
      for (const endpoint of path.endpoints) {
        if (Math.hypot(position.x - endpoint.x, position.y - endpoint.y) <= 10) return { ...path, endpoint: endpoint.part };
      }
      for (let i = 1; i < path.points.length; i++) {
        const delta = segmentDistance(position, path.points[i - 1], path.points[i]);
        if (delta < distance) { closest = path; distance = delta; }
      }
    }
    return closest;
  }
  draw(context, width, height) {
    if (!this.enabled()) return;
    // Guide white and moving dashes are semantic feedback. Keep them outside
    // skin palette, dash and opacity replacements without affecting the grid.
    context = originalEditorContext(context);
    if ((this.adding || this.drag) && this.timeline.cursor) this.move(this.timeline.cursor);
    const now = performance.now(), flash = this.timeline.snapX && this.snapFeedback && now < this.snapFeedback.until ? this.snapFeedback : null;
    if (!flash) this.snapFeedback = null;
    const strokeWidth = this.timeline.guideLineWidth ?? 1.2;
    const brightness = Math.max(0, Math.min(1, this.timeline.guideLineBrightness ?? 1));
    this.selectedVisible = false;
    if (!brightness) return;
    context.save(); context.lineWidth = strokeWidth;
    for (const path of this.paths(width, height)) {
      context.save(); context.beginPath(); context.rect(path.left, 0, path.right - path.left, height); context.clip();
      if (this.timeline.noteView?.flow) this.timeline.clipNoteSide(context, path.side, width, height);
      const selected = path.guide.id === this.selected || path.guide.id === '__pending';
      if (selected) this.selectedVisible = true;
      context.strokeStyle = '#ffffff'; context.globalAlpha = brightness * (path.ghost ? .3 : 1);
      context.setLineDash(selected ? [7, 5] : []); context.lineDashOffset = selected ? -now / 45 : 0;
      strokePath(context, path); context.setLineDash([]);
      if (flash && flash.id === path.guide.id && flash.lineIndex === path.lineIndex && (!this.timeline.noteView?.flow || flash.side === path.side)) {
        const remaining = Math.max(0, Math.min(1, (flash.until - now) / 650));
        const x = this.timeline.noteHorizontal(guidePosition(path.guide, flash.beat), path.lineIndex), y = this.timeline.verticalForLine(flash.beat, path.lineIndex, height, path.side);
        context.save(); context.beginPath(); context.rect(path.left, y - 48, path.right - path.left, 96); context.clip();
        context.globalAlpha = remaining * brightness; context.lineWidth = strokeWidth + 2; context.setLineDash([7, 5]); context.lineDashOffset = -now / 35;
        strokePath(context, path); context.restore();
        context.save(); context.globalAlpha = remaining * brightness; context.strokeStyle = '#8acbff'; context.lineWidth = 1.5; context.setLineDash([]); context.beginPath(); context.arc(x, y, 8 + (1 - remaining) * 10, 0, Math.PI * 2); context.stroke(); context.restore();
      }
      for (const point of path.endpoints) {
        if (point.y < -10 || point.y > height + 10) continue;
        context.strokeStyle = selected ? '#8acbff' : '#ffffff'; context.lineWidth = Math.max(1.2, strokeWidth);
        context.beginPath(); context.arc(point.x, point.y, 5, 0, Math.PI * 2); context.fillStyle = '#20262e'; context.fill(); context.stroke();
      }
      context.restore();
    }
    context.restore();
    if (this.adding && this.endpoint && this.endpoint.beat === this.adding.beat) {
      context.save(); context.globalAlpha = brightness; context.strokeStyle = '#8acbff'; context.beginPath();
      context.arc(this.timeline.noteHorizontal(this.adding.x, this.adding.lineIndex), this.timeline.verticalForLine(this.adding.beat, this.adding.lineIndex, height, this.adding.side), 5, 0, Math.PI * 2); context.stroke(); context.restore();
    }
  }
}
