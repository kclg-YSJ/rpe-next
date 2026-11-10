import { t } from '../i18n.mjs';

export const AGENT_ROUTE_PRESETS = Object.freeze([
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'], reasoningFormat: 'deepseek' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4-flash', models: [], reasoningFormat: 'openrouter' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', models: [], reasoningFormat: 'openai' },
  { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V4-Flash', models: [], reasoningFormat: 'siliconflow' },
  { id: 'dashscope', name: '阿里云百炼 / Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', models: [], reasoningFormat: 'qwen' },
  { id: 'moonshot', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', models: [], reasoningFormat: 'kimi' },
  { id: 'custom', name: 'OpenAI Compatible', baseUrl: '', model: '', models: [], reasoningFormat: 'none' },
]);
export const AGENT_REASONING_FORMATS = Object.freeze(['deepseek', 'openrouter', 'openai', 'siliconflow', 'qwen', 'kimi', 'none']);
export const AGENT_EFFORTS = Object.freeze(['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const AGENT_PROFILE_FIELDS = Object.freeze(['provider', 'model', 'baseUrl', 'reasoningFormat', 'reasoningEffort', 'thinking', 'maxTokens', 'contextBudget', 'rememberKey']);
export const validAgentMaxTokens = value => Number.isSafeInteger(value) && value >= 1024;
export function agentOutputLimit(config, metadata = {}) {
  const requested = validAgentMaxTokens(config.maxTokens) ? config.maxTokens : 65536;
  return Number.isSafeInteger(metadata.maxOutputTokens) && metadata.maxOutputTokens > 0 ? Math.min(requested, metadata.maxOutputTokens) : requested;
}
export const agentRoutePreset = id => AGENT_ROUTE_PRESETS.find(entry => entry.id === id);
export const agentEffortLabel = effort => t('agent-route.effort.' + effort);
export function agentEffortDefault(config, metadata) {
  return metadata?.reasoning?.default_effort ?? (config.provider === 'deepseek' && /deepseek-(v4|flash)/.test(config.model) ? 'high' : config.provider === 'moonshot' && /kimi-k3/i.test(config.model) ? 'max' : null);
}

export function agentBaseUrl(value) {
  const url = new URL(String(value).trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback) || url.username || url.password || url.search || url.hash) throw Error(t('agent-route.invalidUrl'));
  return url.href.replace(/\/+$/, '');
}

export function agentRequestUrl(path, baseUrl = 'https://api.deepseek.com') {
  if (!['/chat/completions', '/models', '/v1/tools/search', '/v1/tools/fetch'].includes(path)) throw Error(t('agent-route.invalidRoute'));
  const base = agentBaseUrl(baseUrl);
  if (path.startsWith('/v1/tools/')) {
    if (new URL(base).origin !== 'https://api.deepseek.com') throw Error(t('agent-route.noSearch'));
    return 'https://api.deepseek.com' + path;
  }
  return base + path;
}

export function createAgentProfile(provider = 'custom', id = provider) {
  const preset = agentRoutePreset(provider);
  return { id, name: preset?.name ?? provider, provider, model: preset?.model ?? '', baseUrl: preset?.baseUrl ?? '', reasoningFormat: preset?.reasoningFormat ?? 'none', reasoningEffort: 'auto', thinking: true, maxTokens: 65536, contextBudget: 0, rememberKey: true };
}

export function agentProfileSettings(saved = {}) {
  const profiles = [], identifiers = new Set();
  for (const value of (Array.isArray(saved.profiles) ? saved.profiles : []).slice(0, 48)) {
    if (!value || !/^[a-z][a-z0-9_.-]{0,63}$/.test(value.id) || identifiers.has(value.id) || !/^[a-z][a-z0-9-]+$/.test(value.provider)) continue;
    const profile = createAgentProfile(value.provider, value.id);
    for (const field of ['name', ...AGENT_PROFILE_FIELDS]) if (typeof value[field] === typeof profile[field]) profile[field] = value[field];
    profile.name = profile.name.trim().slice(0, 100) || profile.provider;
    if (!AGENT_REASONING_FORMATS.includes(profile.reasoningFormat)) profile.reasoningFormat = 'none';
    if (!AGENT_EFFORTS.includes(profile.reasoningEffort)) profile.reasoningEffort = 'auto';
    if (!validAgentMaxTokens(profile.maxTokens)) profile.maxTokens = 65536;
    if (!Number.isInteger(profile.contextBudget) || profile.contextBudget !== 0 && (profile.contextBudget < 8192 || profile.contextBudget > 16777216)) profile.contextBudget = 0;
    profiles.push(profile); identifiers.add(profile.id);
  }
  if (!profiles.length) {
    const legacy = createAgentProfile(saved.provider ?? 'deepseek');
    for (const field of AGENT_PROFILE_FIELDS) if (typeof saved[field] === typeof legacy[field]) legacy[field] = saved[field];
    if (!validAgentMaxTokens(legacy.maxTokens)) legacy.maxTokens = 65536;
    profiles.push(legacy);
  }
  const activeProfile = profiles.some(profile => profile.id === saved.activeProfile) ? saved.activeProfile : profiles[0].id;
  return { profiles, activeProfile, ...AGENT_PROFILE_FIELDS.reduce((fields, field) => ({ ...fields, [field]: profiles.find(profile => profile.id === activeProfile)[field] }), {}) };
}

export function agentReasoningOptions(config, metadata) {
  const format = config.reasoningFormat ?? agentRoutePreset(config.provider)?.reasoningFormat ?? 'none', model = config.model ?? '';
  let values = ['auto'];
  if (format === 'deepseek') values = /deepseek-(v4|flash)/.test(model) ? ['auto', 'none', 'low', 'high', 'max'] : /reasoner/.test(model) ? ['auto'] : ['auto', 'none'];
  if (format === 'openrouter') {
    const info = metadata?.reasoning;
    if (info && Object.hasOwn(info, 'supported_efforts')) values = ['auto', ...(!info.mandatory ? ['none'] : []), ...(info.supported_efforts ?? AGENT_EFFORTS.filter(value => value !== 'auto'))];
    else if (!metadata?.supportedParameters || metadata.supportedParameters.includes('reasoning') || metadata.supportedParameters.includes('reasoning_effort')) values = [...AGENT_EFFORTS];
  }
  if (format === 'openai' && /^(?:o\d|gpt-[5-9])/.test(model)) values = ['auto', ...(/^gpt-(?:5\.[1-9]|[6-9])/.test(model) && !/-pro(?:-|$)/.test(model) ? ['none'] : []), ...(/^gpt-5(?:-|$)/.test(model) ? ['minimal'] : []), 'low', 'medium', 'high', ...(/gpt-(?:5\.[2-9]|[6-9])/.test(model) ? ['xhigh'] : [])];
  if (format === 'openai' && /-pro(?:-|$)/.test(model)) values = ['auto', 'high'];
  if (format === 'openai' && config.provider !== 'openai' && !/^(?:o\d|gpt-[4-9])/.test(model)) values = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  if (format === 'siliconflow') values = /DeepSeek-V4|GLM-5\.2/i.test(model) ? ['auto', 'none', 'low', 'high', 'max'] : ['auto', 'none'];
  if (format === 'qwen') values = ['auto', 'none'];
  if (format === 'kimi') values = /kimi-k3/i.test(model) ? ['auto', 'low', 'high', 'max'] : /kimi-k2\.[56]/i.test(model) ? ['auto', 'none'] : ['auto'];
  return [...new Set(values)].filter(value => AGENT_EFFORTS.includes(value) && !(format === 'openrouter' && metadata?.reasoning?.mandatory && value === 'none'));
}

export function agentReasoningParameters(config, metadata) {
  const format = config.reasoningFormat ?? agentRoutePreset(config.provider)?.reasoningFormat ?? 'none';
  const requested = config.thinking === false ? 'none' : config.reasoningEffort ?? 'auto';
  const effort = agentReasoningOptions(config, metadata).includes(requested) ? requested : 'auto', enabled = effort !== 'none', explicit = effort !== 'auto' && enabled;
  const model = config.model ?? '';
  if (format === 'deepseek') {
    const modern = /deepseek-(v4|flash)/.test(model);
    return { ...(modern || model === 'deepseek-chat' && enabled ? { thinking: { type: enabled ? 'enabled' : 'disabled' } } : {}), ...(modern && explicit ? { reasoning_effort: effort } : {}) };
  }
  if (format === 'openrouter') return effort === 'auto' ? {} : { reasoning: { effort } };
  if (format === 'openai') return effort === 'auto' ? {} : { reasoning_effort: effort };
  if (format === 'siliconflow') return { enable_thinking: enabled, ...(explicit && /DeepSeek-V4|GLM-5\.2/i.test(model) ? { reasoning_effort: effort } : {}) };
  if (format === 'qwen') return { enable_thinking: enabled };
  if (format === 'kimi') return /kimi-k3/i.test(model) ? explicit ? { reasoning_effort: effort } : {} : /kimi-k2\.[56]/i.test(model) ? { thinking: { type: enabled ? 'enabled' : 'disabled' } } : {};
  return {};
}
