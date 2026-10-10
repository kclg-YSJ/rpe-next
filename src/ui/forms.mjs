import { showDialog } from './dialog.mjs';
import { parseBeat, formatBeat } from '../core/beat.mjs';
import { assertChart } from '../core/chart.mjs';

export function editMetadata(session) {
  const content = showDialog('谱面信息', '修改谱面信息；音乐和封面使用“谱面”面板中的资源按钮选择。');
  const fields = new Map();
  for (const [key, title] of Object.entries({ name: '曲名', composer: '曲师', charter: '谱师', illustration: '画师', level: '难度', offset: '偏移 / 毫秒' })) {
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    const input = document.createElement('input'); input.setAttribute('aria-label', title); input.value = session.chart.META[key] ?? ''; input.type = key === 'offset' ? 'number' : 'text';
    label.append(input); content.append(label); fields.set(key, input);
  }
  const apply = document.querySelector('#modal-apply'); apply.hidden = false;
  apply.onclick = () => {
    try {
      const metadata = { ...session.chart.META };
      for (const [key, input] of fields) metadata[key] = key === 'offset' ? Number(input.value) : input.value;
      const next = { ...session.chart, META: metadata }; assertChart(next); session.commit('谱面信息', next); document.querySelector('#modal').close();
    } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  };
}

export function editBpm(session) {
  const content = showDialog('BPM 列表', '每行填写起始拍与 BPM；拍数支持 3:1/4。整次修改作为一步撤销。');
  const rows = [];
  const add = entry => {
    const row = document.createElement('div'); row.className = 'bpm-row';
    const time = document.createElement('input'); time.setAttribute('aria-label', 'BPM 起始拍'); time.value = formatBeat(entry.startTime);
    const bpm = document.createElement('input'); bpm.type = 'number'; bpm.step = 'any'; bpm.setAttribute('aria-label', 'BPM 数值'); bpm.value = entry.bpm;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
    const record = { row, time, bpm, original: entry, removed: false }; rows.push(record);
    remove.onclick = () => { record.removed = true; row.remove(); };
    row.append(time, bpm, remove); content.append(row);
  };
  session.chart.BPMList.forEach(add);
  const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '添加 BPM'; plus.onclick = () => add({ bpm: 120, startTime: [0, 0, 1] }); content.append(plus);
  const apply = document.querySelector('#modal-apply'); apply.hidden = false;
  apply.onclick = () => {
    try {
      const entries = rows.filter(row => !row.removed).map(row => ({ ...row.original, bpm: Number(row.bpm.value), startTime: row.time.value === formatBeat(row.original.startTime) ? row.original.startTime : parseBeat(row.time.value) }));
      const next = { ...session.chart, BPMList: entries }; assertChart(next); session.commit('BPM 列表', next); document.querySelector('#modal').close();
    } catch (error) { document.querySelector('#modal-error').textContent = error.message; }
  };
}

export function renderMetadataPanel(session, host, onCommit) {
  host.replaceChildren();
  const fields = new Map();
  for (const [key, title] of Object.entries({ name: '曲名', composer: '曲师', charter: '谱师', illustration: '画师', level: '难度', offset: '偏移 / 毫秒' })) {
    const label = document.createElement('label'); label.className = 'field'; label.append(title);
    const input = document.createElement('input'); input.type = key === 'offset' ? 'number' : 'text'; input.value = session.chart.META[key] ?? ''; label.append(input); fields.set(key, input); host.append(label);
  }
  const compatibility = document.createElement('label'); compatibility.className = 'field'; compatibility.append('噪域：三次及以上反转无效');
  const ignoreTripleInversion = document.createElement('input'); ignoreTripleInversion.type = 'checkbox'; ignoreTripleInversion.setAttribute('aria-label', '噪域：三次及以上反转无效'); ignoreTripleInversion.checked = session.chart.noiseAreaOptions?.ignoreTripleInversion === true; compatibility.append(ignoreTripleInversion); host.append(compatibility);
  const compatibilityHint = document.createElement('p'); compatibilityHint.className = 'hint'; compatibilityHint.textContent = '仅作用于此谱面。各状态层分别计算反转，激活层显示在未激活层上方。开启后，同一状态层中，同一点被两个或更多反转块覆盖时保留该层普通噪域的覆盖；关闭时按奇偶次数反转。官谱导入默认开启。'; host.append(compatibilityHint);
  const apply = document.createElement('button'); apply.className = 'wide-button'; apply.textContent = '应用谱面信息';
  apply.onclick = () => { try { const metadata = { ...session.chart.META }; for (const [key, input] of fields) metadata[key] = key === 'offset' ? Number(input.value) : input.value; const next = { ...session.chart, META: metadata, noiseAreaOptions: { ...session.chart.noiseAreaOptions, ignoreTripleInversion: ignoreTripleInversion.checked } }; assertChart(next); session.commit('谱面信息', next); onCommit?.(); } catch (error) { apply.textContent = error.message; } };
  host.append(apply);
}

export function renderBpmPanel(session, host, onCommit) {
  host.replaceChildren(); const rows = [];
  const add = entry => {
    const row = document.createElement('div'); row.className = 'bpm-row'; const time = document.createElement('input'); time.value = formatBeat(entry.startTime); const bpm = document.createElement('input'); bpm.type = 'number'; bpm.step = 'any'; bpm.value = entry.bpm; const remove = document.createElement('button'); remove.textContent = '删除';
    const record = { row, time, bpm, original: entry, removed: false }; rows.push(record); remove.onclick = () => { record.removed = true; row.remove(); }; row.append(time, bpm, remove); host.append(row);
  };
  session.chart.BPMList.forEach(add); const plus = document.createElement('button'); plus.textContent = '添加 BPM'; plus.onclick = () => add({ bpm: 120, startTime: [0, 0, 1] }); host.append(plus);
  const apply = document.createElement('button'); apply.className = 'wide-button'; apply.textContent = '应用 BPM 列表'; apply.onclick = () => { try { const entries = rows.filter(row => !row.removed).map(row => ({ ...row.original, bpm: Number(row.bpm.value), startTime: row.time.value === formatBeat(row.original.startTime) ? row.original.startTime : parseBeat(row.time.value) })); const next = { ...session.chart, BPMList: entries }; assertChart(next); session.commit('BPM 列表', next); onCommit?.(); } catch (error) { apply.textContent = error.message; } }; host.append(apply);
}
