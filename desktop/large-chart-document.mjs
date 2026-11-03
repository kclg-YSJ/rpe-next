import { randomUUID } from 'node:crypto';
import { stat, readFile, writeFile, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { largeChartSpace } from './large-chart-paths.mjs';
import { DatabaseSync, backup } from 'node:sqlite';
import { LargeChartStore } from './large-chart-store.mjs';
import { createNote, assertChart } from '../src/core/chart.mjs';
import { beatValue, fromNumber } from '../src/core/beat.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { LineRuntime } from '../src/core/scene.mjs';
import { DiskNoteSelection } from './large-chart-selection.mjs';
import { chartHasAnimationCurves, ANIMATION_CURVE_VERSION } from '../src/core/chart-animation-curves.mjs';

const REF = '_rpenLargeRef', LINE = '_rpenLargeLine';
const columns = ['id','k','l','t','b','z','x','a','f','v','w','n','o','s','e','p','q','h','tick','j','u','d','alpha'];
const finite = value => Number.isFinite(value) && Math.abs(value) <= 1e7;
export function largeRowNote(row, reference = true) {
  const note = row.j ? JSON.parse(row.j) : createNote(row.t, row.b, row.x, row.z);
  Object.assign(note, { type: row.t, startTime: fromNumber(row.b), endTime: fromNumber(row.z), positionX: row.x,
    above: row.a ? 1 : row.t === 2 ? 0 : 2, isFake: row.f, speed: row.v, size: row.w,
    yOffset: row.u ?? 0, visibleTime: row.d ?? 999999, alpha: row.alpha ?? 255 });
  if (reference) note[REF] = { id: row.id, count: row.n };
  return note;
}
export function largeChartHeader(chart) {
  const header = { ...chart, judgeLineList: (chart.judgeLineList ?? []).map(line => ({ ...line, notes: [], numOfNotes: 0 })) };
  if (header.judgeLineList.length > 256) throw Error('超大谱工程当前最多支持 256 条判定线');
  delete header.rpeNextLargeChart;
  if (chartHasAnimationCurves(header)) header.META = { ...header.META, RPEVersion: Math.max(header.META.RPEVersion ?? 0, ANIMATION_CURVE_VERSION) };
  if (Buffer.byteLength(JSON.stringify(header)) > 8 * 1024 ** 2) throw Error('谱面事件与元数据超过超大谱工程的内存预算');
  assertChart(header); return header;
}

// The ordinary editor receives a bounded page, never the authoritative document.
// All note changes are reconciled by stable row identities in SQLite; notes not
// loaded in that page are untouched. A repeated row can be split to edit one note.
export class LargeChartDocument extends LargeChartStore {
  async editable() {
    if (this.enabled) return this.describe();
    this.db.exec(`PRAGMA query_only=OFF; PRAGMA trusted_schema=OFF; PRAGMA application_id=1380992332; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1024;
      CREATE TABLE IF NOT EXISTS document_state(k TEXT PRIMARY KEY,v TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS edit_history(id INTEGER PRIMARY KEY,label TEXT NOT NULL,before TEXT NOT NULL,after TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS edit_changes(op INTEGER NOT NULL,row INTEGER NOT NULL,before TEXT,after TEXT,PRIMARY KEY(op,row)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS edit_selections(op INTEGER PRIMARY KEY,before TEXT NOT NULL,after TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS note_clipboard(id INTEGER PRIMARY KEY,line INTEGER NOT NULL,n INTEGER NOT NULL,j TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_media(role TEXT PRIMARY KEY,name TEXT NOT NULL,data BLOB NOT NULL) WITHOUT ROWID;`);
    this.setState('format','rpen-large-document-1');
    const saved = this.state('header');
    this.chart = saved ? JSON.parse(saved) : largeChartHeader(this.chart);
    for (const line of this.chart.judgeLineList) line[LINE] ??= randomUUID();
    this.setState('header', JSON.stringify(this.chart));
    this.cursor = Number(this.state('cursor') ?? 0); this.savedCursor = Number(this.state('saved') ?? 0);
    this.nextId = Number(this.state('nextId') ?? (Number(this.db.prepare('SELECT MAX(id) AS n FROM notes').get().n ?? 0) + 1));
    this.revision = Number(this.state('revision') ?? 0); this.enabled = true;
    this.compile(); this.prepareStatements(); this.describe();
    this.selections = new DiskNoteSelection(this);
    await this.persistMedia();
    return this.describe();
  }
  state(key) { return this.db.prepare('SELECT v FROM document_state WHERE k=?').get(key)?.v; }
  setState(key, value) { this.db.prepare('INSERT INTO document_state VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, String(value)); }
  compile() {
    this.tempo = new TempoMap(this.chart.BPMList);
    this.runtimes = this.chart.judgeLineList.map(line => new LineRuntime(line, this.tempo));
  }
  prepareStatements() {
    this.rowGet = this.db.prepare('SELECT * FROM notes WHERE id=?');
    this.rowWrite = this.db.prepare(`INSERT INTO notes(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(key => `${key}=excluded.${key}`).join(',')}`);
    this.rememberWrite = this.db.prepare('INSERT OR IGNORE INTO edit_changes(op,row,before) VALUES(?,?,?)');
    this.geometryWrite = this.db.prepare('INSERT OR REPLACE INTO visibility VALUES(?,?,?,?,?,?,?,?,?)');
    this.editGeometryWrite = this.db.prepare('INSERT OR REPLACE INTO edit_visibility VALUES(?,?,?,?,?,?,?)');
  }
  describe() {
    if (!this.statsReady) {
      const stats = this.db.prepare('SELECT SUM(n) AS total,COUNT(*) AS groups,MAX(e) AS endTime,SUM(CASE WHEN f=0 THEN n ELSE 0 END) AS real FROM notes WHERE n>0').get();
      this.total=Number(stats.total??0);this.unique=Number(stats.groups??0);this.realNotes=Number(stats.real??0);this.endTime=Number(stats.endTime??0);
      this.lineCounts=Object.fromEntries(this.db.prepare('SELECT l,SUM(n) AS n FROM notes WHERE n>0 GROUP BY l').all().map(row=>[row.l,row.n]));this.statsReady=true;
    }
    const undo = this.enabled ? this.db.prepare('SELECT id,label FROM edit_history WHERE id<=? ORDER BY id DESC LIMIT 150').all(this.cursor).reverse() : [];
    const redo = this.enabled ? this.db.prepare('SELECT id,label FROM edit_history WHERE id>? ORDER BY id LIMIT 150').all(this.cursor).reverse() : [];
    this.summary = { ...this.summary, chart: this.chart, total: this.total, unique: this.unique, realNotes: this.realNotes, endTime: this.endTime, revision: this.revision ?? 0, lines: this.lineCounts, speedGroups: this.speedGroups,
      dirty: this.cursor !== this.savedCursor, undo, redo };
    return this.summary;
  }
  checkRevision(value) {
    if (!this.enabled) throw Error('超大谱尚未进入编辑模式');
    if (value !== this.revision) throw Error('谱面已改变，请重新读取当前编辑区后重试');
  }
  remember(id) {
    const before = this.rowGet.get(id);
    this.rememberWrite.run(this.operation, id, before ? JSON.stringify(before) : null);
  }
  geometry(row) {
    this.db.prepare('DELETE FROM visibility WHERE id=?').run(row.id);
    this.db.prepare('DELETE FROM edit_visibility WHERE id=?').run(row.id);
    if (!row.n) return;
    this.geometryWrite.run(row.id, row.l, row.l, row.v, row.v, Math.min(row.p, row.q) + row.u, Math.max(row.p, row.q) + row.u, row.s - row.d, row.e);
    this.editGeometryWrite.run(row.id, row.l, row.l, Math.min(row.b, row.z), Math.max(row.b, row.z), row.x, row.x);
  }
  write(row) {
    const before=this.rowGet.get(row.id);this.countChange(before,-1);this.countChange(row,1);
    this.rowWrite.run(...columns.map(key => row[key] ?? null)); this.geometry(row);
  }
  countChange(row,sign) {
    if(!row?.n)return;
    const count=sign*row.n;this.total+=count;this.unique+=sign;this.realNotes+=row.f?0:count;
    this.lineCounts[row.l]=(this.lineCounts[row.l]??0)+count;
    if(sign>0)this.endTime=Math.max(this.endTime,row.e);else if(row.e===this.endTime)this.endDirty=true;
    const add=(map,key,value)=>{const next=(map.get(key)??0)+value;if(next)map.set(key,next);else map.delete(key);};
    this.noteTimes??=new Map();this.completionChanges??=new Map();
    add(this.noteTimes,Math.round(row.s*1e6),count);if(!row.f)add(this.completionChanges,row.t===2?row.e:row.s,count);
    if(sign>0&&!this.speedGroups.some(group=>group.line===row.l&&group.speed===row.v))this.speedGroups.push({line:row.l,speed:row.v});
  }
  noteRow(note, line, { id = this.nextId++, count = 1, order = id } = {}) {
    const clean = structuredClone(note); delete clean[REF]; delete clean._rpenLargeCopies; delete clean._rpenLargeClipboard;
    if (!this.chart.judgeLineList[line] || ![1,2,3,4].includes(clean.type)) throw Error('音符类型或所属判定线无效');
    const b = beatValue(clean.startTime), z = beatValue(clean.endTime);
    if (![b,z,clean.positionX,clean.speed ?? 1,clean.size ?? 1,clean.yOffset ?? 0,clean.visibleTime ?? 999999,clean.alpha ?? 255].every(finite) || z < b || count < 1 || !Number.isSafeInteger(count)) throw Error('音符属性或时间无效');
    assertChart({ ...this.chart, judgeLineList: [{ ...this.chart.judgeLineList[line], notes: [clean] }] });
    const s = this.tempo.seconds(b, this.chart.judgeLineList[line].bpmfactor ?? 1), e = this.tempo.seconds(z, this.chart.judgeLineList[line].bpmfactor ?? 1);
    const p = this.runtimes[line].floor(s), q = this.runtimes[line].floor(e);
    return { id, k: `edit:${id}`, l: line, t: clean.type, b, z, x: clean.positionX, a: Number(clean.above ?? 1) === 1 ? 1 : 0, f: clean.isFake ? 1 : 0, v: clean.speed ?? 1, w: clean.size ?? 1, n: count, o: order,
      s,e,p,q,h:0,tick:Math.round(s*1e6),j:JSON.stringify(clean),u:clean.yOffset ?? 0,d:clean.visibleTime ?? 999999,alpha:Math.trunc(clean.alpha ?? 255) };
  }
  async diskBudget() {
    await this.budget();
    let bytes = this.diskBytes;
    for (const suffix of ['-wal','-shm']) { try { bytes += (await stat(join(this.workspace,'notes.sqlite'+suffix))).size; } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    if (bytes > this.limits.diskBytes) throw Error('工程与事务日志达到磁盘预算，修改已取消');
  }
  async transactionEdit(label, action, revision) {
    this.checkRevision(revision); await this.diskBudget();
    const before = JSON.stringify(this.chart), previous = { cursor:this.cursor,nextId:this.nextId,revision:this.revision,savedCursor:this.savedCursor };
    this.noteTimes=new Map();this.completionChanges=new Map();this.timesDirty=false;this.endDirty=false;
    this.operation = Number(this.db.prepare('SELECT MAX(id) AS n FROM edit_history').get().n ?? 0) + 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM edit_changes WHERE op IN(SELECT id FROM edit_history WHERE id>?)').run(this.cursor);
      this.db.prepare('DELETE FROM edit_selections WHERE op IN(SELECT id FROM edit_history WHERE id>?)').run(this.cursor);
      this.db.prepare('DELETE FROM edit_history WHERE id>?').run(this.cursor);
      const result = await action();
      if (this.savedCursor > this.cursor) this.savedCursor = -1;
      const after = JSON.stringify(this.chart);
      for (let cursor = 0;;) {
        const rows = this.db.prepare('SELECT row FROM edit_changes WHERE op=? AND row>? ORDER BY row LIMIT 2048').all(this.operation,cursor); if (!rows.length) break;
        const update = this.db.prepare('UPDATE edit_changes SET after=? WHERE op=? AND row=?');
        for (const row of rows) { const value = this.rowGet.get(row.row); update.run(value ? JSON.stringify(value) : null,this.operation,row.row); cursor=row.row; }
        this.flushTimes(); await this.diskBudget();
      }
      await this.recount();
      this.db.prepare('INSERT INTO edit_history VALUES(?,?,?,?)').run(this.operation,String(label).slice(0,200),before,after);
      this.cursor=this.operation; this.revision++;
      for (const [key,value] of Object.entries({header:after,cursor:this.cursor,saved:this.savedCursor,nextId:this.nextId,revision:this.revision})) this.setState(key,value);
      await this.diskBudget(); this.db.exec('COMMIT'); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      return { ...this.describe(), result };
    } catch(error) {
      this.db.exec('ROLLBACK'); this.chart=JSON.parse(before); Object.assign(this,previous); this.compile();this.statsReady=false;this.describe();this.speedGroups=this.db.prepare('SELECT DISTINCT l AS line,v AS speed FROM notes WHERE n>0 LIMIT 257').all();
      try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
      throw error;
    }
  }
  async recount() {
    this.flushTimes();
    if(this.endDirty)this.endTime=Number(this.db.prepare('SELECT MAX(e) AS n FROM notes WHERE n>0').get().n??0);
    if(this.speedGroups.length>256){this.speedGroups=this.db.prepare('SELECT DISTINCT l AS line,v AS speed FROM notes WHERE n>0 LIMIT 257').all();if(this.speedGroups.length>256)throw Error('不同流速组超过当前预览预算');}
    if(!this.timesDirty)return;
    this.db.exec('DELETE FROM times WHERE n<=0;DELETE FROM completions WHERE n<=0');
    let t=-Infinity,count=0;
    const update=this.db.prepare('UPDATE completions SET c=? WHERE t=?');
    for(;;){const rows=this.db.prepare('SELECT t,n FROM completions WHERE t>? ORDER BY t LIMIT 4096').all(t);if(!rows.length)break;for(const row of rows){count+=row.n;update.run(count,row.t);t=row.t;}}
  }
  flushTimes() {
    if(this.noteTimes?.size){const put=this.db.prepare('INSERT INTO times VALUES(?,?) ON CONFLICT(t) DO UPDATE SET n=n+excluded.n');for(const [t,n]of this.noteTimes)put.run(t,n);this.noteTimes.clear();}
    if(this.completionChanges?.size){const put=this.db.prepare('INSERT INTO completions(t,n) VALUES(?,?) ON CONFLICT(t) DO UPDATE SET n=n+excluded.n');for(const [t,n]of this.completionChanges)put.run(t,n);this.completionChanges.clear();this.timesDirty=true;}
  }
  page({ lines, start, end, pinned = [], selection }) {
    if(!this.enabled||!Array.isArray(lines)||lines.length>256||!lines.every(l=>Number.isInteger(l)&&this.chart.judgeLineList[l])||![start,end].every(finite)||end<start||!Array.isArray(pinned)||pinned.length>this.limits.windowGroups)throw Error('编辑区间无效');
    const found=new Map(),limit=this.limits.windowGroups;
    const query=this.db.prepare('SELECT n.*,(SELECT n>1 FROM times WHERE t=n.tick) AS multi FROM edit_visibility g JOIN notes n ON n.id=g.id WHERE g.l0<=? AND g.l1>=? AND g.b0<=? AND g.b1>=? AND n.n>0 LIMIT ?');
    for(const line of new Set(lines))for(const row of query.all(line,line,end,start,limit-found.size+1)){found.set(row.id,row);if(found.size>limit)throw Error('可见编辑区的不同音符过多，请提高纵向缩放后重试');}
    for(const id of pinned){if(!Number.isSafeInteger(id))throw Error('音符引用无效');const row=this.rowGet.get(id);if(row?.n>0)found.set(id,row);if(found.size>limit)throw Error('选中音符超过编辑页预算');}
    const selected = selection ? this.db.prepare('SELECT n FROM selected_notes WHERE selection=? AND id=?') : null;
    if (selection) {
      this.selections.get(selection);
      if(found.size<limit&&![...found.keys()].some(id=>selected.get(selection,id))){
        const sample=this.db.prepare('SELECT n.* FROM selected_notes s JOIN notes n ON n.id=s.id WHERE s.selection=? AND n.n>0 LIMIT 1').get(selection);
        if(sample)found.set(sample.id,sample);
      }
    }
    const notes=[...found.values()].sort((a,b)=>a.o-b.o||a.id-b.id).map(row=>({line:row.l,note:largeRowNote(row),multi:Boolean(row.multi),selected:selected?.get(selection,row.id)?.n??0}));
    let bytes=0;for(const entry of notes){bytes+=Buffer.byteLength(JSON.stringify(entry));if(bytes>24*1024**2)throw Error('编辑页属性超过内存传输预算');}
    return {revision:this.revision,header:this.chart,notes,start,end,lines};
  }
  soundNames() {
    const names = new Set(['tap','drag','flick']);
    for (const row of this.db.prepare("SELECT DISTINCT COALESCE(NULLIF(json_extract(j,'$.hitsound'),''),NULLIF(json_extract(j,'$.hitSound'),'')) AS sound FROM notes WHERE n>0 AND f=0 AND j IS NOT NULL").iterate()) {
      if (row.sound) names.add(row.sound);
      if (names.size > 512) throw Error('谱面打击音效种类超过渲染资源预算');
    }
    return [...names];
  }
  hits({ start, end, line = null, delays = {} }) {
    if (![start,end].every(Number.isFinite) || end < start || end - start > 2 || line !== null && !this.chart.judgeLineList[line]) throw Error('打击音效区间无效');
    const groups = new Map(), limit = this.limits.windowGroups;
    const query = this.db.prepare(`SELECT n.s,n.t,n.n,n.j FROM edit_visibility g JOIN notes n ON n.id=g.id
        WHERE g.l0<=? AND g.l1>=? AND g.b0<=? AND g.b1>=? AND n.l=? AND n.s>=? AND n.s<? AND n.f=0 AND n.n>0 AND (?=0 AND n.t IN(1,2) OR n.t=?)`);
    for (const index of line === null ? this.runtimes.keys() : [line]) {
      const factor = this.chart.judgeLineList[index].bpmfactor ?? 1;
      for (const [kind,type] of [['tap',0],['flick',3],['drag',4]]) {
        const delay = Number(delays[kind] ?? 0) / 1000;
        if(!Number.isFinite(delay))throw Error('打击音效延迟无效');
        const first=start-delay,last=end-delay;
        for (const row of query.iterate(index,index,this.tempo.beat(last,factor),this.tempo.beat(first,factor),index,first,last,type,type)) {
        const note = row.j ? JSON.parse(row.j) : null, sound = note?.hitsound || note?.hitSound || kind;
        const key = JSON.stringify([row.s,sound,kind]);
        const found = groups.get(key); if (found) found.count += row.n;
        else { groups.set(key,{ time:row.s,sound,kind,count:row.n }); if (groups.size > limit) throw Error('打击音效区间超过预算'); }
        }
      }
    }
    return { start, end, entries: [...groups.values()].sort((a,b)=>a.time-b.time) };
  }
  async edit({revision,label='编辑音符',changes=[],header,lineCopies=[],selectionBefore,selectionAfter}) {
    if(!Array.isArray(changes)||changes.length>40000)throw Error('单次修改超过编辑预算');
    if(!Array.isArray(lineCopies)||lineCopies.length>256)throw Error('判定线复制数量无效');
    return this.transactionEdit(label,async()=>{
      if(header)await this.updateHeader(header,lineCopies);
      const refs=[];
      for(const [index,change]of changes.entries()){
        if(change.id!==undefined){
          const row=this.rowGet.get(change.id);if(!row?.n)throw Error('音符已被修改或删除，请刷新后重试');
          const take=change.all?row.n:change.count??1;if(!Number.isSafeInteger(take)||take<1||take>row.n)throw Error('音符数量无效');
          this.remember(row.id);
          if(change.note){
            if(take===row.n){const next=this.noteRow(change.note,change.line??row.l,{id:row.id,count:take,order:row.o});this.write(next);refs.push(next.id);}
            else{this.write({...row,n:row.n-take});const next=this.noteRow(change.note,change.line??row.l,{count:take,order:row.o});this.remember(next.id);this.write(next);refs.push(next.id);}
          }else this.write({...row,n:row.n-take});
        }else{if(!change.note)throw Error('新增音符缺少属性');const next=this.noteRow(change.note,change.line,{count:change.count??1});this.remember(next.id);this.write(next);refs.push(next.id);}
        if(index%1024===1023){this.flushTimes();await this.diskBudget();this.progress({phase:'edit',ratio:(index+1)/changes.length});}
      }
      if(selectionBefore&&selectionAfter){
        const after={...selectionAfter,noteIds:(selectionAfter.noteIds??[]).map(value=>typeof value==='object'?refs[value.change]:value).filter(Number.isSafeInteger)};
        const before=JSON.stringify(selectionBefore),serializedAfter=JSON.stringify(after);
        if(before.length+serializedAfter.length>2*1024**2)throw Error('选择状态超过编辑预算');
        this.db.prepare('INSERT INTO edit_selections VALUES(?,?,?)').run(this.operation,before,serializedAfter);
      }
      return refs;
    },revision);
  }
  async updateHeader(value, lineCopies = []) {
    const header=largeChartHeader(value),old=this.chart,ids=new Set();
    for(const line of header.judgeLineList){line[LINE]??=randomUUID();if(ids.has(line[LINE]))throw Error('判定线标识重复');ids.add(line[LINE]);}
    const mapping=old.judgeLineList.map(line=>header.judgeLineList.findIndex(next=>next[LINE]===line[LINE]));
    const clock=line=>JSON.stringify({bpm:line.bpmfactor,speeds:line.eventLayers?.map(layer=>layer?.speedEvents)});
    const timing=JSON.stringify(old.BPMList)!==JSON.stringify(header.BPMList)||old.judgeLineList.some((line,i)=>mapping[i]!==i||clock(line)!==clock(header.judgeLineList[mapping[i]]??{}));
    this.chart=header;this.compile();
    let cursor=0;
    if(timing){this.speedGroups=[];
      for(;;){const rows=this.db.prepare('SELECT * FROM notes WHERE id>? AND n>0 ORDER BY id LIMIT 2048').all(cursor);if(!rows.length)break;for(const row of rows){this.remember(row.id);const l=mapping[row.l];this.write(l<0?{...row,n:0}:this.noteRow(largeRowNote(row,false),l,{id:row.id,count:row.n,order:row.o}));cursor=row.id;}this.flushTimes();await this.diskBudget();this.progress({phase:'reindex',notes:cursor,ratio:0});}
    }
    for(const copy of lineCopies){
      const source=header.judgeLineList.findIndex(line=>line[LINE]===copy.source),target=header.judgeLineList.findIndex(line=>line[LINE]===copy.target);
      if(source<0||target<0||source===target||old.judgeLineList.some(line=>line[LINE]===copy.target))throw Error('判定线复制引用无效');
      for(let cursor=0;;){const rows=this.db.prepare('SELECT * FROM notes WHERE id>? AND l=? AND n>0 ORDER BY id LIMIT 2048').all(cursor,source);if(!rows.length)break;
        for(const row of rows){const next=this.noteRow(largeRowNote(row,false),target,{count:row.n});this.remember(next.id);this.write(next);cursor=row.id;}
        this.flushTimes();await this.diskBudget();this.progress({phase:'copy-line',notes:cursor,ratio:0});
      }
    }
  }
  async travel({direction,revision}) {
    this.checkRevision(revision);const operation=direction==='undo'?this.db.prepare('SELECT * FROM edit_history WHERE id<=? ORDER BY id DESC LIMIT 1').get(this.cursor):direction==='redo'?this.db.prepare('SELECT * FROM edit_history WHERE id>? ORDER BY id LIMIT 1').get(this.cursor):null;
    if(!operation)return this.describe();
    const field=direction==='undo'?'before':'after',old=JSON.stringify(this.chart);this.noteTimes=new Map();this.completionChanges=new Map();this.timesDirty=false;this.endDirty=false;this.db.exec('BEGIN IMMEDIATE');
    try{
      this.chart=JSON.parse(operation[field]);this.compile();let cursor=0;
      for(;;){const rows=this.db.prepare('SELECT row,before,after FROM edit_changes WHERE op=? AND row>? ORDER BY row LIMIT 2048').all(operation.id,cursor);if(!rows.length)break;for(const change of rows){const row=change[field]?JSON.parse(change[field]):null;if(row)this.write(row);else{this.countChange(this.rowGet.get(change.row),-1);this.db.prepare('DELETE FROM notes WHERE id=?').run(change.row);this.db.prepare('DELETE FROM visibility WHERE id=?').run(change.row);this.db.prepare('DELETE FROM edit_visibility WHERE id=?').run(change.row);}cursor=change.row;}this.flushTimes();await this.diskBudget();}
      await this.recount();const next=direction==='undo'?Number(this.db.prepare('SELECT MAX(id) AS n FROM edit_history WHERE id<?').get(operation.id).n??0):operation.id;
      this.setState('header',JSON.stringify(this.chart));this.setState('cursor',next);this.setState('revision',this.revision+1);this.db.exec('COMMIT');this.cursor=next;this.revision++;this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const selection=this.db.prepare('SELECT before,after FROM edit_selections WHERE op=?').get(operation.id);
      return {...this.describe(),restoredSelection:selection?JSON.parse(selection[field]):undefined,sourceSelection:selection?JSON.parse(selection[direction==='undo'?'after':'before']):undefined};
    }catch(error){this.db.exec('ROLLBACK');this.chart=JSON.parse(old);this.compile();this.statsReady=false;this.describe();this.speedGroups=this.db.prepare('SELECT DISTINCT l AS line,v AS speed FROM notes WHERE n>0 LIMIT 257').all();throw error;}
  }
  async saveDatabase(destination) {
    if(!this.enabled)throw Error('超大谱尚未进入编辑模式');await this.diskBudget();
    await this.budget();
    const pending=destination+'.'+randomUUID()+'.partial';
    try{
      await this.persistMedia();
      await largeChartSpace(dirname(destination), Number(this.db.prepare('PRAGMA page_count').get().page_count) * 4096 + 1024 ** 3);
      this.setState('summary',JSON.stringify({...this.summary,chart:this.chart,media:this.media}));
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      await backup(this.db,pending,{rate:128,progress:async({totalPages,remainingPages})=>{this.progress({phase:'save',ratio:1-remainingPages/Math.max(1,totalPages)});}});
      const verify=new DatabaseSync(pending);try{
        verify.exec('PRAGMA journal_mode=DELETE');
        verify.prepare("UPDATE document_state SET v=? WHERE k='saved'").run(String(this.cursor));
        if(verify.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('工程保存校验失败');
      }finally{verify.close();}
      const handle=await open(pending,'r+');try{await handle.sync();}finally{await handle.close();}
      await rename(pending,destination);this.savedCursor=this.cursor;this.setState('saved',this.savedCursor);return this.describe();
    }catch(error){this.setState('saved',this.savedCursor);await unlink(pending).catch(()=>{});throw error;}
  }
  async restoreDatabase(path) {
    if((await stat(path)).size>this.limits.databaseBytes)throw Error('超大谱工程超过数据库预算');
    this.db=new DatabaseSync(path);this.db.exec('PRAGMA trusted_schema=OFF;PRAGMA cache_size=-8192;PRAGMA mmap_size=0;PRAGMA temp_store=MEMORY');
    if(this.db.prepare('PRAGMA application_id').get().application_id!==1380992332||this.db.prepare("SELECT type FROM sqlite_schema WHERE name='document_state'").get()?.type!=='table'||this.state('format')!=='rpen-large-document-1')throw Error('不是有效的超大谱工程');
    for(const table of['notes','edit_history','edit_changes','times','completions','document_media'])if(this.db.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(table)?.type!=='table')throw Error('超大谱工程表结构无效');
    const summary=this.state('summary');if(!summary||Buffer.byteLength(summary)>8*1024**2)throw Error('超大谱工程摘要无效');
    const saved=JSON.parse(summary);this.summary=saved;this.chart=largeChartHeader(saved.chart);this.media={};this.mediaBytes=0;
    for(const row of this.db.prepare('SELECT role,name,length(data) AS size FROM document_media').all()){
      if(!['music','cover'].includes(row.role)||!new RegExp('^'+row.role+'\\.[a-z0-9]{1,8}$').test(row.name)||row.size>this.limits.mediaBytes||(this.mediaBytes+=row.size)>this.limits.mediaBytes)throw Error('工程素材超过预算或路径无效');
      const data=this.db.prepare('SELECT data FROM document_media WHERE role=?').get(row.role).data;await writeFile(join(this.workspace,row.name),data,{flag:'wx'});this.media[row.role]=row.name;
    }
    const savedRevision=Number(this.state('revision')??0);
    if(saved.revision===savedRevision&&saved.lines&&[saved.total,saved.unique,saved.realNotes,saved.endTime].every(Number.isFinite)){
      this.total=saved.total;this.unique=saved.unique;this.realNotes=saved.realNotes;this.endTime=saved.endTime;this.lineCounts=saved.lines;this.statsReady=true;
    }
    this.speedGroups=Array.isArray(saved.speedGroups)&&saved.speedGroups.length<=256?saved.speedGroups:this.db.prepare('SELECT DISTINCT l AS line,v AS speed FROM notes WHERE n>0 LIMIT 257').all();await this.editable();return this.describe();
  }
  async persistMedia() {
    for(const [role,name]of Object.entries(this.media))if(!this.db.prepare('SELECT 1 FROM document_media WHERE role=?').get(role)){
      const bytes=await readFile(join(this.workspace,name));this.db.prepare('INSERT INTO document_media VALUES(?,?,?)').run(role,name,bytes);await this.diskBudget();
    }
    this.setState('summary',JSON.stringify({...this.summary,chart:this.chart,media:this.media}));
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}
