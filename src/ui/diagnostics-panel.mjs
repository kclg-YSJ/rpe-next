import { t } from '../i18n.mjs';

export function diagnosticSubtype(issue) {
  if (issue.code === 'timeRange') return t(issue.path.startsWith('notes[') ? 'diag.noteTimeRange' : 'diag.eventTimeRange');
  const key = { shortRead: 'shortReadGroup', tapAfterFlick: 'tapAfterFlickGroup', tapAfterDrag: 'tapAfterDragGroup',
    assetMissing: 'assetMissingGroup', assetAmbiguous: 'assetAmbiguousGroup', assetConfig: 'assetConfigGroup', shaderUniformMissing: 'shaderUniformMissingGroup', shaderUniformType: 'shaderUniformTypeGroup',
    modMissing: 'modMissingGroup', modVersion: 'modVersionGroup', globalRule: 'globalRuleGroup', globalCheckFailure: 'globalCheckGroup', eventOverlap: 'eventOverlapGroup', missingBaseline: 'missingBaselineGroup' }[issue.code];
  if (key) return t('diag.' + key);
  return issue.message;
}

export class DiagnosticsPanel {
  constructor(controller, { locate, remove, visible }) {
    Object.assign(this, { controller, locate, remove, visible }); this.limits = {}; this.lastIssues = null; this.folded = new Map();
    const host = document.querySelector('[data-panel=diagnose]');
    const actions = document.createElement('div'); actions.className = 'diagnose-actions';
    this.target = document.createElement('select'); this.target.id = 'diagnose-target'; this.target.setAttribute('aria-label', t('diag.target'));
    this.target.append(new Option('RPE Next', 'next'), new Option('RPE', 'rpe'), new Option('Phira', 'phira'));
    this.target.onchange = () => { controller.target = this.target.value; controller.update(); };
    this.deep = document.createElement('button'); this.deep.type = 'button'; this.deep.id = 'diagnose-deep'; this.deep.onclick = () => controller.startDeep();
    this.state = document.createElement('p'); this.state.className = 'hint diagnose-state'; this.state.setAttribute('role', 'status');
    actions.append(this.target, this.deep); host.querySelector('#diagnose-results').before(actions, this.state);
    controller.addEventListener('change', () => { if (this.visible()) this.render(); });
    controller.addEventListener('progress', () => { if (this.visible()) this.render(); });
  }
  render() {
    const c = this.controller, host = document.querySelector('#diagnose-results');
    this.deep.textContent = t(c.running ? 'diag.cancel' : 'diag.deep');
    this.state.textContent = c.error ? c.error : c.running ? t('diag.progress', { done: c.progress?.completed ?? 0, total: c.progress?.total ?? '…' }) : c.pending ? t('diag.pending') : c.deepComplete ? t('diag.complete') : '';
    this.state.classList.toggle('error', Boolean(c.error));
    if (this.lastIssues === c.issues && this.lastLow === document.querySelector('#diagnose-show-low').checked) return;
    for (const details of host.querySelectorAll('details[data-diagnostic-group]')) this.folded.set(details.dataset.diagnosticGroup, details.open);
    this.lastIssues = c.issues; this.lastLow = document.querySelector('#diagnose-show-low').checked; host.replaceChildren();
    for (const [severity, title] of [['error', t('app.sb859c7b')], ['warning', t('app.s5521e36')], ['info', t('app.sab3656a')]]) {
      const issues = c.issues.filter(issue => issue.severity === severity); if (severity === 'info' && !this.lastLow) continue;
      const group = this.details(severity, `diagnose-group ${severity}`);
      const summary = document.createElement('summary'); summary.textContent = `${title}（${issues.length}）`; group.append(summary);
      const limit = this.limits[severity] ?? 80, subgroups = new Map(), types = new Map(), totals = new Map();
      for (const issue of issues) { const key = this.kind(issue) + ':' + (issue.code ?? issue.message); totals.set(key, (totals.get(key) ?? 0) + 1); }
      for (const issue of issues.slice(0, limit)) {
        const kind = this.kind(issue), typeKey = kind + ':' + (issue.code ?? issue.message);
        if (!subgroups.has(kind)) { const details = this.details(`${severity}:${kind}`, 'diagnose-subgroup'); const heading = document.createElement('summary'); heading.textContent = this.kindLabel(kind); details.append(heading); subgroups.set(kind, details); group.append(details); }
        if (!types.has(typeKey)) { const details = this.details(`${severity}:${typeKey}`, 'diagnose-type'); details.dataset.diagnosticType = issue.code ?? ''; const heading = document.createElement('summary'); heading.textContent = `${diagnosticSubtype(issue)}（${totals.get(typeKey)}）`; details.append(heading); types.set(typeKey, details); subgroups.get(kind).append(details); }
        const row = document.createElement('div'); row.className = `diagnose-item ${severity}`; row.dataset.diagnosticCode = issue.code ?? '';
        const locate = document.createElement('button'); locate.type = 'button'; locate.className = 'diagnose-locate';
        const subject = issue.asset ?? (issue.globalType ? issue.globalType + (issue.globalColumn ? '/' + issue.globalColumn : '') : issue.noiseArea !== undefined ? `${t('app.s3a2d2c2')}${issue.noiseArea}` : `#${issue.line ?? 0}`);
        locate.textContent = `${subject} · ${Number(issue.beat ?? 0).toFixed(2)} · ${issue.message}`; locate.onclick = () => this.locate(issue);
        row.append(locate);
        if (issue.removable || issue.code === undefined && issue.path?.startsWith('blockAreaList[')) {
          const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = t('app.s3755f56'); remove.onclick = () => this.remove(issue); row.append(remove);
        }
        types.get(typeKey).append(row);
      }
      if (issues.length > limit) { const more = document.createElement('button'); more.type = 'button'; more.className = 'wide-button'; more.textContent = t('diag.more', { count: issues.length - limit }); more.onclick = () => { this.limits[severity] = limit + 80; this.lastIssues = null; this.render(); }; group.append(more); }
      host.append(group);
    }
    if (!c.issues.length && !c.pending) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = t('app.sad38555'); host.append(empty); }
  }
  kind(issue) { return issue.asset ? 'resources' : issue.target ? 'compatibility' : issue.globalType ? 'global' : issue.noiseArea !== undefined ? 'noise' : issue.path.startsWith('notes[') ? 'notes' : issue.eventType || /Events\[|effects\./.test(issue.path) ? 'events' : 'other'; }
  kindLabel(kind) { return t({ resources: 'diag.resources', compatibility: 'diag.compatibility', global: 'app.s895a20e', noise: 'app.s81b3bb2', notes: 'app.s7ac3289', events: 'app.s550e328', other: 'app.s1a26edf' }[kind]); }
  details(key, className) { const node = document.createElement('details'); node.className = className; node.dataset.diagnosticGroup = key; node.open = this.folded.get(key) ?? true; return node; }
}
