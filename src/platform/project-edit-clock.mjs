import { localPreferences } from './local-preferences.mjs';

const seconds = value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12 ? Number(value) : 0;
export const chartEditSeconds = (chart, info) => Math.max(seconds(chart?.rpeNextEditTime), seconds(chart?.chartTime), seconds(info?.EditTime));

// A project clock is workspace metadata, independent of undo and chart edits.
// Checkpoints are bounded to one small preference write per 30 seconds.
export class ProjectEditClock {
  constructor(storage = localPreferences) { this.storage = storage; this.total = 0; }
  attach(identity, chart, info, now) {
    this.checkpoint(); this.key = 'rpe-next-edit-time-v1:' + identity;
    let saved = 0; try { saved = seconds(this.storage.getItem(this.key)); } catch { /* The chart remains the portable fallback. */ }
    this.total = Math.max(saved, chartEditSeconds(chart, info)); this.saved = saved; this.last = now; this.lastWrite = now; this.active = false;
    return this.total;
  }
  tick(now, active) {
    if (!Number.isFinite(now)) return this.total;
    if (active && this.active && Number.isFinite(this.last)) this.total += Math.max(0, now - this.last) / 1000;
    this.last = now; this.active = active;
    if (now - this.lastWrite >= 30000) { this.checkpoint(); this.lastWrite = now; }
    return this.total;
  }
  checkpoint() {
    if (!this.key || this.total === this.saved) return;
    try { this.total = Math.max(this.total, seconds(this.storage.getItem(this.key))); this.storage.setItem(this.key, String(this.total)); this.saved = this.total; }
    catch { /* A later checkpoint or explicit chart save can retain the total. */ }
  }
  snapshot(chart) { this.checkpoint(); return { ...chart, rpeNextEditTime: this.total }; }
}
