import { t } from '../i18n.mjs';
export const AGENT_MEMORY_PREFIX = t('agent-context.s39718a0');
export const AGENT_COMPACTION_PROMPT = t('agent-context.sc61702d');

export function agentRuntimeContext(summary, config, capabilities, instruction = '') {
  const { models, ...runtimeCapabilities } = capabilities;
  return { role: 'user', rpen_context: true, content: t('agent-context.runtime') + '\n' + JSON.stringify({ summary, permission: config.permission, capabilities: runtimeCapabilities, instruction }) };
}

export function agentCacheUsage(usage = {}) {
  const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  const miss = usage.prompt_cache_miss_tokens;
  const cacheKnown = Number.isFinite(hit) || Number.isFinite(miss);
  const cachedTokens = Math.max(0, hit ?? (cacheKnown ? (usage.prompt_tokens ?? 0) - miss : 0));
  return { cacheKnown, cachedTokens, uncachedTokens: Math.max(0, miss ?? (usage.prompt_tokens ?? 0) - cachedTokens) };
}

// Keep the core schema prefix stable and remember discoveries even when the
// discovered command was not called before this turn ended or was compacted.
export function agentToolNames(messages) {
  const names = new Set(AGENT_CORE_TOOLS);
  for (const message of messages) {
    for (const name of message.rpen_tools ?? []) if (typeof name === 'string') names.add(name);
    for (const call of message.tool_calls ?? []) if (call.function?.name) names.add(call.function.name);
  }
  return names;
}

export function estimateAgentTokens(value) {
  let images = 0;
  const source = typeof value === 'string' ? value : JSON.stringify(value, (key, entry) => key === 'image_url' ? (images++, '[图像]') : entry);
  let total = images * 2048;
  for (let index = 0; index < source.length; index++) total += source.charCodeAt(index) > 255 ? 1 : 0.3;
  return Math.ceil(total);
}

export function agentContextPolicy(config = {}, capabilities = {}) {
  const provided = Number(capabilities.contextWindow);
  const contextWindow = Number.isSafeInteger(provided) && provided >= 8192 ? provided : config.provider === 'deepseek' ? 1048576 : 131072;
  const requested = Number(config.contextBudget);
  const threshold = Number.isSafeInteger(requested) && requested >= 8192 ? requested : Math.floor(contextWindow * 0.65);
  return { contextWindow, threshold: Math.max(1024, Math.min(threshold, contextWindow - (config.maxTokens ?? 65536) - 4096)), automatic: config.autoCompact !== false };
}

export function agentContextUsage(tokens, policy, estimated = true) {
  tokens = Math.max(0, Math.round(Number(tokens) || 0));
  return { ...policy, tokens, ratio: tokens / policy.contextWindow, estimated };
}

export function agentContextSignature(config, context) {
  let fingerprint = 2166136261;
  for (const character of config.prompt ?? '') fingerprint = Math.imul(fingerprint ^ character.charCodeAt(0), 16777619);
  return JSON.stringify([config.provider, config.baseUrl, config.model, config.permission, fingerprint >>> 0, context]);
}

export function prepareAgentHistory(messages, { preserveToolReasoning = true } = {}) {
  return structuredClone(messages).map(message => {
    if (!preserveToolReasoning || !message.tool_calls?.length) { delete message.reasoning_content; delete message.reasoning_details; }
    if (message.role === 'tool' && !message.rpen_bounded_tool && typeof message.content === 'string' && message.content.length > 16000) message.content = message.content.slice(0, 12000) + t('agent-context.s6268ab4');
    return message;
  });
}

export function agentContextCut(messages, keep = 10) {
  const pending = new Set(); let cut = 0;
  const maximum = Math.max(0, messages.length - keep);
  for (let index = 0; index < maximum; index++) {
    for (const call of messages[index].tool_calls ?? []) pending.add(call.id);
    if (messages[index].role === 'tool') pending.delete(messages[index].tool_call_id);
    if (!pending.size) cut = index + 1;
  }
  return cut;
}

export function trimAgentImages(messages, supported = true, currentInput) {
  const protectedMessage = currentInput ? messages.findLast(message => message.rpen_input_images === currentInput && Array.isArray(message.content)) : null;
  const protectedImages = protectedMessage?.content.filter(part => part.type === 'image_url') ?? [];
  let bytes = protectedImages.reduce((sum, part) => sum + (part.image_url?.url?.length ?? 0), 0), count = protectedImages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]; if (!Array.isArray(message.content)) continue;
    const images = message.content.filter(part => part.type === 'image_url'); if (!images.length) continue;
    if (message === protectedMessage && supported) continue;
    bytes += images.reduce((total, part) => total + (part.image_url?.url?.length ?? 0), 0); count += images.length;
    const limit = protectedImages.length + 2;
    if (!supported || count > limit || bytes > 8 * 1024 * 1024) messages[index] = { ...message, content: message.content.filter(part => part.type !== 'image_url').map(part => part.text ?? '').join('\n') + t('agent-context.s197e146') };
  }
  return messages;
}

export const AGENT_CORE_TOOLS = new Set(['agent_tools', 'editor_context', 'editor_entities', 'editor_navigate', 'editor_source', 'chart_read', 'chart_query', 'chart_patch', 'chart_transform', 'chart_script', 'chart_templates', 'ui_inspect', 'ui_action', 'ask_user', 'web_search', 'web_fetch', 'history', 'diagnose']);
