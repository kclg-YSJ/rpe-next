import { checkAgentSignal } from '../core/agent-commands.mjs';
import { t } from '../i18n.mjs';
import { agentRoutePreset, agentRequestUrl, agentReasoningParameters, agentOutputLimit } from '../core/agent-routing.mjs';
import { agentApiError, agentConnectionError, agentResponseText } from '../core/agent-network-errors.mjs';

export class AgentProviders extends EventTarget {
  constructor() { super(); this.entries = new Map(); }
  register(provider) {
    if (!/^[a-z][a-z0-9-]+$/.test(provider.id) || this.entries.has(provider.id) || typeof provider.complete !== 'function') throw Error(t('agent-provider.s64b4a63'));
    this.entries.set(provider.id, provider); this.dispatchEvent(new Event('change'));
    return () => { if (this.entries.get(provider.id) === provider) { this.entries.delete(provider.id); this.dispatchEvent(new Event('change')); } };
  }
  get(id) { const provider = this.entries.get(id); if (!provider) throw Error(t('agent-provider.s0c2e384')); return provider; }
}

export async function agentHttp(path, key, body, { signal, onChunk, request, baseUrl } = {}) {
  checkAgentSignal(signal);
  const url = agentRequestUrl(path, baseUrl);
  if (!key?.trim()) throw Error(t('agent-provider.s4c02bba'));
  if (globalThis.rpenAgentNetwork && !request) {
    const id = crypto.randomUUID(), bridge = globalThis.rpenAgentNetwork;
    let chunkError, chunks = 0, expected = Infinity, delivered, rejectDelivery, timer;
    const dispose = bridge.onChunk(id, chunk => { chunks++; try { onChunk?.(chunk); } catch (error) { chunkError = error; bridge.cancel(id); } if (chunks >= expected || chunkError) delivered?.(); });
    const abort = () => { bridge.cancel(id); try { checkAgentSignal(signal); } catch (error) { rejectDelivery?.(error); } }; signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await bridge.request(id, path, key, body, { baseUrl });
      if (chunkError) throw chunkError;
      if (!response.ok) throw Object.assign(Error(response.message), { status: response.status, code: response.code, responseBody: response.responseBody, requestId: response.requestId, endpoint: response.endpoint });
      expected = body?.stream === true && Number.isSafeInteger(response.result?.chunks) ? response.result.chunks : 0;
      checkAgentSignal(signal);
      if (chunks < expected && !chunkError) await new Promise((resolve, reject) => { delivered = resolve; rejectDelivery = reject; timer = setTimeout(() => reject(Error(t('agent-provider.sda51075'))), 10000); });
      if (chunkError) throw chunkError;
      return response.result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); dispose(); }
  }
  request ??= globalThis.fetch.bind(globalThis);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 180000);
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  let response;
  try { response = await request(url, { method: path === '/models' ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, ...(path === '/models' ? {} : { body: JSON.stringify(body) }), signal: controller.signal, redirect: 'error' }); }
  catch (error) { clearTimeout(timeout); signal?.removeEventListener('abort', abort); if (signal?.aborted) throw error; throw agentConnectionError(error, { url, key, timedOut: controller.signal.aborted, browser: typeof window !== 'undefined' }); }
  if (!response.ok) {
    try {
      const responseBody = await agentResponseText(response);
      throw agentApiError({ url, status: response.status, statusText: response.statusText, body: responseBody, key, requestId: response.headers?.get('x-request-id') ?? response.headers?.get('x-openrouter-request-id') });
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0, contents = '';
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16 * 1024 * 1024) throw Error(t('agent-provider.s4bd8619')); const chunk = decoder.decode(value, { stream: true }); if (onChunk) onChunk(chunk); else contents += chunk; }
    const rest = decoder.decode(); if (onChunk) onChunk(rest); else return JSON.parse(contents + rest);
  } finally { reader.releaseLock(); clearTimeout(timeout); signal?.removeEventListener('abort', abort); controller.abort(); }
}

export function createCompatibleProvider(preset, request) {
  const call = (path, config, body, options) => agentHttp(path, config.key, body, { ...options, baseUrl: config.baseUrl || preset.baseUrl, request });
  const metadata = new Map();
  const identityOf = config => [config.baseUrl || preset.baseUrl, config.key, config.model].join('\n');
  const capabilities = model => ({ tools: true, images: preset.id === 'deepseek' ? ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(model) : /^(?:gpt-[4-9]|o[134]|kimi-k2\.[56]|kimi-k3)|(?:vision|(?:^|[/_-])vl(?:[/_-]|$))/i.test(model ?? ''), search: preset.id === 'deepseek', streaming: true, contextWindow: preset.id === 'deepseek' ? 1048576 : 131072 });
  return {
    id: preset.id, name: preset.name, defaultModel: preset.model, models: preset.models, capabilities,
    async modelInfo(config, { signal, strict = false } = {}) {
      checkAgentSignal(signal);
      const identity = identityOf(config), cached = metadata.get(identity);
      if (cached && Date.now() - cached.at < 3600000 && (!strict || !cached.error)) return cached.value;
      let response;
      try { response = await call('/models', config, {}, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) }); }
      catch (error) { checkAgentSignal(signal); const value = { ...capabilities(config.model), source: 'fallback' }; metadata.set(identity, { at: Date.now() - 3540000, value, error }); if (strict) throw error; return value; }
      const model = response.data?.find(entry => entry.id === config.model);
      const contextWindow = Number(model?.context_window ?? model?.context_length ?? model?.max_model_len);
      const modalities = model?.architecture?.input_modalities;
      const value = { ...capabilities(config.model), ...(Number.isSafeInteger(contextWindow) && contextWindow >= 8192 ? { contextWindow, source: 'provider' } : { source: 'fallback' }),
        ...(Array.isArray(modalities) ? { images: modalities.includes('image') } : {}), ...(Array.isArray(model?.supported_parameters) ? { supportedParameters: model.supported_parameters } : {}),
        ...(model?.reasoning ? { reasoning: model.reasoning } : {}), ...(Number(model?.top_provider?.max_completion_tokens) > 0 ? { maxOutputTokens: Number(model.top_provider.max_completion_tokens) } : {}),
        models: (response.data ?? []).filter(entry => typeof entry.id === 'string').map(entry => entry.id) };
      metadata.set(identity, { at: Date.now(), value }); if (metadata.size > 32) metadata.delete(metadata.keys().next().value);
      return value;
    },
    async complete({ config, system, messages, tools, signal, onText, onReasoning, onTrace }) {
      const format = config.reasoningFormat ?? preset.reasoningFormat;
      const enabled = config.thinking !== false && config.reasoningEffort !== 'none';
      const body = { model: config.model, messages: [{ role: 'system', content: system }, ...messages.map(source => {
        const message = Object.fromEntries(['role', 'content', 'tool_calls', 'tool_call_id', 'name'].filter(field => source[field] !== undefined).map(field => [field, source[field]]));
        const sameRoute = !source.rpen_route || source.rpen_route === (config.baseUrl || preset.baseUrl) + '\n' + config.model;
        if (enabled && sameRoute && ['deepseek', 'siliconflow', 'qwen', 'kimi'].includes(format) && message.role === 'assistant' && message.tool_calls?.length) message.reasoning_content = source.reasoning_content ?? '';
        if (enabled && sameRoute && format === 'openrouter' && message.role === 'assistant') {
          if (source.reasoning_details?.length) message.reasoning_details = source.reasoning_details;
          else if (source.reasoning_content) message.reasoning = source.reasoning_content;
        }
        return message;
      })], ...(tools?.length ? { tools } : {}), stream: true, stream_options: { include_usage: true },
        [format === 'openai' ? 'max_completion_tokens' : 'max_tokens']: agentOutputLimit(config, metadata.get(identityOf(config))?.value), ...agentReasoningParameters({ ...config, reasoningFormat: format }, metadata.get(identityOf(config))?.value) };
      onTrace?.({ request: { url: agentRequestUrl('/chat/completions', config.baseUrl || preset.baseUrl), method: 'POST', headers: { Authorization: '[已隐藏]', 'Content-Type': 'application/json' }, body } });
      let pending = '', content = '', reasoning = '', finish = '', receivedDone = false, usage = null, model = config.model; const calls = new Map();
      const reasoningDetails = [];
      let raw = '';
      try { await call('/chat/completions', config, body, { signal, onChunk(chunk) {
        raw += chunk;
        pending += chunk;
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim(); if (!data) continue; if (data === '[DONE]') { receivedDone = true; continue; }
          const response = JSON.parse(data); if (response.error) throw agentApiError({ url: agentRequestUrl('/chat/completions', config.baseUrl || preset.baseUrl), body: response, key: config.key });
          if (response.usage) usage = response.usage;
          if (response.model) model = response.model;
          const choice = response.choices?.[0]; if (!choice) continue;
          finish = choice.finish_reason ?? finish; const delta = choice.delta ?? {};
          if (delta.content) { content += delta.content; onText?.(delta.content); }
          const thought = delta.reasoning_content ?? delta.reasoning;
          if (thought) { reasoning += thought; onReasoning?.(thought); }
          for (const part of delta.reasoning_details ?? []) {
            reasoningDetails.push(part);
            if (!thought && (part.text || part.summary)) { const text = part.text || part.summary; reasoning += text; onReasoning?.(text); }
          }
          for (const part of delta.tool_calls ?? []) {
            const index = part.index ?? 0; let entry = calls.get(index);
            if (!entry) { entry = { id: '', type: 'function', function: { name: '', arguments: '' } }; calls.set(index, entry); }
            if (part.id) entry.id = part.id;
            if (part.function?.name) entry.function.name += part.function.name;
            if (part.function?.arguments) entry.function.arguments += part.function.arguments;
          }
        }
      } }); } catch (error) { onTrace?.({ response: { status: error.status, body: raw || error.responseBody || '', interrupted: Boolean(signal?.aborted) } }); throw error; }
      onTrace?.({ response: { status: 200, body: raw, format: 'text/event-stream' } });
      if (!receivedDone || !finish) {
        let payload; try { payload = JSON.parse(raw); } catch {}
        if (payload?.error) throw agentApiError({ url: agentRequestUrl('/chat/completions', config.baseUrl || preset.baseUrl), body: payload, key: config.key });
        throw Error(t('agent-provider.sda51075'));
      }
      if (finish === 'length') throw Error(t('agent-provider.sa887565'));
      const toolCalls = [...calls.values()];
      if (toolCalls.some(entry => !entry.id || !entry.function.name)) throw Error(t('agent-provider.sfc19d6a'));
      return { role: 'assistant', content: content || null, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}), usage, model, rpen_route: (config.baseUrl || preset.baseUrl) + '\n' + config.model };
    },
    ...(preset.id === 'deepseek' ? {
      async search(config, query, signal) { return call('/v1/tools/search', config, { query, count: 5, need_content: false }, { signal }); },
      async fetch(config, url, signal) { return call('/v1/tools/fetch', config, { url }, { signal }); },
    } : {}),
  };
}

export function createDeepSeekProvider(request) { return createCompatibleProvider(agentRoutePreset('deepseek'), request); }
