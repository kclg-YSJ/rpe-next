import { DatabaseSync } from 'node:sqlite';
import { statfs, writeFile, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { largeArchiveDirectory, largeEntryStream } from './large-chart-archive.mjs';
import { parsePecChart } from '../src/core/pec-chart.mjs';
import { createLine } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { beatValue, fromNumber } from '../src/core/beat.mjs';
import { LineRuntime } from '../src/core/scene.mjs';
import { boundedPreviewCover } from './large-chart-image.mjs';

export const LARGE_LIMITS = Object.freeze({ diskBytes: 1024 ** 3, databaseBytes: 768 * 1024 ** 2, mediaBytes: 96 * 1024 ** 2, mapEntries: 16384, windowGroups: 40000, sourceBytes: 16 * 1024 ** 3 });
export const LARGE_NOTE_FIELDS = Object.freeze(['l', 't', 's', 'e', 'x', 'a', 'f', 'v', 'w', 'n', 'p', 'q', 'h', 'id', 'b', 'z', 'u', 'd', 'alpha']);
const numeric = value => Number.isFinite(value) && Math.abs(value) <= 1e7;
const tick = seconds => Math.round(seconds * 1e6);
export class LargeChartStore {
  constructor(workspace, { progress = () => {}, limits = {} } = {}) {
    this.workspace = workspace; this.progress = progress; this.limits = { ...LARGE_LIMITS, ...limits }; this.total = 0; this.media = {};
  }
  async budget(anticipated = 0) {
    const disk = await statfs(this.workspace), memory = process.memoryUsage();
    if (disk.bavail * disk.bsize < 1024 ** 3 + anticipated) throw Error('缓存盘可用空间不足，已停止预览缓存');
    if (memory.heapUsed + memory.arrayBuffers > 192 * 1024 ** 2) throw Error('超大谱预览达到内存预算，已安全停止');
    const bytes = this.db ? Number(this.db.prepare('PRAGMA page_count').get().page_count) * 4096 : 0;
    if (bytes + (this.mediaBytes ?? 0) > this.limits.diskBytes) throw Error('超大谱预览达到磁盘预算，已安全停止');
    this.peakMemory = Math.max(this.peakMemory ?? 0, memory.heapUsed + memory.arrayBuffers);
    this.diskBytes = bytes + (this.mediaBytes ?? 0);
  }
  initialize() {
    this.db = new DatabaseSync(join(this.workspace, 'notes.sqlite'));
    // Disposable cache: no rollback journal, memory-mapped file or OS temp files.
    // Failed/cancelled imports are discarded by the owner, never reused.
    this.db.exec(`PRAGMA page_size=4096; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-8192; PRAGMA mmap_size=0; PRAGMA max_page_count=${Math.floor(this.limits.databaseBytes / 4096)};
      CREATE TABLE notes(id INTEGER PRIMARY KEY,k TEXT UNIQUE,l INTEGER,t INTEGER,b REAL,z REAL,x REAL,a INTEGER,f INTEGER,v REAL,w REAL,n INTEGER,o INTEGER,s REAL,e REAL,p REAL,q REAL,h INTEGER,tick INTEGER,j TEXT,u REAL NOT NULL DEFAULT 0,d REAL NOT NULL DEFAULT 999999,alpha REAL NOT NULL DEFAULT 255);
      CREATE VIRTUAL TABLE visibility USING rtree(id,l0,l1,v0,v1,p0,p1,s0,s1);
      CREATE VIRTUAL TABLE edit_visibility USING rtree(id,l0,l1,b0,b1,x0,x1);
      CREATE TABLE times(t INTEGER PRIMARY KEY,n INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE completions(t REAL PRIMARY KEY,n INTEGER NOT NULL,c INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;`);
    this.insert = this.db.prepare('INSERT INTO notes(k,l,t,b,z,x,a,f,v,w,n,o) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET n=n+excluded.n');
    this.pending = new Map();
  }
  add(note) {
    if (!numeric(note.v) || !numeric(note.w) || note.w < 0) throw Error('音符速度或宽度超出实验预览的支持范围');
    const key = `${note.l}|${note.t}|${note.b}|${note.z}|${note.x}|${note.a}|${note.f}|${note.v}|${note.w}`;
    const existing = this.pending.get(key);
    if (existing) existing.n++;
    else this.pending.set(key, { ...note, n: 1, o: this.total });
    if (++this.total > 1e9) throw Error('音符数量超过实验预览预算');
    if (this.pending.size >= this.limits.mapEntries) this.flush();
  }
  transaction(run) {
    this.db.exec('BEGIN');
    try { run(); this.db.exec('COMMIT'); }
    catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* A full cache may already have rolled back. */ }
      if (/full/i.test(error.message)) throw Error('预览索引达到磁盘上限，已安全停止');
      throw error;
    }
  }
  flush() {
    if (!this.pending.size) return;
    this.transaction(() => { for (const [key, note] of this.pending) this.insert.run(key, note.l, note.t, note.b, note.z, note.x, note.a, note.f, note.v, note.w, note.n, note.o); });
    this.pending.clear();
  }
  async import(path) {
    await this.budget(this.limits.diskBytes);
    this.initialize(); const entries = await largeArchiveDirectory(path);
    const candidates = entries.filter(entry => /\.(json|pec)$/i.test(entry.name) && !/(?:^|\/)(?:extra|info)\.json$/i.test(entry.name));
    if (candidates.length !== 1) throw Error('实验预览需要压缩包中恰好一份 PEC 谱面');
    const entry = candidates[0]; if (entry.length > this.limits.sourceBytes) throw Error('谱面文本超过实验预览的输入预算');
    const decoder = new StringDecoder('utf8'), eventRows = []; let pending = '', lastNote, offset = null, rows = 0, read = 0, lastProgress = 0, eventBytes = 0;
    const parse = text => {
      if (text.length > 65536) throw Error('谱面单行过长');
      const row = text.trim(); rows++; if (!row || row.startsWith('//')) return;
      if (offset === null) { offset = Number(row.replace(/^\uFEFF/, '')); if (!numeric(offset)) throw Error('实验预览当前仅支持 PEC 文本（可使用 .json 文件名）'); eventRows.push(String(offset)); return; }
      const tokens = row.split(/\s+/), command = tokens[0];
      if (/^n[1-4]$/.test(command)) {
        if (lastNote) this.add(lastNote);
        const marker = tokens.findIndex(value => value === '#' || value === '&'), stop = marker < 0 ? tokens.length : marker;
        const hold = command === 'n2', expected = hold ? 6 : 5, values = tokens.slice(1, stop).map(Number);
        if (![expected, expected - 1].includes(values.length) || !values.every(numeric)) throw Error(`PEC 第 ${rows} 行音符无效`);
        const [l, b] = values, z = hold ? values[2] : b, x = values[hold ? 3 : 2], a = values[hold ? 4 : 3], f = values[hold ? 5 : 4] ?? 0;
        if (!Number.isInteger(l) || l < 0 || l >= 256 || z < b || ![0, 1].includes(f)) throw Error(`PEC 第 ${rows} 行音符时间或线号超出实验范围`);
        lastNote = { l, t: Number(command[1]), b, z, x: x * 675 / 1024, a: a === 1 ? 1 : 0, f, v: 1, w: 1 };
        for (let i = stop; i < tokens.length; i += 2) {
          if (!['#', '&'].includes(tokens[i]) || !numeric(Number(tokens[i + 1]))) throw Error(`PEC 第 ${rows} 行音符参数无效`);
          lastNote[tokens[i] === '#' ? 'v' : 'w'] = Number(tokens[i + 1]);
        }
      } else if (command === '#' || command === '&') {
        if (!lastNote || tokens.length !== 2 || !numeric(Number(tokens[1]))) throw Error(`PEC 第 ${rows} 行参数无效`);
        lastNote[command === '#' ? 'v' : 'w'] = Number(tokens[1]);
      } else {
        if (!['bp', 'cp', 'cm', 'cd', 'ca', 'cv', 'cr', 'cf'].includes(command)) throw Error(`实验预览不支持 PEC 指令 ${command}`);
        if (!tokens.slice(1).map(Number).every(numeric) || command !== 'bp' && (!Number.isInteger(Number(tokens[1])) || Number(tokens[1]) < 0 || Number(tokens[1]) >= 256)) throw Error(`PEC 第 ${rows} 行事件超出实验范围`);
        eventBytes += row.length; if (eventRows.length >= 16384 || eventBytes > 1024 ** 2) throw Error('事件数量超过实验预览预算');
        eventRows.push(row);
      }
    };
    for await (const chunk of largeEntryStream(path, entry)) {
      read += chunk.length; const text = pending + decoder.write(chunk); let from = 0, end;
      while ((end = text.indexOf('\n', from)) >= 0) { parse(text.slice(from, end)); from = end + 1; }
      pending = text.slice(from); if (pending.length > 65536) throw Error('谱面单行过长');
      if (Date.now() - lastProgress > 500) { lastProgress = Date.now(); await this.budget(); this.progress({ phase: 'index', ratio: read / entry.length * .85, notes: this.total, diskBytes: this.diskBytes, memory: this.peakMemory }); }
    }
    pending += decoder.end(); if (pending.trim()) parse(pending); if (lastNote) this.add(lastNote); this.flush();
    const chart = parsePecChart(eventRows.join('\n'));
    const largestLine = Number(this.db.prepare('SELECT MAX(l) AS l FROM notes').get().l ?? 0);
    while (chart.judgeLineList.length <= largestLine) { const line = createLine(); line.eventLayers = [{}]; chart.judgeLineList.push(line); }
    delete chart.rpeNextLegacySource; chart.META.name = basename(path).replace(/\.(zip|pez)$/i, '');
    this.chart = chart; this.tempo = new TempoMap(chart.BPMList); this.runtimes = chart.judgeLineList.map(line => new LineRuntime(line, this.tempo));
    const update = this.db.prepare('UPDATE notes SET b=?,z=?,s=?,e=?,p=?,q=?,tick=? WHERE id=?');
    const geometry = this.db.prepare('INSERT INTO visibility VALUES(?,?,?,?,?,?,?,?,?)');
    const editorGeometry = this.db.prepare('INSERT INTO edit_visibility VALUES(?,?,?,?,?,?,?)');
    const time = this.db.prepare('INSERT INTO times VALUES(?,?) ON CONFLICT(t) DO UPDATE SET n=n+excluded.n');
    const completion = this.db.prepare('INSERT INTO completions(t,n) VALUES(?,?) ON CONFLICT(t) DO UPDATE SET n=n+excluded.n');
    const unique = Number(this.db.prepare('SELECT COUNT(*) AS n FROM notes').get().n); this.unique = unique;
    let id = 0, processed = 0, endTime = 0;
    const speeds = new Map();
    for (;;) {
      const rows = this.db.prepare('SELECT id,l,t,b,z,x,f,v,n FROM notes WHERE id>? ORDER BY id LIMIT 4096').all(id); if (!rows.length) break;
      this.transaction(() => {
        for (const row of rows) {
          const b = beatValue(fromNumber(row.b)), z = beatValue(fromNumber(row.z)), s = this.tempo.seconds(b), e = this.tempo.seconds(z), runtime = this.runtimes[row.l], p = runtime.floor(s), q = runtime.floor(e);
          if (![s, e, p, q].every(value => Number.isFinite(value) && Math.abs(value) < 1e15)) throw Error('谱面时间或滚动距离超过实验范围');
          update.run(b, z, s, e, p, q, tick(s), row.id);
          geometry.run(row.id, row.l, row.l, row.v, row.v, Math.min(p, q), Math.max(p, q), s - 999999, e);
          editorGeometry.run(row.id, row.l, row.l, b, z, row.x, row.x);
          time.run(tick(s), row.n); if (!row.f) completion.run(row.t === 2 ? e : s, row.n);
          const key = `${row.l}:${row.v}`; speeds.set(key, { line: row.l, speed: row.v }); if (speeds.size > 256) throw Error('不同流速组超过实验预览预算');
          endTime = Math.max(endTime, e); id = row.id;
        }
      });
      processed += rows.length; await this.budget(); this.progress({ phase: 'finalize', ratio: .85 + .1 * processed / Math.max(1, unique), notes: this.total, groups: unique, diskBytes: this.diskBytes, memory: this.peakMemory });
    }
    this.speedGroups = [...speeds.values()];
    this.db.exec('UPDATE notes SET h=(SELECT n>1 FROM times WHERE times.t=notes.tick)');
    let cursor = -Infinity, completed = 0;
    const cumulative = this.db.prepare('UPDATE completions SET c=? WHERE t=?');
    for (;;) {
      const rows = this.db.prepare('SELECT t,n FROM completions WHERE t>? ORDER BY t LIMIT 4096').all(cursor); if (!rows.length) break;
      this.transaction(() => { for (const row of rows) { cumulative.run(completed += row.n, row.t); cursor = row.t; } });
    }
    for (const [role, expression] of [['music', /\.(mp3|ogg|wav|flac|m4a|opus)$/i], ['cover', /\.(png|jpe?g|webp)$/i]]) {
      const matches = entries.filter(entry => expression.test(entry.name)); if (matches.length !== 1) continue;
      const entry = matches[0]; if (entry.length > this.limits.mediaBytes || (this.mediaBytes ?? 0) + entry.length > this.limits.mediaBytes) throw Error('预览素材超过 96 MiB 预算');
      await this.budget(entry.length);
      this.mediaBytes = (this.mediaBytes ?? 0) + entry.length;
      const destination = join(this.workspace, role + entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase());
      await pipeline(largeEntryStream(path, entry), createWriteStream(destination, { flags: 'wx' }));
      if (role === 'cover' && !await boundedPreviewCover(destination)) { await unlink(destination); this.mediaBytes -= entry.length; continue; }
      this.media[role] = basename(destination);
    }
    this.summary = { chart, total: this.total, unique, realNotes: completed, endTime, media: this.media, diskBytes: this.diskBytes, memory: this.peakMemory, limits: this.limits };
    await this.budget(); this.summary.diskBytes = this.diskBytes;
    await writeFile(join(this.workspace, 'summary.json'), JSON.stringify(this.summary));
    this.db.exec('PRAGMA query_only=ON'); this.progress({ phase: 'ready', ratio: 1, notes: this.total, groups: unique, diskBytes: this.diskBytes, memory: this.peakMemory });
    return this.summary;
  }
  window({ seconds, span = .5, radius = 2200, packed = false, historySpan = 0 }) {
    if (!this.summary || !numeric(seconds) || !Number.isFinite(radius) || radius < 1 || radius > 20000 || !Number.isFinite(span) || span < 0 || span > 1 || !Number.isFinite(historySpan) || historySpan < 0 || historySpan > 1) throw Error('预览时间范围无效');
    const output = [], max = this.limits.windowGroups, end = seconds + span;
    for (const { line, speed } of this.speedGroups) {
      const runtime = this.runtimes[line], distances = [runtime.floor(seconds), runtime.floor(end)];
      // PEC speed changes are instantaneous. Include breaks inside the prefetch
      // interval, supporting reversals without sampling past them.
      for (const integral of runtime.speeds) for (const event of integral.events) if (event.start > seconds && event.start < end) distances.push(runtime.floor(event.start));
      const range = speed === 0 ? Infinity : radius / Math.abs(speed), low = Math.min(...distances) - range, high = Math.max(...distances) + range;
      const rows = this.db.prepare(`SELECT ${LARGE_NOTE_FIELDS.map(key => key === 'h' ? '(SELECT n>1 FROM times WHERE t=n.tick) AS h' : 'n.' + key).join(',')},n.o,n.j FROM visibility g JOIN notes n ON n.id=g.id
        WHERE g.l0<=? AND g.l1>=? AND g.v0<=? AND g.v1>=? AND g.p0<=? AND g.p1>=? AND g.s0<=? AND g.s1>=? AND n.v=? AND n.e>=? LIMIT ?`).all(line, line, speed, speed, high, low, end, seconds, speed, seconds, max - output.length + 1);
      output.push(...rows); if (output.length > max) throw Error(`当前窗口的不同音符组超过 ${max}，已暂停以保持内存预算`);
    }
    if (historySpan > 0) {
      const found = new Set(output.map(row => row.id));
      const query = this.db.prepare(`SELECT ${LARGE_NOTE_FIELDS.map(key => key === 'h' ? '(SELECT n>1 FROM times WHERE t=n.tick) AS h' : 'n.' + key).join(',')},n.o,n.j FROM edit_visibility g JOIN notes n ON n.id=g.id
        WHERE g.l0<=? AND g.l1>=? AND g.b0<=? AND g.b1>=? AND n.s<=? AND n.e>=? AND n.n>0 LIMIT ?`);
      for (const [line, runtime] of this.runtimes.entries()) {
        const factor = runtime.line.bpmfactor ?? 1;
        const rows = query.all(line, line, this.tempo.beat(end, factor), this.tempo.beat(seconds - historySpan, factor), end, seconds - historySpan, max + 1);
        for (const row of rows) if (!found.has(row.id)) { found.add(row.id); output.push(row); if (output.length > max) throw Error(`当前窗口的不同音符组超过 ${max}，已暂停以保持内存预算`); }
      }
    }
    output.sort((a, b) => a.o - b.o);
    const completions = this.db.prepare('SELECT t,c FROM completions WHERE t>=? AND t<=? ORDER BY t LIMIT ?').all(seconds, end, max + 1);
    if (completions.length > max) throw Error('当前窗口的计分时间点超过预览预算');
    const combo = Number(this.db.prepare('SELECT c FROM completions WHERE t<? ORDER BY t DESC LIMIT 1').get(seconds)?.c ?? 0);
    if (packed) {
      const stride = LARGE_NOTE_FIELDS.length, notes = new Float64Array(output.length * stride), changes = new Float64Array(completions.length * 2);
      for (let i = 0; i < output.length; i++) for (let field = 0; field < stride; field++) notes[i * stride + field] = output[i][LARGE_NOTE_FIELDS[field]];
      for (let i = 0; i < completions.length; i++) { changes[i * 2] = completions[i].t; changes[i * 2 + 1] = completions[i].c; }
      const extras = []; let bytes = 0;
      for (let index = 0; index < output.length; index++) if (output[index].j) { bytes += Buffer.byteLength(output[index].j); if (bytes > 8 * 1024 ** 2) throw Error('可见音符的附加属性超过传输预算'); extras.push([index, output[index].j]); }
      return { seconds, end, notes, noteCount: output.length, stride, extras, completions: changes, combo };
    }
    return { seconds, end, notes: output.map(({ l, t, s, e, x, a, f, v, w, n, p, q, h }) => ({ l, t, s, e, x, a, f, v, w, n, p, q, h })), completions, combo };
  }
  close() { this.db?.close(); this.db = null; }
}
