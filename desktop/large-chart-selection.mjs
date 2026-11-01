import { randomUUID } from 'node:crypto';
import { largeRowNote } from './large-chart-document.mjs';
import { beatValue, fromNumber } from '../src/core/beat.mjs';

// Logical selections live on disk. A renderer page is only a projection of
// this set and is never used as the authority for rectangle selection.
export class DiskNoteSelection {
  constructor(document) {
    this.document = document; this.db = document.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS note_selection_sets(id TEXT PRIMARY KEY,summary TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS selected_notes(selection TEXT NOT NULL,id INTEGER NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(selection,id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS note_edit_stage(id INTEGER PRIMARY KEY,line INTEGER,n INTEGER NOT NULL,j TEXT);
      DELETE FROM note_edit_stage;`);
  }
  get(token) {
    const row = this.db.prepare('SELECT summary FROM note_selection_sets WHERE id=?').get(token);
    if (!row) throw Error('音符选择已失效，请重新选择');
    return JSON.parse(row.summary);
  }
  summarize(token) {
    const row = this.db.prepare(`SELECT SUM(s.n) AS total,COUNT(*) AS groups,MIN(n.b) AS firstBeat,MAX(n.z) AS lastBeat,MIN(n.x) AS minX,MAX(n.x) AS maxX,MIN(n.l) AS firstLine
      FROM selected_notes s JOIN notes n ON n.id=s.id WHERE s.selection=? AND n.n>0`).get(token);
    const summary = { token, total: Number(row.total ?? 0), groups: row.groups, firstBeat: row.firstBeat ?? 0, lastBeat: row.lastBeat ?? 0, minX: row.minX ?? 0, maxX: row.maxX ?? 0, firstLine: row.firstLine ?? 0 };
    this.db.prepare('INSERT INTO note_selection_sets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary').run(token, JSON.stringify(summary));
    return summary;
  }
  prune(active) {
    this.db.prepare(`DELETE FROM selected_notes WHERE selection IN(SELECT id FROM note_selection_sets WHERE id<>?
      AND id NOT IN(SELECT json_extract(before,'$.diskSelection.token') FROM edit_selections WHERE json_extract(before,'$.diskSelection.token') IS NOT NULL)
      AND id NOT IN(SELECT json_extract(after,'$.diskSelection.token') FROM edit_selections WHERE json_extract(after,'$.diskSelection.token') IS NOT NULL))`).run(active);
  }
  async select({ revision, regions = [], base, remove = false, interval = 1, ids = [] }) {
    const document = this.document; document.checkRevision(revision);
    if (!Array.isArray(regions) || regions.length > 1024 || !Array.isArray(ids) || ids.length > document.limits.windowGroups || !Number.isSafeInteger(interval) || interval < 1) throw Error('音符选择范围无效');
    const token = randomUUID(); this.db.exec('BEGIN IMMEDIATE');
    try {
      if (base) { this.get(base); this.db.prepare('INSERT INTO selected_notes SELECT ?,id,n FROM selected_notes WHERE selection=?').run(token, base); }
      const insert = this.db.prepare(`INSERT OR IGNORE INTO selected_notes
        SELECT ?,n.id,n.n FROM edit_visibility g JOIN notes n ON n.id=g.id
        WHERE g.l0<=? AND g.l1>=? AND g.b0<=? AND g.b1>=? AND g.x0<=? AND g.x1>=?
        AND n.l=? AND n.b<=? AND n.z>=? AND n.x<=? AND n.x>=? AND n.n>0 AND (? IS NULL OR n.a=?)`);
      const exclude = this.db.prepare(`DELETE FROM selected_notes WHERE selection=? AND id IN(
        SELECT n.id FROM edit_visibility g JOIN notes n ON n.id=g.id WHERE g.l0<=? AND g.l1>=? AND g.b0<=? AND g.b1>=? AND g.x0<=? AND g.x1>=?
        AND n.l=? AND n.b<=? AND n.z>=? AND n.x<=? AND n.x>=? AND n.n>0 AND (? IS NULL OR n.a=?))`);
      for (const region of regions) {
        const { line, start, end, left = -1e7, right = 1e7, above = null } = region;
        if (!document.chart.judgeLineList[line] || !Number.isInteger(line) || ![start, end, left, right].every(Number.isFinite) || start > end || left > right || ![null, 0, 1].includes(above)) throw Error('音符选择范围无效');
        (remove ? exclude : insert).run(token, line, line, end, start, right, left, line, end, start, right, left, above, above);
        await document.diskBudget();
      }
      const put = this.db.prepare('INSERT OR REPLACE INTO selected_notes VALUES(?,?,?)');
      for (const id of ids) {
        const row = document.rowGet.get(id); if (!row?.n) continue;
        if (remove) this.db.prepare('DELETE FROM selected_notes WHERE selection=? AND id=?').run(token, id);
        else put.run(token, id, row.n);
      }
      if (interval > 1) {
        // Count a stride through repetitions arithmetically, without expanding
        // a group into millions of individual records.
        let offset = 0, cursor = 0;
        for (;;) {
          const rows = this.db.prepare('SELECT id,n FROM selected_notes WHERE selection=? AND id>? ORDER BY id LIMIT 2048').all(token, cursor); if (!rows.length) break;
          for (const row of rows) {
            const first = (interval - offset % interval) % interval, count = first < row.n ? Math.floor((row.n - 1 - first) / interval) + 1 : 0;
            offset += row.n; cursor = row.id;
            if (count) put.run(token, row.id, count); else this.db.prepare('DELETE FROM selected_notes WHERE selection=? AND id=?').run(token, row.id);
          }
          await document.diskBudget();
        }
      }
      const summary = this.summarize(token); this.prune(token); await document.diskBudget(); this.db.exec('COMMIT'); return summary;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  read({ token, after = 0, limit = 512 }) {
    this.get(token);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 2048) throw Error('选择读取范围无效');
    const rows = this.db.prepare('SELECT n.*,s.n AS selected FROM selected_notes s JOIN notes n ON n.id=s.id WHERE s.selection=? AND s.id>? AND n.n>0 ORDER BY s.id LIMIT ?').all(token, after, limit);
    const entries = rows.map(row => ({ line: row.l, count: Math.min(row.n, row.selected), note: largeRowNote(row) }));
    if (Buffer.byteLength(JSON.stringify(entries)) > 8 * 1024 ** 2) throw Error('选中音符属性超过单批预算');
    return { entries, after: rows.at(-1)?.id ?? after, done: rows.length < limit };
  }
  async stage({ action, token, revision, stage, changes = [], label, beforeSelection, afterSelection }) {
    const document = this.document;
    if (action === 'begin') {
      document.checkRevision(revision); this.get(token);
      if (this.staging) throw Error('已有音符修改正在准备');
      this.db.exec('DELETE FROM note_edit_stage'); this.staging = { id: randomUUID(), token, revision }; return this.staging.id;
    }
    if (!this.staging || this.staging.id !== stage) throw Error('批量修改已取消');
    if (action === 'cancel') { this.db.exec('DELETE FROM note_edit_stage'); this.staging = null; return; }
    document.checkRevision(this.staging.revision);
    if (action === 'append') {
      if (!Array.isArray(changes) || changes.length > 2048 || Buffer.byteLength(JSON.stringify(changes)) > 8 * 1024 ** 2) throw Error('单批修改超过预算');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const put = this.db.prepare('INSERT INTO note_edit_stage VALUES(?,?,?,?)');
        for (const change of changes) {
          const selected = this.db.prepare('SELECT n FROM selected_notes WHERE selection=? AND id=?').get(this.staging.token, change.id);
          if (!selected) throw Error('修改包含未选中的音符');
          put.run(change.id, change.line ?? null, selected.n, change.note ? JSON.stringify(change.note) : null);
        }
        await document.diskBudget(); this.db.exec('COMMIT'); return;
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    if (action !== 'finish') throw Error('无效的批量修改');
    const source = this.staging, destination = randomUUID(), changedNotes=Number(this.db.prepare('SELECT SUM(n) AS n FROM note_edit_stage').get().n??0);
    if(!changedNotes){this.staging=null;return{...document.describe(),selection:this.get(source.token),changedNotes:0};}
    try {
      const result = await document.transactionEdit(label, async () => {
        let cursor = 0;
        const selected = this.db.prepare('INSERT INTO selected_notes VALUES(?,?,?)');
        // Include unchanged items, then replace identities only for split rows.
        this.db.prepare('INSERT INTO selected_notes SELECT ?,id,n FROM selected_notes WHERE selection=?').run(destination, source.token);
        for (;;) {
          const rows = this.db.prepare('SELECT * FROM note_edit_stage WHERE id>? ORDER BY id LIMIT 1024').all(cursor); if (!rows.length) break;
          for (const change of rows) {
            const row = document.rowGet.get(change.id); if (!row?.n || row.n < change.n) throw Error('选中音符已改变');
            document.remember(row.id);
            if (change.j) {
              const count = change.n, complete = count === row.n;
              const next = document.noteRow(JSON.parse(change.j), change.line ?? row.l, complete ? { id: row.id, count, order: row.o } : { count, order: row.o });
              if (!complete) { document.write({ ...row, n: row.n - count }); document.remember(next.id); }
              document.write(next);
              if (!complete) { this.db.prepare('DELETE FROM selected_notes WHERE selection=? AND id=?').run(destination, row.id); selected.run(destination, next.id, count); }
            } else {
              document.write({ ...row, n: row.n - change.n }); this.db.prepare('DELETE FROM selected_notes WHERE selection=? AND id=?').run(destination, row.id);
            }
            cursor = change.id;
          }
          document.flushTimes(); await document.diskBudget(); document.progress({ phase: 'edit', notes: cursor });
        }
        const summary = this.summarize(destination);
        this.db.prepare('INSERT INTO edit_selections VALUES(?,?,?)').run(document.operation,
          JSON.stringify(beforeSelection), JSON.stringify({ ...afterSelection, diskSelection: summary, noteIds: [] }));
        this.db.exec('DELETE FROM note_edit_stage'); return summary;
      }, source.revision);
      return { ...result, selection: result.result, changedNotes };
    } finally { this.staging = null; this.db.exec('DELETE FROM note_edit_stage'); }
  }
  async copy({ token }) {
    const document = this.document, summary = this.get(token), clipboard = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM note_clipboard');
      const put = this.db.prepare('INSERT INTO note_clipboard VALUES(?,?,?,?)'); let cursor = 0, sample;
      for (;;) {
        const page = this.read({ token, after: cursor, limit: 1024 });
        for (const entry of page.entries) {
          const id = entry.note._rpenLargeRef.id; delete entry.note._rpenLargeRef;
          put.run(id, entry.line, entry.count, JSON.stringify(entry.note)); sample ??= entry.note;
        }
        cursor = page.after; await document.diskBudget(); if (page.done) break;
      }
      document.setState('clipboardToken', clipboard); this.db.exec('COMMIT'); return { ...summary, clipboard, sample };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async paste({ revision, clipboard, beat, mirror = false, keepTime = false, targetLine = 0, beforeSelection, afterSelection }) {
    const document = this.document;
    if (clipboard !== document.state('clipboardToken') || !Number.isFinite(beat) || !document.chart.judgeLineList[targetLine]) throw Error('剪贴板已改变，请重新复制');
    const source = this.db.prepare("SELECT MIN(line) AS line,MIN(json_extract(j,'$.startTime[0]')+json_extract(j,'$.startTime[1]')/json_extract(j,'$.startTime[2]')) AS beat FROM note_clipboard").get();
    const token = randomUUID(), delta = keepTime ? 0 : beat - source.beat, lines = document.chart.judgeLineList.length;
    const result = await document.transactionEdit('粘贴音符', async () => {
      let cursor = 0;
      const select = this.db.prepare('INSERT INTO selected_notes VALUES(?,?,?)');
      for (;;) {
        const rows = this.db.prepare('SELECT * FROM note_clipboard WHERE id>? ORDER BY id LIMIT 1024').all(cursor); if (!rows.length) break;
        for (const row of rows) {
          const note = JSON.parse(row.j); note.positionX *= mirror ? -1 : 1;
          if (delta) { note.startTime = fromNumber(beatValue(note.startTime) + delta); note.endTime = fromNumber(beatValue(note.endTime) + delta); }
          const line = ((targetLine + row.line - source.line) % lines + lines) % lines;
          const next = document.noteRow(note, line, { count: row.n }); document.remember(next.id); document.write(next); select.run(token, next.id, row.n); cursor = row.id;
        }
        document.flushTimes(); await document.diskBudget();
      }
      const selection = this.summarize(token);
      this.db.prepare('INSERT INTO edit_selections VALUES(?,?,?)').run(document.operation, JSON.stringify(beforeSelection), JSON.stringify({ ...afterSelection, diskSelection: selection, noteIds: [] }));
      return selection;
    }, revision);
    return { ...result, selection: result.result };
  }
}
