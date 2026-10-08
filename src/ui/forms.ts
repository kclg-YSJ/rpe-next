import { showDialog } from './dialog.ts';
import { parseBeat, formatBeat } from '../core/beat.ts';
import { assertChart } from '../core/chart.ts';
import type { EditorSession } from '../application/session.ts';
import type { BpmEntry, ChartMeta } from '../core/types.ts';

/**
 * The session surface the metadata/BPM forms drive.
 *
 * Narrowed to the members actually used; `EditorSession` is structurally assignable to it.
 */
export interface MetadataFormSession {
  chart: EditorSession['chart'];
  commit(label: string, chart: EditorSession['chart']): void;
}

/** The metadata keys the forms expose, paired with their Chinese labels. */
const METADATA_FIELDS: Record<string, string> = { name: '曲名', composer: '曲师', charter: '谱师', illustration: '画师', level: '难度', offset: '偏移 / 毫秒' };

/** One editable BPM row, kept so apply can skip removed rows and detect untouched beats. */
interface BpmRow {
  row: HTMLDivElement;
  time: HTMLInputElement;
  bpm: HTMLInputElement;
  original: BpmEntry;
  removed: boolean;
}

/**
 * Collects the metadata edits into a new META object.
 *
 * `offset` is the only numeric field; the rest stay text. The cast is needed because the form keys
 * are opened dynamically (`Object.entries`) while `ChartMeta` is closed — the resulting object is
 * handed straight to `assertChart`, which validates `offset`.
 */
function readMetadata(fields: Map<string, HTMLInputElement>, session: MetadataFormSession): ChartMeta {
  const metadata = { ...session.chart.META };
  const target = metadata as unknown as Record<string, unknown>;
  for (const [key, input] of fields) target[key] = key === 'offset' ? Number(input.value) : input.value;
  return metadata;
}

/** Builds the label + input pair both metadata forms use. */
function metadataField(key: string, title: string, value: unknown): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label'); label.className = 'field'; label.append(title);
  const input = document.createElement('input'); input.setAttribute('aria-label', title);
  input.value = String(value ?? ''); input.type = key === 'offset' ? 'number' : 'text';
  return { label, input };
}

/** Reads the BPM rows back into entries, keeping the original beat when the text is unchanged. */
function readBpmEntries(rows: BpmRow[]): BpmEntry[] {
  return rows.filter(row => !row.removed).map(row => ({ ...row.original, bpm: Number(row.bpm.value),
    startTime: row.time.value === formatBeat(row.original.startTime) ? row.original.startTime : parseBeat(row.time.value) }));
}

/** Appends one editable BPM row to `host` and records it. */
function appendBpmRow(host: HTMLElement, entry: BpmEntry, rows: BpmRow[]): void {
  const row = document.createElement('div'); row.className = 'bpm-row';
  const time = document.createElement('input'); time.setAttribute('aria-label', 'BPM 起始拍'); time.value = formatBeat(entry.startTime);
  const bpm = document.createElement('input'); bpm.type = 'number'; bpm.step = 'any'; bpm.setAttribute('aria-label', 'BPM 数值'); bpm.value = String(entry.bpm);
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
  const record: BpmRow = { row, time, bpm, original: entry, removed: false }; rows.push(record);
  remove.onclick = () => { record.removed = true; row.remove(); };
  row.append(time, bpm, remove); host.append(row);
}

export function editMetadata(session: MetadataFormSession): void {
  const content = showDialog('谱面信息', '修改谱面信息；音乐和封面使用“谱面”面板中的资源按钮选择。');
  const fields = new Map<string, HTMLInputElement>();
  for (const [key, title] of Object.entries(METADATA_FIELDS)) {
    const { label, input } = metadataField(key, title, session.chart.META[key]);
    label.append(input); content.append(label); fields.set(key, input);
  }
  const apply = document.querySelector('#modal-apply') as HTMLButtonElement;
  apply.hidden = false;
  apply.onclick = () => {
    try {
      const next = { ...session.chart, META: readMetadata(fields, session) }; assertChart(next); session.commit('谱面信息', next); (document.querySelector('#modal') as HTMLDialogElement).close();
    } catch (error) { (document.querySelector('#modal-error') as HTMLElement).textContent = error instanceof Error ? error.message : String(error); }
  };
}

export function editBpm(session: MetadataFormSession): void {
  const content = showDialog('BPM 列表', '每行填写起始拍与 BPM；拍数支持 3:1/4。整次修改作为一步撤销。');
  const rows: BpmRow[] = [];
  const add = (entry: BpmEntry): void => appendBpmRow(content, entry, rows);
  session.chart.BPMList.forEach(add);
  const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '添加 BPM'; plus.onclick = () => add({ bpm: 120, startTime: [0, 0, 1] }); content.append(plus);
  const apply = document.querySelector('#modal-apply') as HTMLButtonElement; apply.hidden = false;
  apply.onclick = () => {
    try {
      const next = { ...session.chart, BPMList: readBpmEntries(rows) }; assertChart(next); session.commit('BPM 列表', next); (document.querySelector('#modal') as HTMLDialogElement).close();
    } catch (error) { (document.querySelector('#modal-error') as HTMLElement).textContent = error instanceof Error ? error.message : String(error); }
  };
}

export function renderMetadataPanel(session: MetadataFormSession, host: HTMLElement, onCommit?: () => void): void {
  host.replaceChildren();
  const fields = new Map<string, HTMLInputElement>();
  for (const [key, title] of Object.entries(METADATA_FIELDS)) {
    const { label, input } = metadataField(key, title, session.chart.META[key]);
    label.append(input); fields.set(key, input); host.append(label);
  }
  const apply = document.createElement('button'); apply.className = 'wide-button'; apply.textContent = '应用谱面信息';
  apply.onclick = () => { try { const next = { ...session.chart, META: readMetadata(fields, session) }; assertChart(next); session.commit('谱面信息', next); onCommit?.(); } catch (error) { apply.textContent = error instanceof Error ? error.message : String(error); } };
  host.append(apply);
}

export function renderBpmPanel(session: MetadataFormSession, host: HTMLElement, onCommit?: () => void): void {
  host.replaceChildren(); const rows: BpmRow[] = [];
  const add = (entry: BpmEntry): void => appendBpmRow(host, entry, rows);
  session.chart.BPMList.forEach(add); const plus = document.createElement('button'); plus.textContent = '添加 BPM'; plus.onclick = () => add({ bpm: 120, startTime: [0, 0, 1] }); host.append(plus);
  const apply = document.createElement('button'); apply.className = 'wide-button'; apply.textContent = '应用 BPM 列表'; apply.onclick = () => { try { const next = { ...session.chart, BPMList: readBpmEntries(rows) }; assertChart(next); session.commit('BPM 列表', next); onCommit?.(); } catch (error) { apply.textContent = error instanceof Error ? error.message : String(error); } }; host.append(apply);
}
