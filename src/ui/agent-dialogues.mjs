import { AgentConversations, conversationMessages } from '../application/agent-conversations.mjs';
import { renderAgentMarkdown } from './agent-markdown.mjs';
import { AgentConversationRepository } from '../platform/agent-store.mjs';
import { showAgentExchange } from './agent-inspector.mjs';
import { AGENT_CORE_TOOLS, agentContextPolicy, agentContextUsage, agentContextSignature, estimateAgentTokens, prepareAgentHistory } from '../core/agent-context.mjs';
import { t } from '../i18n.mjs';
import { agentEffortLabel } from '../core/agent-routing.mjs';
import { AgentRoutingControls } from './agent-routing-controls.mjs';
import { agentUserMessage, agentTurnImages, AGENT_IMAGE_LIMITS } from '../core/agent-images.mjs';
import { prepareAgentImage, imageCards } from './agent-images.mjs';

const text = (tag, value, className = '') => { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; };
const button = (label, action) => { const node = text('button', label); node.type = 'button'; node.onclick = action; return node; };
const detail = label => { const node = document.createElement('details'); node.append(text('summary', label)); return node; };
const pretty = value => JSON.stringify(value, null, 2);
const time = milliseconds => (milliseconds / 1000).toFixed(2) + ' s';
export function submitAgentText(event, submit) {
  if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return false;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat) submit();
  return true;
}
export function agentUsageText(stats) {
  if (!stats) return '';
  return [stats.model, stats.reasoningEffort ? agentEffortLabel(stats.reasoningEffort) : '', stats.startedAt ? new Date(stats.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '', time(stats.durationMs ?? 0), stats.usageKnown ? t('agent-dialogues.s1f73712', { p0: stats.promptTokens, p1: stats.completionTokens, p2: stats.totalTokens }) : t('agent-dialogues.s0e03625'), stats.reasoningTokens ? t('agent-dialogues.s7321f8c', { p0: stats.reasoningTokens }) : '', stats.cachedTokens ? t('agent-dialogues.s5f7da44', { p0: stats.cachedTokens }) : '', stats.requests ? t('agent-dialogues.s3b8c12f', { p0: stats.requests }) : '', stats.tools ? t('agent-dialogues.sbc85fe9', { p0: stats.tools }) : ''].filter(Boolean).join(' · ');
}

export class AgentDialogues {
  constructor(panel) {
    this.panel = panel; this.store = new AgentConversations(); this.views = new Map(); this.scrollStates = new Map(); this.running = null; this.round = null;
    this.dirtyTurns = new Set(); this.dirtyMemories = new Set(); this.traceOwners = new Map(); this.activeExchanges = new Map(); this.runs = new Map(); this.turnViews = new WeakMap(); this.ready = Promise.resolve(); this.generation = 0; this.autoQueue = false;
    this.render(); this.show(this.store.current.id);
  }
  async attach(workspace) {
    if (workspace === this.workspace) return this.ready;
    this.detach(); this.workspace = workspace; this.loading = true; this.updateBusy(); const generation = ++this.generation, repository = this.repository = new AgentConversationRepository(workspace);
    this.ready = repository.load().then(store => {
      if (generation !== this.generation) return;
      this.store = store; this.views.clear(); this.scrollStates.clear(); this.visibleId = null; this.show(store.selected);
    }).catch(error => { if (generation === this.generation) this.repository = null; this.panel.notify(t('agent-dialogues.sf54f712') + error.message, 'error'); }).finally(() => { if (generation === this.generation) { this.loading = false; this.updateBusy(); this.updateStatus(); } });
    return this.ready;
  }
  save(turn, memory) {
    if (!this.repository) return;
    if (turn) this.dirtyTurns.add(turn); if (memory) this.dirtyMemories.add(memory);
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flush().catch(error => this.panel.notify(t('agent-dialogues.sc51d4c3') + error.message, 'error')), 300);
  }
  async flush() {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    const repository = this.repository; if (!repository) return;
    const turns = [...this.dirtyTurns], memories = [...this.dirtyMemories]; this.dirtyTurns.clear(); this.dirtyMemories.clear();
    try { await repository.save(this.store, { turns, memories }); await repository.flush(); }
    catch (error) { if (this.repository === repository) { for (const turn of turns) this.dirtyTurns.add(turn); for (const memory of memories) this.dirtyMemories.add(memory); } throw error; }
  }
  detach() {
    this.routing?.close();
    this.autoQueue = false;
    if (this.running) { this.running.turn.status = 'stopped'; this.running.turn.error ??= t('agent-dialogues.s1ba77d7'); this.running.turn.messages = structuredClone(this.panel.agent?.turnMessages ?? this.running.turn.messages); this.dirtyTurns.add(this.running.turn); }
    this.flush().catch(error => this.panel.notify(t('agent-dialogues.sc51d4c3') + error.message, 'error'));
    this.generation++; this.workspace = null; this.repository = null;
  }
  render() {
    const panel = this.panel, heading = text('div', '', 'agent-heading');
    panel.configure = button(t('agent-dialogues.sd7d7ce7'), () => panel.configuration()); heading.append(panel.configure);
    if (globalThis.rpenAgentWorkspace) heading.append(button(t('agent-dialogues.sa1ff8da'), () => panel.workspace.call('open').catch(error => panel.notify(error.message, 'error'))));
    const row = text('div', '', 'agent-conversations'); this.select = document.createElement('select'); this.select.setAttribute('aria-label', t('agent-dialogues.s37f4358')); this.select.onchange = () => this.show(this.select.value);
    panel.clear = button(t('agent-dialogues.s90f8d10'), () => this.show(this.store.create().id));
    const manage = button(t('agent-dialogues.s4989b5c'), () => this.manage()); manage.title = t('agent-dialogues.s098d189'); row.append(this.select, panel.clear, manage);
    const topbar = text('div', '', 'agent-topbar'); topbar.append(row, heading);
    const context = text('div', '', 'agent-context'); const label = text('label', '');
    this.contextMode = document.createElement('select'); this.contextMode.setAttribute('aria-label', t('agent-dialogues.s36d8981'));
    for (const [value, name] of [['all', t('agent-dialogues.s4531251')], ['last', t('agent-dialogues.se1fc536')], ['none', t('agent-dialogues.sc1e1885')]]) { const option = text('option', name); option.value = value; this.contextMode.append(option); }
    this.contextCount = document.createElement('input'); this.contextCount.type = 'number'; this.contextCount.min = '1'; this.contextCount.max = '10000'; this.contextCount.step = '1'; this.contextCount.setAttribute('aria-label', t('agent-dialogues.s4eb106a'));
    const changeContext = () => { const count = Number(this.contextCount.value); if (!Number.isSafeInteger(count) || count < 1 || count > 10000) return; this.store.setContext(this.store.selected, this.contextMode.value, count); this.contextCount.hidden = this.contextMode.value !== 'last'; this.updateStatus(); this.updateContextUsage(); };
    this.contextMode.onchange = this.contextCount.onchange = () => { changeContext(); this.save(); }; label.append(this.contextMode); context.append(label, this.contextCount);
    this.compactButton = button(t('agent-dialogues.s4b8163f'), () => this.compact()); this.compactButton.title = t('agent-dialogues.sfd07a66'); context.append(this.compactButton);
    this.usage = text('div', '', 'agent-context-usage'); this.usage.setAttribute('role', 'meter'); this.usage.setAttribute('aria-label', t('agent-dialogues.sd12810d')); this.usage.setAttribute('aria-valuemin', '0');
    this.usageRing = text('span', '', 'agent-context-ring'); this.usageRing.setAttribute('aria-hidden', 'true'); this.usageNumber = text('span', '', 'agent-context-number'); this.usage.append(this.usageRing, this.usageNumber); context.append(this.usage);
    const permissions = text('label', '', 'agent-permission'); panel.permission = document.createElement('select'); panel.permission.setAttribute('aria-label', t('agent-dialogues.s1cb332e'));
    for (const [value, name] of [['ask', t('agent-dialogues.s4e79789')], ['dangerous', t('agent-dialogues.s4b1f840')], ['full', t('agent-dialogues.s2829acf')]]) { const option = text('option', name); option.value = value; panel.permission.append(option); }
    panel.permission.value = panel.settings.permission; panel.permission.onchange = () => { panel.settings.permission = panel.permission.value; panel.persist(); }; permissions.append(panel.permission);
    const controls = text('div', '', 'agent-controls'); controls.append(context, permissions);
    this.routing = new AgentRoutingControls(panel);
    panel.status = text('p', '', 'agent-status'); panel.status.setAttribute('role', 'status');
    this.background = button('', () => { if (this.running) this.show(this.running.record.id); }); this.background.className = 'agent-background-task'; this.background.hidden = true;
    this.viewport = text('div', '', 'agent-messages'); this.viewport.setAttribute('role', 'log'); this.viewport.setAttribute('aria-label', t('agent-dialogues.s4636912'));
    this.viewport.addEventListener('scroll', () => this.trackScroll(), { passive: true });
    this.viewport.addEventListener('wheel', event => {
      if (!event.deltaY || event.ctrlKey || event.target.closest('textarea,input,select,[contenteditable=true]')) return;
      const state = this.scrollState(); state.direction = Math.sign(event.deltaY);
      if (event.deltaY < 0 && this.viewport.scrollHeight > this.viewport.clientHeight + 2) { state.follow = false; state.top = this.viewport.scrollTop; state.bottom = this.viewport.scrollHeight - this.viewport.clientHeight; }
      else if (event.deltaY > 0 && this.viewport.scrollHeight - this.viewport.clientHeight - this.viewport.scrollTop <= 96) state.follow = true;
    }, { passive: true });
    this.viewport.addEventListener('pointerdown', () => { this.scrollState().direction = 0; }, { passive: true });
    this.viewport.addEventListener('keydown', event => {
      if (event.target.closest('textarea,input,select,[contenteditable=true]')) return;
      const state = this.scrollState();
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { state.direction = -1; state.follow = false; }
      else if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) { state.direction = 1; if (event.key === 'End') state.follow = true; }
    });
    this.composer = document.createElement('form'); this.composer.className = 'agent-composer'; panel.input = document.createElement('textarea'); panel.input.rows = 2; panel.input.placeholder = t('agent-dialogues.s9198919'); panel.input.setAttribute('aria-label', t('agent-dialogues.s563f395'));
    this.attachments = text('div', '', 'agent-image-list agent-composer-images'); this.attachments.hidden = true;
    panel.input.addEventListener('paste', event => this.pasteImages(event));
    panel.input.oninput = () => { this.store.current.draft = panel.input.value; this.save(); this.updateBusy(); };
    panel.input.onkeydown = event => { submitAgentText(event, () => {
      if ((event.ctrlKey || event.metaKey) && panel.agent?.busy) this.interrupt(panel.input.value);
      else this.composer.requestSubmit();
    }); };
    const actions = text('div', '', 'agent-composer-actions'); panel.send = button(t('agent-dialogues.s1214d63'), () => {}); panel.send.type = 'submit'; panel.stop = button(t('agent-dialogues.sa17f70a'), () => { this.pauseQueue(); panel.agent.stop(); }); panel.stop.hidden = true;
    this.interruptButton = button(t('agent-dialogues.s90de0b5'), () => this.interrupt(panel.input.value)); this.interruptButton.hidden = true; actions.append(panel.status, this.routing.toggle, panel.send, this.interruptButton, panel.stop, this.routing.menu);
    this.interruptButton.title = t('agent-dialogues.interruptShortcut');
    this.resumeQueue = button(t('agent-dialogues.s39faf0c'), () => { for (const { turn } of this.queued()) { turn.paused = false; this.save(turn); } this.autoQueue = true; this.drain(); }); this.resumeQueue.className = 'agent-queue-resume'; this.resumeQueue.hidden = true;
    this.composer.append(this.attachments, panel.input, actions); this.composer.onsubmit = event => { event.preventDefault(); this.send(panel.input.value); };
    panel.host.append(topbar, controls, this.background, this.viewport, this.resumeQueue, this.composer); this.updateRouting();
  }
  bind(agent) {
    agent.addEventListener('user', event => { if (this.running) { this.running.runId = event.detail.runId; this.running.turn.startedAt = event.detail.startedAt; this.runs.set(event.detail.runId, this.running); } });
    agent.addEventListener('context-usage', event => {
      if (!this.running) return;
      this.running.record.contextUsage = { ...event.detail, signature: agentContextSignature(this.panel.settings, this.running.record.context) };
      this.updateContextUsage(); this.save();
    });
    agent.addEventListener('exchange-start', event => {
      const current = this.running; if (!current) return;
      const trace = event.detail; current.turn.exchanges ??= []; current.turn.exchanges.push({ id: trace.id, model: trace.model, purpose: trace.purpose, status: trace.status, startedAt: trace.startedAt });
      this.activeExchanges.set(trace.id, trace); this.traceOwners.set(trace.id, current); current.view.inspect.disabled = false; this.save(current.turn);
    });
    agent.addEventListener('exchange-end', event => {
      const trace = event.detail, current = this.traceOwners.get(trace.id); if (!current) return;
      const metadata = current.turn.exchanges.find(entry => entry.id === trace.id); Object.assign(metadata, { status: trace.status, durationMs: trace.durationMs });
      this.activeExchanges.set(trace.id, trace);
      current.repository?.saveTrace(trace).then(() => this.activeExchanges.delete(trace.id)).catch(error => this.panel.notify(t('agent-dialogues.s306b5b4') + error.message, 'error'));
      this.traceOwners.delete(trace.id);
      if (this.running === current) this.save(current.turn);
    });
    agent.addEventListener('assistant-start', event => {
      const turn = this.running?.view; if (!turn) return;
      this.round = this.modelRound(turn.workContent); this.round.model = event.detail.model; this.updateStatus(t('agent-dialogues.s4cc57de'));
    });
    agent.addEventListener('text', event => { if (this.round) { this.round.source += event.detail.delta; this.scheduleRound(); } });
    agent.addEventListener('reasoning', event => { if (this.round) { this.round.thinking += event.detail.delta; this.round.reasoning.hidden = false; this.scheduleRound(); } });
    agent.addEventListener('assistant-cancelled', event => {
      if (!this.running || !this.round) return;
      this.renderRound(this.round, true); this.round.element.append(text('small', event.detail.reason === 'interrupted' ? t('agent-dialogues.se439deb') : t('agent-dialogues.s40ce903'), 'agent-round-meta'));
      this.running.turn.process.push({ kind: 'model', text: this.round.source, reasoning: this.round.thinking, interrupted: true }); this.round = null;
    });
    agent.addEventListener('compaction-start', () => { this.updateStatus(t('agent-dialogues.sbbedee4')); });
    agent.addEventListener('compaction-end', event => {
      if (!this.running) return;
      this.running.turn.process.push({ kind: 'compaction', ...event.detail }); this.running.view.workContent.append(this.jsonDetail(t('agent-dialogues.s062189d'), event.detail)); this.updateStatus(t('agent-dialogues.sa9d3838')); this.save(this.running.turn);
    });
    agent.addEventListener('compaction-only', event => { if (this.running) { this.running.view.answer.hidden = false; renderAgentMarkdown(this.running.view.answerContent, event.detail.text); } });
    agent.addEventListener('steering', event => {
      if (!this.running) return;
      const pending = this.running.turn.process.find(entry => entry.kind === 'steering' && entry.pending && entry.text === event.detail.text);
      if (pending) { pending.pending = false; this.running.view.workContent.querySelector(`[data-steering-id="${CSS.escape(pending.id)}"]`)?.querySelector('.agent-message-role').replaceChildren(document.createTextNode(t('agent-dialogues.see71941'))); }
      else { this.running.turn.process.push({ kind: 'steering', text: event.detail.text }); this.running.view.workContent.append(this.message(t('agent-dialogues.see71941'), event.detail.text, 'agent-user-message')); }
      this.save(this.running.turn); this.scroll();
    });
    agent.addEventListener('assistant-end', event => {
      const view = this.running?.view, round = this.round; if (!view || !round) return;
      round.source = event.detail.text; round.thinking = event.detail.reasoning || round.thinking; this.renderRound(round, true);
      const usage = event.detail.usage, stats = { model: event.detail.model, durationMs: event.detail.durationMs, usageKnown: Boolean(usage), promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0, totalTokens: usage?.total_tokens ?? 0, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0 };
      this.roundMetrics(round, stats);
      if (event.detail.final) { view.answer.hidden = false; renderAgentMarkdown(view.answerContent, event.detail.text); if (event.detail.text) round.content.remove(); }
      if (!round.thinking && (event.detail.final || !round.source)) round.element.remove();
      this.running.turn.process.push({ kind: 'model', text: event.detail.final ? '' : event.detail.text, reasoning: round.thinking, statistics: stats }); this.round = null;
      this.save(this.running.turn);
      this.scroll();
    });
    agent.addEventListener('tool-start', event => {
      const view = this.running?.view; if (!view) return;
      const entry = this.jsonDetail(t('agent-dialogues.s580ff6c') + event.detail.name, event.detail.arguments); entry.dataset.callId = event.detail.id; view.workContent.append(entry); this.updateStatus(t('agent-dialogues.s6163bed') + event.detail.name); this.scroll();
      this.running.turn.process.push({ kind: 'tool', id: event.detail.id, name: event.detail.name, arguments: structuredClone(event.detail.arguments) });
    });
    agent.addEventListener('tool-end', event => {
      const entry = this.running?.view.workContent.querySelector(`[data-call-id="${CSS.escape(event.detail.id)}"]`);
      if (entry) { entry.classList.toggle('agent-tool-error', !event.detail.result.ok); entry.querySelector('summary').textContent = t('agent-dialogues.s63f5ac4', { p0: event.detail.result.denied ? t('agent-dialogues.s4c7c52c') : event.detail.result.ok ? t('agent-dialogues.s33246f6') : t('agent-dialogues.s3e3c806'), p1: event.detail.name }); entry.append(text('pre', pretty(event.detail.result))); }
      const process = this.running?.turn.process.find(entry => entry.id === event.detail.id); if (process) process.result = structuredClone(event.detail.result); this.scroll();
      if (this.running) this.save(this.running.turn);
    });
    agent.addEventListener('error', event => {
      const view = this.running?.view; if (!view) return;
      view.answer.hidden = false; view.answerContent.append(text('p', event.detail.message, 'agent-error')); this.running.turn.error = event.detail.message;
      this.scroll();
    });
    agent.addEventListener('turn-end', event => {
      const current = this.runs.get(event.detail.runId); if (!current) return;
      this.runs.delete(event.detail.runId);
      const { contextMessages, compacted, runId, ...result } = event.detail;
      Object.assign(current.turn, result); current.turn.answer = current.view.answerContent.dataset.markdownSource ?? '';
      if (compacted && current.contextMode === 'all') current.record.memory = { through: current.turn.id, messages: contextMessages };
      current.view.work.open = false; current.view.meta.textContent = agentUsageText(event.detail.statistics); current.view.actions.hidden = false;
      current.view.meta.title = t('agent-dialogues.s47c3221', { p0: time(event.detail.statistics.requestMs) });
      current.view.work.querySelector('summary').textContent = t('agent-dialogues.s94935d8', { p0: event.detail.statistics.requests, p1: event.detail.statistics.tools });
      if (this.running !== current) { current.repository?.saveTurns([current.turn]).catch(error => this.panel.notify(error.message, 'error')); return; }
      this.save(current.turn, compacted && current.contextMode === 'all' ? current.record : undefined);
      if (event.detail.status === 'completed') this.panel.notify(t('agent-dialogues.s2a65be6') + current.record.title, 'info');
      else if (event.detail.status === 'failed') { this.pauseQueue(); this.panel.notify(t('agent-dialogues.s2ce8fd8') + (current.turn.error ?? current.record.title), 'error'); }
      this.scroll(); this.running = null; this.round = null; this.updateChoices(); this.updateStatus(); this.updateContextUsage();
      clearInterval(this.elapsedTimer); this.elapsedTimer = null;
    });
    agent.addEventListener('state', () => { this.updateBusy(); this.updateStatus(); if (!agent.busy) queueMicrotask(() => this.drain()); });
  }
  scheduleRound() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; if (this.round) this.renderRound(this.round); }, 80);
  }
  modelRound(parent) {
    const element = text('div', '', 'agent-model-round'), reasoning = detail(''); reasoning.className = 'agent-reasoning'; reasoning.hidden = true;
    const summary = reasoning.querySelector('summary'); summary.append(text('span', t('agent-dialogues.sa6c1499'), 'agent-reasoning-label')); const preview = text('span', '', 'agent-reasoning-preview'); summary.append(preview); summary.title = t('agent-dialogues.sb6fe7d7');
    const reasoningText = text('div', '', 'agent-content'), content = text('div', '', 'agent-content'); reasoning.append(reasoningText); element.append(reasoning, content); parent.append(element);
    const round = { element, content, reasoning, reasoningText, preview, source: '', thinking: '' };
    reasoning.addEventListener('toggle', () => { if (reasoning.open) renderAgentMarkdown(reasoningText, round.thinking); }); return round;
  }
  roundMetrics(round, statistics) {
    const value = agentUsageText(statistics); round.element.title = value;
    if (round.thinking) round.reasoning.append(text('small', value, 'agent-round-meta'));
  }
  renderRound(round, complete = false) {
    if (!complete && round.source.length > 40000) round.content.textContent = round.source; else renderAgentMarkdown(round.content, round.source);
    if (round.thinking) {
      round.reasoning.hidden = false; round.preview.textContent = round.thinking.replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
      if (round.reasoning.open) { if (!complete && round.thinking.length > 40000) round.reasoningText.textContent = round.thinking; else renderAgentMarkdown(round.reasoningText, round.thinking); }
    } this.scroll();
  }
  jsonDetail(label, value) { const node = detail(label); node.className = 'agent-tool'; node.append(text('pre', pretty(value))); return node; }
  recordView(record) {
    if (this.views.has(record.id)) return this.views.get(record.id);
    const node = text('div', '', 'agent-conversation-view'); this.views.set(record.id, node);
    if (!record.turns.length) node.append(text('p', t('agent-dialogues.s5beefea'), 'agent-intro'));
    for (const turn of record.turns) this.turnView(record, turn, node);
    return node;
  }
  turnView(record, turn, parent = this.recordView(record)) {
    const root = text('article', '', 'agent-turn'); root.dataset.turnId = turn.id;
    root.hidden = turn.status === 'steered' && Boolean(turn.linkedTurn);
    const inspect = button('↗', () => {
      const target = turn.linkedTurn ? record.turns.find(entry => entry.id === turn.linkedTurn) ?? turn : turn;
      showAgentExchange(target, id => this.activeExchanges.get(id) ?? this.repository?.trace(id));
    }); inspect.className = 'agent-turn-inspect'; inspect.title = t('agent-dialogues.s5b586d9'); inspect.setAttribute('aria-label', inspect.title); inspect.disabled = !turn.exchanges?.length && !turn.linkedTurn; root.append(inspect);
    const user = this.message(t('agent-dialogues.s5630b88'), turn.text, 'agent-user-message'); root.append(user);
    const images = agentTurnImages(turn); if (images.length) { const gallery = text('div', '', 'agent-image-list'); imageCards(gallery, images); user.querySelector('.agent-message-body').prepend(gallery); }
    const work = detail(t('agent-dialogues.s78e1831')); work.className = 'agent-turn-work'; work.open = turn.status === 'running'; const workContent = text('div', '', 'agent-work-content'); work.append(workContent);
    const answer = this.message('AI', '', 'agent-turn-answer'); answer.hidden = !turn.answer && !turn.error; const answerContent = answer.querySelector('.agent-message-body');
    if (turn.answer) renderAgentMarkdown(answerContent, turn.answer);
    if (turn.error) answerContent.append(text('p', turn.error, 'agent-error'));
    const meta = text('small', agentUsageText(turn.statistics), 'agent-turn-meta'); const actions = text('div', '', 'agent-turn-actions'); actions.hidden = turn.status === 'running';
    if (turn.status === 'queued') {
      meta.textContent = turn.paused ? t('agent-dialogues.s444f7fd') : t('agent-dialogues.sd0de773'); work.hidden = true;
      actions.append(button(t('agent-dialogues.s90de0b5'), () => this.interrupt(turn.text, turn, record)), button(t('agent-dialogues.se905f50'), () => { turn.status = 'cancelled'; this.save(turn); this.refreshTurn(record, turn); this.updateBusy(); }));
    } else {
      if (turn.status === 'steered') { meta.textContent = t('agent-dialogues.s97c2103'); work.hidden = true; }
      if (turn.status === 'cancelled') { meta.textContent = t('agent-dialogues.se8710fe'); work.hidden = true; }
      actions.append(button(t('agent-dialogues.sc43e777'), () => this.edit(record, turn, user)), button(t('agent-dialogues.se2d53a6'), () => this.resend(record, turn, turn.text, { compactOnly: turn.compactOnly })));
      for (const action of actions.children) action.title = t('agent-dialogues.s8353df8');
    }
    for (const entry of turn.process ?? []) {
      if (entry.kind === 'tool') workContent.append(this.jsonDetail(entry.name, { arguments: entry.arguments, result: entry.result }));
      else if (entry.kind === 'question') { const question = detail(t('agent-dialogues.s610ec6d')); question.append(text('p', entry.question), text('p', entry.answer)); workContent.append(question); }
      else if (entry.kind === 'steering') { const message = this.message(entry.pending ? t('agent-dialogues.s52cb13d') : t('agent-dialogues.see71941'), entry.text, 'agent-user-message'); if (entry.id) message.dataset.steeringId = entry.id; if (entry.images?.length) { const gallery = text('div', '', 'agent-image-list'); imageCards(gallery, entry.images); message.querySelector('.agent-message-body').prepend(gallery); } workContent.append(message); }
      else if (entry.kind === 'compaction') workContent.append(this.jsonDetail(t('agent-dialogues.sc8798fb'), entry));
      else {
        if (!entry.text && !entry.reasoning) continue;
        const round = this.modelRound(workContent); round.source = entry.text ?? ''; round.thinking = entry.reasoning ?? ''; this.renderRound(round, true); this.roundMetrics(round, entry.statistics);
      }
    }
    root.append(work, answer, meta, actions); parent.querySelector('.agent-intro')?.remove(); parent.append(root);
    const view = { root, user, work, workContent, answer, answerContent, meta, actions, inspect }; this.turnViews.set(turn, view); return view;
  }
  refreshTurn(record, turn) {
    const parent = this.recordView(record), previous = this.turnViews.get(turn), next = previous?.root.nextSibling;
    previous?.root.remove(); const view = this.turnView(record, turn, parent); if (next?.parentNode === parent) parent.insertBefore(view.root, next); return view;
  }
  message(role, source, className) {
    const node = text('section', '', className), body = text('div', source, 'agent-content agent-message-body'), toggle = button('', () => this.expandMessage(node, body.hidden));
    toggle.className = 'agent-message-toggle'; toggle.setAttribute('aria-expanded', 'true'); toggle.append(text('span', role, 'agent-message-role'), text('span', '', 'agent-message-preview')); node.append(toggle, body); return node;
  }
  expandMessage(node, open) {
    const body = node.querySelector('.agent-message-body'), toggle = node.querySelector('.agent-message-toggle'); body.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('.agent-message-preview').textContent = open ? '' : body.textContent.replace(/\s+/g, ' ').trim();
  }
  show(id) {
    const previous = this.store.records.get(this.visibleId); if (previous) previous.draft = this.panel.input.value;
    const previousScroll = this.scrollStates.get(this.visibleId); if (previousScroll) previousScroll.top = this.viewport.scrollTop;
    const record = this.store.select(id); this.viewport.replaceChildren(this.recordView(record)); this.panel.input.value = record.draft;
    this.renderImages();
    this.visibleId = id;
    this.contextMode.value = record.context.mode; this.contextCount.value = record.context.turns; this.contextCount.hidden = record.context.mode !== 'last'; this.updateChoices(); this.updateStatus(); this.updateContextUsage();
    const state = this.scrollState(); this.viewport.scrollTop = state.follow ? this.viewport.scrollHeight : state.top; state.top = this.viewport.scrollTop; state.bottom = Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight); state.direction = 0;
    if (!this.loading) this.save(); this.updateBusy();
  }
  updateChoices() {
    this.select.replaceChildren(...[...this.store.records.values()].map(record => { const node = text('option', (this.running?.record === record ? '● ' : '') + record.title); node.value = record.id; return node; })); this.select.value = this.store.selected;
  }
  updateBusy() {
    const busy = Boolean(this.panel.agent?.busy), loading = Boolean(this.loading);
    this.panel.send.hidden = false; this.panel.send.textContent = busy ? t('agent-dialogues.s91255f6') : t('agent-dialogues.s1214d63'); this.panel.send.disabled = loading || Boolean(this.store.current.preparingImages);
    this.panel.stop.hidden = !busy; this.interruptButton.hidden = !busy; this.interruptButton.disabled = (!this.panel.input.value.trim() && !this.store.current.draftImages?.length) || Boolean(this.store.current.preparingImages) || this.running?.record !== this.store.current;
    this.panel.configure.disabled = this.panel.permission.disabled = busy || loading || this.panel.keyLoading; this.panel.input.disabled = loading;
    this.routing.updateBusy(Boolean(busy || loading || this.panel.keyLoading));
    this.contextMode.disabled = this.contextCount.disabled = this.select.disabled = this.panel.clear.disabled = loading;
    this.compactButton.disabled = busy || loading || !this.store.current.turns.some(turn => turn.messages?.length);
    for (const record of this.store.records.values()) for (const turn of record.turns) {
      const view = this.turnViews.get(turn); if (!view) continue;
      for (const node of view.actions.children) node.disabled = loading || (turn.status === 'queued' ? node.textContent === t('agent-dialogues.s90de0b5') && (!busy || this.running?.record !== record) : busy);
    }
    const queued = this.queued(); this.resumeQueue.hidden = !queued.length || this.autoQueue && !queued.some(entry => entry.turn.paused);
  }
  updateStatus(value) {
    if (!this.panel.agent) return;
    if (value) this.phase = value;
    const busy = this.panel.agent.busy;
    this.panel.status.textContent = this.loading ? t('agent-dialogues.s3de7f2d') : busy ? (this.running?.record.title ?? t('agent-dialogues.s3172b31')) + ' · ' + (this.phase ?? t('agent-dialogues.sfcb979e')) : this.panel.key ? t('agent-route.ready') : t('agent-dialogues.s0e46ed7');
    this.background.hidden = !busy || !this.running || this.running.record === this.store.current;
    if (!this.background.hidden) this.background.textContent = t('agent-dialogues.s3c8dd03', { p0: this.running.record.title, p1: this.phase ?? t('agent-dialogues.s6d97436') });
  }
  updateRouting() {
    this.routing?.update();
    if (this.panel.input) this.panel.input.title = t('agent-images.pasteHint');
  }
  updateContextUsage() {
    if (!this.usage || !this.panel.agent) return;
    const config = this.panel.settings, record = this.store.current, stored = record.contextUsage;
    const compatible = stored?.signature === agentContextSignature(config, record.context), capabilities = this.panel.capabilities();
    const policy = agentContextPolicy(config, { ...capabilities, contextWindow: capabilities.source === 'provider' ? capabilities.contextWindow : compatible ? stored.contextWindow : capabilities.contextWindow });
    const running = this.running?.record === record && this.panel.agent.busy;
    let usage = running && this.panel.agent.contextUsage ? this.panel.agent.contextUsage : compatible ? agentContextUsage(stored.tokens, policy, stored.estimated) : null;
    if (!usage) {
      const messages = prepareAgentHistory(conversationMessages(record)), selected = new Set(AGENT_CORE_TOOLS);
      for (const message of messages) for (const call of message.tool_calls ?? []) selected.add(call.function.name);
      const system = config.prompt + t('agent-dialogues.s1f13b73') + JSON.stringify(this.panel.adapter.summary()) + t('agent-dialogues.s112fe43') + config.permission + t('agent-dialogues.s2078fe0') + JSON.stringify(capabilities);
      usage = agentContextUsage(estimateAgentTokens({ system, tools: this.panel.commands.tools().filter(tool => selected.has(tool.function.name)), messages }), policy);
    }
    const ratio = Math.max(0, usage.ratio), percentage = (ratio * 100).toFixed(1) + '%';
    const number = usage.tokens >= 1000000 ? (usage.tokens / 1000000).toFixed(2) + 'M' : usage.tokens >= 1000 ? (usage.tokens / 1000).toFixed(1) + 'K' : String(usage.tokens);
    this.usageRing.style.setProperty('--agent-context-progress', Math.min(100, ratio * 100) + '%');
    this.usageNumber.textContent = number + ' ' + percentage; this.usage.classList.toggle('agent-context-warning', usage.tokens >= usage.threshold);
    this.usage.title = t('agent-dialogues.s876fd01', { p0: usage.estimated ? t('agent-dialogues.sb73b8f5') : t('agent-dialogues.sf8a1d52'), p1: usage.tokens.toLocaleString(), p2: usage.contextWindow.toLocaleString(), p3: policy.automatic ? t('agent-dialogues.s2f62b56') + policy.threshold.toLocaleString() : t('agent-dialogues.sa0822b0') });
    this.usage.setAttribute('aria-valuemax', String(usage.contextWindow)); this.usage.setAttribute('aria-valuenow', String(usage.tokens)); this.usage.setAttribute('aria-valuetext', this.usage.title);
  }
  renderImages() { if (this.attachments) imageCards(this.attachments, this.store.current.draftImages, index => { this.store.current.draftImages.splice(index, 1); this.renderImages(); this.save(); this.updateBusy(); }); }
  async pasteImages(event) {
    const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation();
    const record = this.store.current, generation = this.generation;
    if ((record.draftImages?.length ?? 0) + (record.preparingImages ?? 0) + files.length > AGENT_IMAGE_LIMITS.count) { this.panel.notify(t('agent-images.limit'), 'warning'); return; }
    record.preparingImages = (record.preparingImages ?? 0) + files.length; this.updateBusy();
    try {
      if (!this.panel.capabilities().images) await this.panel.refreshCapabilities();
      if (this.generation !== generation || this.store.records.get(record.id) !== record) return;
      if (!this.panel.capabilities().images) { this.panel.notify(t('agent-images.unsupported'), 'warning'); return; }
      const images = await Promise.all(files.map(prepareAgentImage));
      if (this.generation !== generation || this.store.records.get(record.id) !== record) return;
      record.draftImages ??= []; record.draftImages.push(...images); this.save(); if (this.store.current === record) this.renderImages();
    } catch (error) { this.panel.notify(error.message, 'error'); }
    finally { record.preparingImages = Math.max(0, (record.preparingImages ?? 0) - files.length); this.updateBusy(); }
  }
  async send(source, instruction = '', { compactOnly = false, images: suppliedImages } = {}) {
    const generation = this.generation, selected = this.store.selected; await Promise.all([this.panel.credentialsReady, this.ready]); if (generation !== this.generation) return;
    const panel = this.panel, record = this.store.records.get(selected) ?? this.store.current, images = compactOnly ? [] : suppliedImages ?? record.draftImages ?? [], value = compactOnly ? t('agent-dialogues.s14a8486') : source.trim() || (images.length ? t('agent-images.prompt') : ''); if (!value || record.preparingImages) return;
    if (!panel.key) { panel.configuration(); return; }
    if (images.length && !panel.capabilities().images) { panel.notify(t('agent-images.unsupported'), 'warning'); return; }
    const turn = { id: crypto.randomUUID(), text: value, instruction, compactOnly, imageNames: images.map(({ url, ...meta }) => meta), status: 'queued', process: [], messages: compactOnly ? [] : [agentUserMessage(value, images)], answer: '', createdAt: Date.now(), queueOrder: Date.now() + (this.sequence = (this.sequence ?? 0) + 1) / 1000 };
    if (!record.turns.length && record.title === t('agent-dialogues.s1b7abf9')) record.title = value.replace(/\s+/g, ' ').slice(0, 24);
    const parent = this.recordView(record); record.turns.push(turn); this.turnView(record, turn, parent); if (this.store.current === record && !compactOnly) panel.input.value = ''; record.draft = ''; if (!compactOnly && suppliedImages === undefined) { record.draftImages = []; if (this.store.current === record) this.renderImages(); } this.save(turn); this.autoQueue = true; this.updateChoices(); this.updateBusy(); this.scroll(true); this.drain();
  }
  queued() { return [...this.store.records.values()].flatMap(record => record.turns.filter(turn => turn.status === 'queued').map(turn => ({ record, turn }))).sort((first, second) => (first.turn.queueOrder ?? first.turn.createdAt) - (second.turn.queueOrder ?? second.turn.createdAt)); }
  pauseQueue() { this.autoQueue = false; for (const { turn, record } of this.queued()) { turn.paused = true; this.save(turn); this.refreshTurn(record, turn); } this.updateBusy(); }
  async drain() {
    if (this.draining || !this.autoQueue || this.panel.agent.busy || this.loading) return;
    const next = this.queued().find(entry => !entry.turn.paused); if (!next) { this.updateBusy(); return; }
    this.draining = true; try { await this.start(next.record, next.turn); } finally { this.draining = false; if (this.autoQueue) queueMicrotask(() => this.drain()); }
  }
  compact() { if (!this.panel.agent.busy) return this.send('', '', { compactOnly: true }); }
  interrupt(source, queued, record = this.store.current) {
    const images = queued ? agentTurnImages(queued) : record.draftImages ?? [], value = source.trim() || (images.length ? t('agent-images.prompt') : ''); if (!value || record.preparingImages || this.running?.record !== record) return;
    if (images.length && !this.panel.capabilities().images) { this.panel.notify(t('agent-images.unsupported'), 'warning'); return; }
    if (!this.panel.agent.steer(value, images)) return;
    let supplement = queued;
    if (queued) { queued.status = 'steered'; queued.linkedTurn = this.running.turn.id; this.save(queued); this.refreshTurn(record, queued); }
    else {
      const turn = { id: crypto.randomUUID(), text: value, status: 'steered', linkedTurn: this.running.turn.id, process: [], messages: [], answer: '', createdAt: Date.now() };
      turn.messages = [agentUserMessage(value, images)]; turn.imageNames = images.map(({ url, ...meta }) => meta);
      const parent = this.recordView(record); record.turns.push(turn); this.turnView(record, turn, parent); this.panel.input.value = ''; record.draft = ''; record.draftImages = []; this.renderImages(); this.save(turn); supplement = turn;
    }
    const entry = { kind: 'steering', id: supplement.id, text: value, images, pending: true }; this.running.turn.process.push(entry);
    const message = this.message(t('agent-dialogues.s52cb13d'), value, 'agent-user-message'); message.dataset.steeringId = entry.id; this.running.view.workContent.append(message); this.running.view.work.open = true; this.save(this.running.turn);
    if (images.length) { const gallery = text('div', '', 'agent-image-list'); imageCards(gallery, images); message.querySelector('.agent-message-body').prepend(gallery); }
    this.updateBusy(); this.updateStatus(t('agent-dialogues.s42b6876'));
  }
  async start(record, turn) {
    const panel = this.panel, history = conversationMessages(record); turn.status = turn.compactOnly ? 'compacting' : 'running'; turn.startedAt = Date.now();
    const view = this.refreshTurn(record, turn); view.actions.hidden = true; view.work.hidden = false; view.work.open = true;
    this.running = { record, turn, view, store: this.store, repository: this.repository, contextMode: record.context.mode }; this.save(turn); this.updateChoices(); this.updateBusy();
    this.elapsedTimer = setInterval(() => { if (this.running?.turn === turn) view.meta.textContent = t('agent-dialogues.s8bc996b', { p0: panel.settings.model, p1: time(panel.agent.elapsedMs()) }); }, 250);
    try { await panel.agent.run(turn.compactOnly ? '' : turn.text, { history, instruction: turn.instruction, compactOnly: turn.compactOnly, images: agentTurnImages(turn) }); }
    catch (error) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; turn.status = 'failed'; turn.error = error.message; view.answer.hidden = false; view.answerContent.textContent = error.message; view.actions.hidden = false; view.work.open = false; this.running = null; this.pauseQueue(); this.save(turn); this.updateBusy(); this.updateStatus(); }
  }
  edit(record, turn, user) {
    if (this.panel.agent.busy || user.querySelector('textarea')) return;
    const edit = document.createElement('textarea'); edit.className = 'agent-history-editor'; edit.value = turn.text; edit.setAttribute('aria-label', t('agent-dialogues.s0ef9d53')); const actions = text('div', '', 'agent-actions');
    const hint = text('small', t('agent-dialogues.s10fffe4'), 'hint');
    const images = agentTurnImages(turn), gallery = text('div', '', 'agent-image-list'); const refresh = () => imageCards(gallery, images, index => { images.splice(index, 1); refresh(); }); refresh();
    actions.append(button(t('agent-dialogues.sa4e6f10'), () => this.resend(record, turn, edit.value, { images })), button(t('agent-dialogues.s4d0b468'), () => { edit.remove(); actions.remove(); hint.remove(); gallery.remove(); })); this.expandMessage(user, true); user.querySelector('.agent-message-body').append(edit, gallery, hint, actions); edit.focus();
  }
  async resend(record, turn, source, { compactOnly = false, images = agentTurnImages(turn) } = {}) {
    if (this.panel.agent.busy || this.loading || !source.trim()) return;
    const generation = this.generation; await Promise.all([this.panel.credentialsReady, this.ready]);
    if (generation !== this.generation || this.panel.agent.busy || this.loading || this.store.records.get(record.id) !== record || !record.turns.includes(turn)) return;
    if (!this.panel.key) { this.panel.configuration(); return; }
    if (images.length && !this.panel.capabilities().images) { this.panel.notify(t('agent-images.unsupported'), 'warning'); return; }
    const removed = this.store.truncate(record.id, record.turns.indexOf(turn));
    for (const entry of removed) {
      this.turnViews.get(entry)?.root.remove(); this.turnViews.delete(entry); this.dirtyTurns.delete(entry);
      for (const exchange of entry.exchanges ?? []) this.activeExchanges.delete(exchange.id);
    }
    if (!record.memory) this.dirtyMemories.delete(record);
    this.scrollStates.delete(record.id); this.show(record.id); record.draft = ''; this.panel.input.value = ''; this.save();
    return this.send(source, t('agent-dialogues.s1f0d516'), { compactOnly, images });
  }
  fold(open) { for (const turn of this.recordView(this.store.current).querySelectorAll('.agent-turn')) { this.expandMessage(turn.querySelector('.agent-user-message'), open); this.expandMessage(turn.querySelector('.agent-turn-answer'), open); turn.querySelector('.agent-turn-work').open = open; } }
  manage() {
    const dialog = document.createElement('dialog'); dialog.className = 'agent-manage-dialog'; dialog.id = 'ai-conversation-manager'; dialog.dataset.agentPrivate = 'true';
    const record = this.store.current, name = document.createElement('input'); name.value = record.title; name.setAttribute('aria-label', t('agent-dialogues.s877673c'));
    dialog.append(text('h3', t('agent-dialogues.s862dfd5')), name, button(t('agent-dialogues.s1cd80fd'), () => { if (!name.value.trim()) return; this.store.rename(record.id, name.value); this.updateChoices(); this.save(); dialog.close(); }), button(t('agent-dialogues.s95d8172'), () => { if (this.running?.record === record) { this.panel.notify(t('agent-dialogues.sbd4e05f'), 'warning'); return; } if (!confirm(t('agent-dialogues.scc225d6'))) return; this.views.delete(record.id); this.scrollStates.delete(record.id); this.store.remove(record.id); this.show(this.store.selected); this.save(); dialog.close(); }), button(t('agent-dialogues.s734d3c4'), () => { this.fold(false); dialog.close(); }), button(t('agent-dialogues.s64edd63'), () => { this.fold(true); dialog.close(); }), button(t('agent-dialogues.s6c14bd7'), () => dialog.close()));
    dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
  }
  pending(signal, create, phase) {
    const task = this.running; this.updateStatus(phase);
    return new Promise(resolve => {
      let done = false, card;
      const finish = value => { if (done) return; done = true; signal?.removeEventListener('abort', abort); this.panel.waiting.delete(finish); if (card) { card.classList.add('agent-resolved'); card.querySelector('strong').textContent = value === true ? t('agent-dialogues.s4028759') : value?.answer ? t('agent-dialogues.s0d6d4e1') : signal?.aborted ? t('agent-dialogues.s75dddf5') : t('agent-dialogues.s4c7c52c'); for (const node of card.querySelectorAll('button,input,textarea')) node.disabled = true; } resolve(value); };
      const abort = () => finish(false); this.panel.waiting.add(finish); signal?.addEventListener('abort', abort, { once: true }); card = create(finish);
      if (!task) { finish(false); return; }
      task.view.work.open = true; task.view.workContent.append(card); this.panel.tab.hidden = false;
      this.scroll(); if (signal?.aborted) finish(false);
    });
  }
  approve(plan, signal) {
    this.panel.notify(t('agent-dialogues.s2e4d846') + plan.summary, 'warning');
    return this.pending(signal, finish => { const card = text('div', '', 'agent-approval'); card.append(text('strong', plan.access === 'dangerous' ? t('agent-dialogues.s80fe9df') : t('agent-dialogues.sd8f8506')), text('p', plan.summary), this.jsonDetail(t('agent-dialogues.s9bd00e2'), plan.details)); const actions = text('div', '', 'agent-actions'); actions.append(button(t('agent-dialogues.s375f686'), () => finish(true)), button(t('agent-dialogues.s03e210a'), () => finish(false))); card.append(actions); return card; }, t('agent-dialogues.s7cc8cab'));
  }
  ask(args, signal) {
    this.panel.notify(t('agent-dialogues.sd457b0d') + args.question.replace(/\s+/g, ' ').slice(0, 120), 'warning');
    return this.pending(signal, finish => { const card = text('form', '', 'agent-question'); card.append(text('strong', t('agent-dialogues.s70172e2'))); const question = text('div', '', 'agent-content'); renderAgentMarkdown(question, args.question); card.append(question);
      const input = document.createElement('textarea'); input.rows = 3; input.setAttribute('aria-label', t('agent-dialogues.s354b3f3')); const reply = value => { this.running?.turn.process.push({ kind: 'question', question: args.question, answer: value }); if (this.running) this.save(this.running.turn); card.append(text('p', value)); finish({ answer: value }); };
      input.title = t('agent-dialogues.replyShortcut');
      input.onkeydown = event => { submitAgentText(event, () => card.requestSubmit()); };
      const choices = text('div', '', 'agent-actions agent-question-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', t('agent-dialogues.s824f73d')); for (const choice of args.choices ?? []) choices.append(button(choice, () => reply(choice))); card.append(choices, input, button(t('agent-dialogues.s3f5ee82'), () => { if (input.value.trim()) reply(input.value.trim()); })); card.onsubmit = event => { event.preventDefault(); if (input.value.trim()) reply(input.value.trim()); }; return card;
    }, t('agent-dialogues.sac69952'));
  }
  scrollState() { if (!this.scrollStates.has(this.visibleId)) this.scrollStates.set(this.visibleId, { top: 0, bottom: Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight), follow: true, direction: 0 }); return this.scrollStates.get(this.visibleId); }
  trackScroll() {
    const state = this.scrollState(), top = this.viewport.scrollTop, bottom = Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight);
    if (top < state.top - 2 && state.direction <= 0 && bottom - top > 2) state.follow = false;
    else if (state.direction >= 0 && (bottom - top <= 2 || top > state.top + 2 && state.bottom - top <= 96)) state.follow = true;
    state.top = top; state.bottom = bottom;
  }
  scroll(force = false) {
    if (this.running && this.running.record !== this.store.current) return;
    const state = this.scrollState(), top = this.viewport.scrollTop;
    if (force) { state.follow = true; state.direction = 0; }
    else if (!state.follow && state.direction >= 0 && top > state.top + 2 && state.bottom - top <= 96) state.follow = true;
    if (state.follow) this.viewport.scrollTop = this.viewport.scrollHeight;
    state.top = this.viewport.scrollTop; state.bottom = Math.max(0, this.viewport.scrollHeight - this.viewport.clientHeight);
  }
  reset() { this.panel.agent?.stop(); clearTimeout(this.renderTimer); clearInterval(this.elapsedTimer); this.elapsedTimer = this.renderTimer = null; this.round = null; this.running = null; this.loading = false; this.ready = Promise.resolve(); this.autoQueue = false; this.store = new AgentConversations(); this.views.clear(); this.turnViews = new WeakMap(); this.scrollStates.clear(); this.visibleId = null; this.show(this.store.selected); }
}
