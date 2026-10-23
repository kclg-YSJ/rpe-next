import { showDialog } from './dialog.mjs';
import { reorderLine, deleteLine, duplicateLine, setLineParent } from '../application/line-commands.mjs';
import { t } from '../i18n.mjs';

export function manageLines(session) {
  if (!session.line) throw new Error(t('line-dialog.sb9277d1'));
  const content = showDialog(t('line-dialog.s505e7f5'), t('line-dialog.s9579e4a'));
  const summary = document.createElement('p');
  summary.textContent = t('line-dialog.s1220357', { p0: session.lineIndex, p1: session.line.Name || t('line-dialog.s3556306') });
  content.append(summary);
  const failure = document.createElement('p'); failure.setAttribute('role', 'alert');
  const button = (name, action, disabled = false) => {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = name; element.disabled = disabled;
    element.onclick = () => {
      try { action(); if (session.line) manageLines(session); else showDialog(t('line-dialog.sa9b55d8'), t('line-dialog.scffd687')); }
      catch (error) { failure.textContent = error.message; }
    };
    content.append(element);
  };
  const apply = (label, chart, index = session.lineIndex) => {
    const beforeSelection = session.selectionState();
    session.lineIndex = index;
    session.selection.clear();
    session.eventSelection.clear();
    session.commit(label, chart, beforeSelection);
  };
  const name = document.createElement('input'); name.value = session.line.Name || ''; name.setAttribute('aria-label', t('line-dialog.s6b5b88f')); content.append(name);
  button(t('line-dialog.s1cd80fd'), () => session.updateLine(t('line-dialog.sfecb2bd'), line => ({ ...line, Name: name.value })));
  const parent = document.createElement('select'); parent.setAttribute('aria-label', t('line-dialog.sa378d28'));
  for (const [index, line] of [[-1, { Name: t('line-dialog.s656be2d') }], ...session.chart.judgeLineList.entries()]) {
    if (index === session.lineIndex) continue;
    const option = document.createElement('option'); option.value = index; option.textContent = t('line-dialog.sf21fa0c', { p0: index, p1: line.Name || t('line-dialog.s3556306') }); parent.append(option);
  }
  parent.value = session.line.father ?? -1;
  if (!parent.value) parent.value = -1;
  content.append(parent);
  button(t('line-dialog.sd897aca'), () => apply(t('line-dialog.sd897aca'), setLineParent(session.chart, session.lineIndex, Number(parent.value))));
  const zOrder = document.createElement('input'); zOrder.type = 'number'; zOrder.step = '1'; zOrder.value = Number(session.line.zOrder ?? 0); zOrder.setAttribute('aria-label', t('line-dialog.s7f92380')); content.append(zOrder);
  const rotateWithFather = document.createElement('label'); const rotateToggle = document.createElement('input'); rotateToggle.type = 'checkbox'; rotateToggle.checked = session.line.rotateWithFather ?? ((session.chart.META?.RPEVersion ?? 0) >= 163); rotateToggle.setAttribute('aria-label', t('line-dialog.s84cf796')); rotateWithFather.append(rotateToggle, t('line-dialog.s6f0d8d8')); content.append(rotateWithFather);
  button(t('line-dialog.s3323ffb'), () => {
    const value = Number(zOrder.value);
    if (!Number.isFinite(value)) throw new Error(t('line-dialog.s7d66d27'));
    session.updateLine(t('line-dialog.sbbc3369'), line => ({ ...line, zOrder: Math.trunc(value), rotateWithFather: rotateToggle.checked }));
  });
  button(t('line-dialog.s8a0c839'), () => apply(t('line-dialog.s8f391a6'), reorderLine(session.chart, session.lineIndex, session.lineIndex - 1), session.lineIndex - 1), session.lineIndex === 0);
  button(t('line-dialog.s05c46fa'), () => apply(t('line-dialog.s95827fe'), reorderLine(session.chart, session.lineIndex, session.lineIndex + 1), session.lineIndex + 1), session.lineIndex === session.chart.judgeLineList.length - 1);
  button(t('line-dialog.s745900a'), () => apply(t('line-dialog.s745900a'), duplicateLine(session.chart, session.lineIndex), session.chart.judgeLineList.length));
  button(t('line-dialog.s6245754'), () => apply(t('line-dialog.s6245754'), deleteLine(session.chart, session.lineIndex), Math.max(0, session.lineIndex - 1)));
  content.append(failure);
}
