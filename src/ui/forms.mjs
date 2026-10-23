import { showDialog } from './dialog.mjs';
import { parseBeat, formatBeat } from '../core/beat.mjs';
import { assertChart } from '../core/chart.mjs';
import { t } from '../i18n.mjs';

export function editMetadata(session) {
  const content = showDialog(t('forms.sd352b59'), t('forms.sfe3ef8e'));
  const fields = new Map();
  for (const [key, title] of Object.entries({ name: t('forms.scaeac8b'), composer: t('forms.sc36f907'), charter: t('forms.sf6379dd'), illustration: t('forms.s687c35c'), level: t('forms.s205aff9'), offset: t('forms.s50284d4') })) {
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    const input = document.createElement('input'); input.setAttribute('aria-label', title); input.value = session.chart.META[key] ?? ''; input.type = key === 'offset' ? 'number' : 'text';
    label.append(input); content.append(label); fields.set(key, input);
  }
  const apply = document.querySelector('#modal-apply'); apply.hidden = false;
  apply.onclick = () => {
    try {
      const metadata = { ...session.chart.META };
      for (const [key, input] of fields) metadata[key] = key === 'offset' ? Number(input.value) : input.value;
      const next = { ...session.chart, META: metadata }; assertChart(next); session.commit(t('forms.sd352b59'), next); document.querySelector('#modal').close();
    } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  };
}

export function editBpm(session) {
  const content = showDialog(t('forms.s04835b1'), t('forms.s846acb1'));
  const rows = [];
  const add = entry => {
    const row = document.createElement('div'); row.className = 'bpm-row';
    const time = document.createElement('input'); time.setAttribute('aria-label', t('forms.s7abdebb')); time.value = formatBeat(entry.startTime);
    const bpm = document.createElement('input'); bpm.type = 'number'; bpm.step = 'any'; bpm.setAttribute('aria-label', t('forms.sf031e6e')); bpm.value = entry.bpm;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('forms.s3755f56');
    const record = { row, time, bpm, original: entry, removed: false }; rows.push(record);
    remove.onclick = () => { record.removed = true; row.remove(); };
    row.append(time, bpm, remove); content.append(row);
  };
  session.chart.BPMList.forEach(add);
  const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = t('forms.s0cff33f'); plus.onclick = () => add({ bpm: 120, startTime: [0, 0, 1] }); content.append(plus);
  const apply = document.querySelector('#modal-apply'); apply.hidden = false;
  apply.onclick = () => {
    try {
      const entries = rows.filter(row => !row.removed).map(row => ({ ...row.original, bpm: Number(row.bpm.value), startTime: row.time.value === formatBeat(row.original.startTime) ? row.original.startTime : parseBeat(row.time.value) }));
      const next = { ...session.chart, BPMList: entries }; assertChart(next); session.commit(t('forms.s04835b1'), next); document.querySelector('#modal').close();
    } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  };
}

export function renderMetadataPanel(session, host, onCommit) {
  host.replaceChildren();
  const fields = new Map();
  for (const [key, title] of Object.entries({ name: t('forms.scaeac8b'), composer: t('forms.sc36f907'), charter: t('forms.sf6379dd'), illustration: t('forms.s687c35c'), level: t('forms.s205aff9'), offset: t('forms.s50284d4') })) {
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    const input = document.createElement('input'); input.type = key === 'offset' ? 'number' : 'text'; input.value = session.chart.META[key] ?? ''; label.append(input); fields.set(key, input); host.append(label);
  }
  const apply = document.createElement('button'); apply.className = 'wide-button'; apply.textContent = t('forms.s1e2d799');
  apply.onclick = () => { try { const metadata = { ...session.chart.META }; for (const [key, input] of fields) metadata[key] = key === 'offset' ? Number(input.value) : input.value; const next = { ...session.chart, META: metadata }; assertChart(next); session.commit(t('forms.sd352b59'), next); onCommit?.(); } catch (error) { apply.textContent = error.message; } };
  host.append(apply);
}

export function renderBpmPanel(session, host) {
  host.replaceChildren(); const rows = [];
  const content = document.createElement('div'); content.className = 'bpm-rows'; host.append(content);
  const add = entry => {
    const row = document.createElement('div'); row.className = 'bpm-row'; const time = document.createElement('input'); time.setAttribute('aria-label', t('forms.s7abdebb')); time.value = formatBeat(entry.startTime); const bpm = document.createElement('input'); bpm.type = 'number'; bpm.step = 'any'; bpm.setAttribute('aria-label', t('forms.sf031e6e')); bpm.value = entry.bpm; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('forms.s3755f56');
    const record = { row, time, bpm, original: entry, removed: false }; rows.push(record); remove.onclick = () => { record.removed = true; row.remove(); }; row.append(time, bpm, remove);
    content.append(row);
  };
  session.chart.BPMList.forEach(add);
  const controls = document.createElement('div'); controls.className = 'bpm-actions';
  const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = t('forms.s0cff33f'); plus.onclick = () => { add({ bpm: 120, startTime: [0, 0, 1] }); content.lastElementChild?.querySelector('input')?.focus(); }; controls.append(plus); host.append(controls);
  const apply = document.createElement('button'); apply.className = 'wide-button'; apply.textContent = t('forms.s8ed023f'); apply.onclick = () => { try { const entries = rows.filter(row => !row.removed).map(row => ({ ...row.original, bpm: Number(row.bpm.value), startTime: row.time.value === formatBeat(row.original.startTime) ? row.original.startTime : parseBeat(row.time.value) })); const next = { ...session.chart, BPMList: entries }; assertChart(next); session.commit(t('forms.s04835b1'), next); apply.textContent = t('forms.sc92ca0f'); setTimeout(() => { if (apply.isConnected) apply.textContent = t('forms.s8ed023f'); }, 1200); } catch (error) { apply.textContent = error.message; } }; host.append(apply);
}
