import { DEFAULT_AGENT_PROMPT } from '../core/agent-prompt.mjs';
import { AGENT_PROFILE_FIELDS, AGENT_REASONING_FORMATS, agentRoutePreset, createAgentProfile, agentBaseUrl, agentReasoningOptions, agentEffortLabel, validAgentMaxTokens } from '../core/agent-routing.mjs';
import { t } from '../i18n.mjs';

const text = (tag, value, className = '') => { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; };
const button = (label, action) => { const node = text('button', label); node.type = 'button'; node.onclick = action; return node; };
const option = (value, label) => { const node = text('option', label); node.value = value; return node; };
const input = (type, value) => { const node = document.createElement('input'); node.type = type; node.value = value; return node; };

export function showAgentConfiguration(panel) {
  panel.persist();
  panel.dialog?.remove(); const dialog = document.createElement('dialog'); dialog.id = 'ai-config'; dialog.dataset.agentPrivate = 'true'; panel.dialog = dialog;
  const heading = text('div', '', 'agent-heading'); heading.append(text('h2', t('agent-panel.s8717faa')), button(t('agent-panel.s6c14bd7'), () => dialog.close())); dialog.append(heading);
  const form = document.createElement('form'); form.className = 'agent-config-form';
  const field = (label, control, parent = form) => { const row = text('label', label, 'field'); control.setAttribute('aria-label', label); row.append(control); parent.append(row); return control; };
  const profiles = structuredClone(panel.settings.profiles), keys = new Map(panel.memoryKeys), removed = new Set(); keys.set(panel.settings.activeProfile, panel.key);
  let selected = panel.settings.activeProfile, serial = 0, loading = false; const modelMetadata = new Map();
  const toolbar = text('div', '', 'agent-profile-manager'), profile = document.createElement('select'); profile.setAttribute('aria-label', t('agent-route.profile'));
  const add = button(t('agent-route.add'), () => chooseTemplate()), copy = button(t('agent-route.copy'), () => addProfile(true));
  add.className = 'agent-profile-add';
  const remove = button(t('agent-route.delete'), () => {
    if (loading || profiles.length < 2 || !confirm(t('agent-route.confirmDelete', { name: current().name }))) return;
    removed.add(selected); keys.delete(selected); profiles.splice(profiles.findIndex(entry => entry.id === selected), 1); selected = profiles[0].id; loadDraft();
  });
  toolbar.append(profile, add, copy, remove); form.append(toolbar);
  const name = field(t('agent-route.name'), input('text', '')); name.maxLength = 100;
  const provider = document.createElement('select'); provider.className = 'agent-config-provider';
  for (const entry of panel.providers.entries.values()) provider.append(option(entry.id, entry.name)); field(t('agent-panel.s4b81846'), provider);
  const baseUrl = field(t('agent-route.baseUrl'), input('url', '')); baseUrl.placeholder = 'https://example.com/v1';
  const modelRow = text('div', '', 'agent-model-field'), model = input('text', ''); model.setAttribute('list', 'ai-model-options'); model.setAttribute('aria-label', t('agent-panel.s1b5fc09'));
  const models = document.createElement('datalist'); models.id = 'ai-model-options';
  const fetchModels = button(t('agent-route.loadModels'), async () => {
    if (!saveDraft()) return;
    fetchModels.disabled = true; const generation = serial;
    try {
      const entry = current(), service = panel.providers.get(entry.provider);
      if (!keys.get(selected)) throw Error(t('agent-route.keyRequired'));
      const info = await service.modelInfo?.({ ...entry, key: keys.get(selected) }, { strict: true });
      if (generation === serial) { models.replaceChildren(...(info?.models ?? service.models ?? []).map(value => option(value, value))); updateEfforts(info); }
    } catch (problem) { if (generation === serial) error.textContent = problem.message; }
    finally { if (generation === serial) fetchModels.disabled = false; }
  }); modelRow.append(model, fetchModels, models); field(t('agent-panel.s98fd0cb'), modelRow);
  const key = field('API Key', input('password', '')); key.autocomplete = 'off';
  const remember = field(t('agent-panel.s1ea779d'), input('checkbox', ''));
  form.append(text('p', panel.credentials.bridge ? t('agent-route.keyHintDesktop') : t('agent-route.keyHintWeb'), 'hint'));
  const forget = button(t('agent-panel.sf1a538c'), async () => {
    forget.disabled = true; const id = selected;
    try {
      await panel.credentials.write(id, ''); keys.set(id, ''); panel.memoryKeys.set(id, ''); if (selected === id) key.value = '';
      if (id === panel.settings.activeProfile) { panel.key = ''; panel.dialogues.updateStatus(); }
      error.textContent = ''; panel.notify(t('agent-panel.s7e8ccbc'), 'success');
    } catch (problem) { error.textContent = problem.message; }
    finally { forget.disabled = false; }
  }); form.append(forget);
  const effort = field(t('agent-route.effort'), document.createElement('select'));
  const advanced = document.createElement('details'); advanced.className = 'agent-route-advanced'; advanced.append(text('summary', t('agent-route.advanced'))); form.append(advanced);
  const format = document.createElement('select'); for (const value of AGENT_REASONING_FORMATS) format.append(option(value, value === 'none' ? t('agent-route.noReasoningParameter') : value)); field(t('agent-route.format'), format, advanced);
  const tokens = input('number', panel.settings.maxTokens); tokens.min = '1024'; tokens.step = '1'; field(t('agent-panel.s8b2fac1'), tokens);
  const outputHint = text('p', '', 'hint'); form.append(outputHint);
  const rounds = input('number', panel.settings.maxRounds); rounds.min = '1'; rounds.max = '4096'; rounds.step = '1'; rounds.title = t('agent-panel.sb2cb09a'); field(t('agent-panel.s469251b'), rounds);
  const automatic = field(t('agent-panel.sa1bd627'), input('checkbox', '')); automatic.checked = panel.settings.autoCompact;
  const budgetMode = document.createElement('select'); budgetMode.append(option('auto', t('agent-panel.s073d0df')), option('custom', t('agent-panel.sc233989'))); field(t('agent-panel.secf753d'), budgetMode);
  const budget = input('number', ''); budget.min = '8192'; budget.max = '16777216'; budget.step = '1'; budget.title = t('agent-panel.s0ee7f16'); const budgetRow = field(t('agent-panel.sb33c938'), budget).closest('label');
  const updateBudget = () => { budgetMode.disabled = !automatic.checked; budgetRow.hidden = budgetMode.value !== 'custom'; budget.disabled = !automatic.checked || budgetMode.value !== 'custom'; }; automatic.onchange = budgetMode.onchange = updateBudget;
  const font = input('number', panel.settings.fontSize); font.min = '10'; font.max = '24'; font.step = '1'; field(t('agent-panel.s0c8203a'), font);
  const instructions = document.createElement('details'); instructions.append(text('summary', t('agent-panel.s14b5be9')));
  const prompt = document.createElement('textarea'); prompt.rows = 16; prompt.className = 'agent-system-prompt'; prompt.value = panel.settings.prompt; prompt.setAttribute('aria-label', t('agent-panel.s78c0792'));
  instructions.append(prompt, button(t('agent-panel.s8ea0e19'), () => { if (confirm(t('agent-panel.se2ec7fb'))) prompt.value = DEFAULT_AGENT_PROMPT; })); form.append(instructions);
  const error = text('p', '', 'agent-error'); error.setAttribute('role', 'alert'); form.append(error); const apply = button(t('agent-panel.sa0daf6d'), () => {}); apply.type = 'submit'; form.append(apply);
  const current = () => profiles.find(entry => entry.id === selected);
  const updateChoices = () => { profile.replaceChildren(...profiles.map(entry => option(entry.id, entry.name))); profile.value = selected; remove.disabled = profiles.length < 2 || loading; copy.disabled = add.disabled = profiles.length >= 48 || loading; };
  const updateEfforts = metadata => {
    const identity = [selected, model.value, baseUrl.value].join('\n'); if (metadata) modelMetadata.set(identity, metadata);
    metadata ??= modelMetadata.get(identity) ?? (selected === panel.settings.activeProfile && model.value === panel.settings.model && baseUrl.value === panel.settings.baseUrl ? panel.capabilities() : undefined);
    outputHint.textContent = Number.isSafeInteger(metadata?.maxOutputTokens) && metadata.maxOutputTokens > 0 ? t('agent-output.modelLimit', { limit: metadata.maxOutputTokens }) : t('agent-output.hint');
    const value = effort.value || current().reasoningEffort, values = agentReasoningOptions({ ...current(), provider: provider.value, model: model.value, reasoningFormat: format.value }, metadata);
    effort.replaceChildren(...values.map(value => option(value, agentEffortLabel(value)))); effort.value = values.includes(value) ? value : 'auto'; effort.disabled = values.length < 2;
  };
  const updateModels = () => { models.replaceChildren(...(panel.providers.entries.get(provider.value)?.models ?? []).map(value => option(value, value))); };
  function saveDraft() {
    if (loading) return false;
    const entry = current(), maxTokens = Number(tokens.value), contextBudget = budgetMode.value === 'auto' ? 0 : Number(budget.value);
    try {
      if (!name.value.trim() || !model.value.trim() || !validAgentMaxTokens(maxTokens)) throw Error(t('agent-panel.s3188495'));
      if (!Number.isInteger(contextBudget) || contextBudget !== 0 && (contextBudget < 8192 || contextBudget > 16777216)) throw Error(t('agent-panel.se32854e'));
      const address = agentRoutePreset(provider.value) ? agentBaseUrl(baseUrl.value) : baseUrl.value;
      Object.assign(entry, { name: name.value.trim(), provider: provider.value, model: model.value.trim(), baseUrl: address, reasoningFormat: format.value, reasoningEffort: effort.value, thinking: effort.value !== 'none', maxTokens, contextBudget, rememberKey: remember.checked });
      keys.set(selected, key.value.trim()); error.textContent = ''; return true;
    } catch (problem) { error.textContent = problem.message; return false; }
  }
  async function loadDraft() {
    const entry = current(), generation = ++serial;
    name.value = entry.name; provider.value = entry.provider; baseUrl.value = entry.baseUrl; model.value = entry.model; format.value = entry.reasoningFormat;
    baseUrl.closest('label').hidden = !agentRoutePreset(entry.provider);
    effort.value = ''; effort.replaceChildren(option(entry.thinking === false ? 'none' : entry.reasoningEffort, '')); updateEfforts();
    remember.checked = entry.rememberKey; tokens.value = entry.maxTokens; budgetMode.value = entry.contextBudget ? 'custom' : 'auto'; budget.value = entry.contextBudget || Math.floor((entry.provider === 'deepseek' ? 1048576 : 131072) * 0.65);
    updateBudget(); updateModels(); error.textContent = ''; loading = true; updateChoices();
    key.value = ''; key.disabled = apply.disabled = profile.disabled = provider.disabled = forget.disabled = fetchModels.disabled = true;
    try { const value = keys.has(entry.id) ? keys.get(entry.id) : entry.rememberKey ? await panel.credentials.read(entry.id) : ''; if (generation === serial) { key.value = value; keys.set(entry.id, value); } }
    catch (problem) { if (generation === serial) error.textContent = problem.message; }
    finally { if (generation === serial) { loading = false; key.disabled = apply.disabled = profile.disabled = provider.disabled = forget.disabled = fetchModels.disabled = false; updateChoices(); } }
  }
  function chooseTemplate() {
    if (!saveDraft() || profiles.length >= 48) return;
    const picker = document.createElement('dialog'); picker.className = 'agent-template-picker'; picker.dataset.agentPrivate = 'true'; picker.setAttribute('aria-label', t('agent-route.chooseTemplate'));
    const heading = text('div', '', 'agent-heading'); heading.append(text('h3', t('agent-route.chooseTemplate')), button(t('agent-panel.s6c14bd7'), () => picker.close()));
    const choices = text('div', '', 'agent-template-choices');
    for (const entry of panel.providers.entries.values()) {
      const choose = button(entry.id === 'custom' ? t('agent-route.custom') : entry.name, () => { picker.close(); if (dialog.open) { addProfile(false, entry.id); name.focus(); name.select(); } });
      choose.dataset.provider = entry.id; choices.append(choose);
    }
    const closePicker = () => picker.close(); dialog.addEventListener('close', closePicker, { once: true });
    picker.addEventListener('close', () => { dialog.removeEventListener('close', closePicker); picker.remove(); }, { once: true });
    picker.append(heading, choices); document.body.append(picker); picker.showModal();
  }
  function addProfile(duplicate, template) {
    if (!saveDraft() || profiles.length >= 48) return;
    const id = 'profile-' + crypto.randomUUID(), entry = duplicate ? { ...current(), id, name: current().name + ' (2)' } : createAgentProfile(template, id);
    if (!agentRoutePreset(entry.provider)) { entry.name = panel.providers.get(entry.provider).name; entry.model = panel.providers.get(entry.provider).defaultModel ?? ''; }
    if (!duplicate && entry.provider === 'custom') entry.name = t('agent-route.custom');
    keys.set(id, duplicate ? key.value.trim() : ''); profiles.push(entry); selected = id; loadDraft();
  }
  profile.onchange = () => { const next = profile.value; if (!saveDraft()) { profile.value = selected; return; } selected = next; loadDraft(); };
  provider.onchange = () => {
    const template = createAgentProfile(provider.value); baseUrl.value = template.baseUrl; model.value = template.model || panel.providers.get(provider.value).defaultModel || ''; format.value = template.reasoningFormat;
    baseUrl.closest('label').hidden = !agentRoutePreset(provider.value); updateModels(); updateEfforts();
  };
  model.oninput = format.onchange = () => updateEfforts(); name.onchange = () => { if (name.value.trim()) { current().name = name.value.trim(); updateChoices(); } };
  form.onsubmit = async event => {
    event.preventDefault(); if (!saveDraft()) return;
    const maxRounds = Number(rounds.value), fontSize = Number(font.value);
    if (!prompt.value.trim() || !Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 4096 || !Number.isInteger(fontSize) || fontSize < 10 || fontSize > 24) { error.textContent = t('agent-panel.s3188495'); return; }
    const controls = [...form.querySelectorAll('input,select,textarea,button')]; controls.forEach(control => { control.disabled = true; });
    try {
      for (const entry of profiles) if (keys.has(entry.id)) await panel.credentials.write(entry.id, entry.rememberKey ? keys.get(entry.id) : '');
      for (const id of removed) await panel.credentials.write(id, '');
      const entry = current();
      panel.settings = { ...panel.settings, profiles, activeProfile: selected, ...Object.fromEntries(AGENT_PROFILE_FIELDS.map(field => [field, entry[field]])), maxRounds, autoCompact: automatic.checked, fontSize, prompt: prompt.value };
      panel.key = keys.get(selected) ?? ''; panel.memoryKeys = keys; panel.modelMetadata = null; panel.persist();
      panel.applyAppearance(); panel.dialogues.updateRouting(); panel.dialogues.updateStatus(); panel.dialogues.updateContextUsage(); panel.refreshCapabilities(); dialog.close();
    } catch (problem) { error.textContent = problem.message; }
    finally { controls.forEach(control => { control.disabled = false; }); updateBudget(); updateChoices(); updateEfforts(); }
  };
  dialog.append(form); document.body.append(dialog); dialog.showModal(); loadDraft();
}
