import { AGENT_PERMISSIONS, agentAbort, checkAgentSignal } from '../core/agent-commands.mjs';
import { AGENT_COMPACTION_PROMPT, AGENT_MEMORY_PREFIX, estimateAgentTokens, prepareAgentHistory, agentContextCut, trimAgentImages, agentContextPolicy, agentContextUsage, agentRuntimeContext, agentToolNames, agentCacheUsage } from '../core/agent-context.mjs';
import { agentOutputLimit } from '../core/agent-routing.mjs';
import { t } from '../i18n.mjs';
import { agentImages, agentUserMessage } from '../core/agent-images.mjs';

export class EditorAgent extends EventTarget {
  constructor({ commands, providers, context, config, approve, ask, prompt, now = () => performance.now() }) {
    super(); Object.assign(this, { commands, providers, context, config, approve, ask, prompt, now }); this.messages = []; this.log = []; this.busy = false; this.steering = [];
  }
  elapsedMs() { return this.busy ? Math.max(0, this.now() - this.startedClock) : this.lastDurationMs ?? 0; }
  event(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  stop() { this.controller?.abort(); }
  steer(text, images = []) {
    if (!this.busy || !text.trim() && !images.length) return false;
    this.steering.push({ text: text.trim(), images: agentImages(images) }); if (this.requestPurpose !== 'compaction') this.requestController?.abort('steering'); this.toolController?.abort('steering'); return true;
  }
  reset() { this.stop(); this.messages = []; this.log = []; this.steering = []; this.event('reset', {}); }
  async run(text, { history, instruction = '', compactOnly = false, images = [] } = {}) {
    if (this.busy) throw Error(t('agent.s358f884'));
    images = agentImages(images);
    if (!text.trim() && !compactOnly && !images.length) return;
    const config = { ...this.config() }; if (!AGENT_PERMISSIONS.includes(config.permission)) throw Error(t('agent.s8614dbf'));
    const provider = this.providers.get(config.provider); if (!config.key?.trim()) throw Error(t('agent.s4e05b06'));
    const owner = this.context().session; if (!owner) throw Error(t('agent.s21c0425'));
    const controller = new AbortController(); this.controller = controller; this.startedClock = this.now(); this.busy = true; this.steering = [];
    const runId = crypto.randomUUID();
    let messages = prepareAgentHistory(history ?? this.messages), transcript = [], checkpoint = structuredClone(messages), checkpointTranscript = [], compacted = false;
    if (!compactOnly) { const user = agentUserMessage(text, images, runId); messages.push(user); transcript.push(user); checkpoint = structuredClone(messages); checkpointTranscript = structuredClone(transcript); }
    this.turnMessages = checkpointTranscript;
    const statistics = { model: config.model, provider: provider.name ?? config.provider, profile: config.profileName, reasoningEffort: config.thinking === false ? 'none' : config.reasoningEffort, startedAt: Date.now(), durationMs: 0, requestMs: 0, requests: 0, tools: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0, usageKnown: false, compactions: 0 };
    let status = 'failed', success = false, system = '', lastRequestMs = 0, currentInstruction = text;
    const guard = () => this.context().session === owner && !controller.signal.aborted;
    const redact = value => JSON.parse(JSON.stringify(value, (name, entry) => typeof entry === 'string' ? entry.replaceAll(config.key, '[已隐藏]') : entry));
    let capabilities = provider.capabilities?.(config.model) ?? {};
    const selectedTools = agentToolNames(messages), definitions = new Map(this.commands.tools().map(tool => [tool.function.name, tool]));
    const tools = () => definitions.has('agent_tools') ? [...selectedTools].flatMap(name => definitions.has(name) ? [definitions.get(name)] : []) : [...definitions.values()];
    let policy = agentContextPolicy(config, capabilities), budget = policy.threshold;
    const reportContext = (tokens = estimateAgentTokens({ system, tools: tools(), messages }), estimated = true) => {
      this.contextUsage = agentContextUsage(tokens, { ...policy, threshold: budget }, estimated); this.event('context-usage', this.contextUsage);
    };
    const usage = response => {
      statistics.model = response.model ?? config.model;
      if (!response.usage) return;
      const value = response.usage; statistics.usageKnown = true;
      statistics.promptTokens += value.prompt_tokens ?? 0; statistics.completionTokens += value.completion_tokens ?? 0;
      statistics.totalTokens += value.total_tokens ?? (value.prompt_tokens ?? 0) + (value.completion_tokens ?? 0);
      statistics.reasoningTokens += value.completion_tokens_details?.reasoning_tokens ?? 0;
      const cache = agentCacheUsage(value);
      statistics.cachedTokens += cache.cachedTokens;
      statistics.uncachedTokens = (statistics.uncachedTokens ?? 0) + (cache.cacheKnown ? cache.uncachedTokens : 0);
      statistics.cacheKnown ||= cache.cacheKnown;
    };
    const invoke = async (request, purpose) => {
      checkAgentSignal(controller.signal); if (!guard()) throw agentAbort();
      const requestController = new AbortController(); this.requestController = requestController; this.requestPurpose = purpose;
      const signal = AbortSignal.any([controller.signal, requestController.signal]), startedAt = Date.now(), startedClock = this.now();
      const exchange = { id: crypto.randomUUID(), purpose, startedAt, status: 'running', model: config.model, provider: config.provider,
        request: { system: request.system, messages: structuredClone(request.messages), tools: request.tools, maxTokens: request.config.maxTokens }, response: null };
      statistics.requests++; this.event('exchange-start', redact(exchange));
      if (purpose === 'chat') this.event('assistant-start', { model: config.model, startedAt });
      const inputTokens = purpose === 'chat' ? estimateAgentTokens({ system: request.system, tools: request.tools, messages: request.messages }) : 0;
      let streamedTokens = 0, lastMeterClock = this.now();
      const streamUsage = delta => { if (purpose !== 'chat') return; streamedTokens += estimateAgentTokens(delta); if (this.now() - lastMeterClock >= 250) { reportContext(inputTokens + streamedTokens); lastMeterClock = this.now(); } };
      try {
        const response = await provider.complete({ ...request, signal, exchangeId: exchange.id,
          onTrace: trace => { if (trace.request) exchange.request = trace.request; if (trace.response) exchange.response = trace.response; },
          onText: delta => { if (purpose === 'chat') this.event('text', { delta }); streamUsage(delta); },
          onReasoning: delta => { if (purpose === 'chat') this.event('reasoning', { delta }); streamUsage(delta); },
        });
        if (signal.aborted) throw agentAbort();
        exchange.status = 'completed'; exchange.response ??= { assistant: structuredClone(response) }; usage(response); return response;
      } catch (error) {
        exchange.status = controller.signal.aborted ? 'stopped' : requestController.signal.aborted ? 'interrupted' : 'failed';
        exchange.error = String(error.message); exchange.response ??= { status: error.status, body: error.responseBody ?? null };
        if (purpose === 'chat') this.event('assistant-cancelled', { reason: exchange.status });
        throw error;
      } finally {
        exchange.durationMs = Math.max(0, this.now() - startedClock); lastRequestMs = exchange.durationMs; statistics.requestMs += exchange.durationMs;
        this.event('exchange-end', redact(exchange)); if (this.requestController === requestController) this.requestController = null;
      }
    };
    const compress = async force => {
      const currentTools = tools(), before = estimateAgentTokens({ system, tools: currentTools, messages });
      if (!force && before <= budget) return false;
      let cut = agentContextCut(messages, force ? 4 : 10);
      if (!cut) cut = agentContextCut(messages, 1);
      if (!cut) return false;
      const reserve = Math.min(8192, Math.max(1024, Math.floor(budget / 8)));
      if (estimateAgentTokens({ system, tools: currentTools, messages: messages.slice(cut) }) + reserve > budget) cut = agentContextCut(messages, 1) || cut;
      if (estimateAgentTokens({ system, tools: currentTools, messages: messages.slice(cut) }) + reserve > budget && cut < messages.length) cut = agentContextCut(messages, 0) || cut;
      this.event('compaction-start', { beforeTokens: before });
      const prefix = prepareAgentHistory(messages.slice(0, cut), { preserveToolReasoning: false });
      const source = JSON.stringify(prefix, (key, value) => key === 'image_url' ? '[历史图像：需要时重新取图]' : value);
      const chunkSize = Math.max(4096, Math.min(120000, Math.floor((budget - 6000) * 1.5))); let summary = '';
      for (let offset = 0; offset < source.length; offset += chunkSize) {
        const response = await invoke({ config: { ...config, thinking: false, maxTokens: Math.min(8192, config.maxTokens ?? 8192) }, system: AGENT_COMPACTION_PROMPT,
          messages: [{ role: 'user', content: t('agent.sf8046ce') + summary + t('agent.s7cec8d2') + source.slice(offset, offset + chunkSize) }], tools: [] }, 'compaction');
        summary = response.content?.trim() ?? ''; if (!summary) throw Error(t('agent.sfde1bae'));
      }
      const retained = messages.slice(cut);
      if (!retained.length && !compactOnly) retained.push({ role: 'user', content: currentInstruction });
      messages = [{ role: 'user', content: AGENT_MEMORY_PREFIX + summary, rpen_tools: [...selectedTools] }, ...retained];
      compacted = true; statistics.compactions++;
      this.event('compaction-end', { summary, beforeTokens: before, afterTokens: estimateAgentTokens({ system, tools: currentTools, messages }) }); reportContext();
      checkpoint = structuredClone(messages); return true;
    };
    const steer = () => {
      for (const item of this.steering.splice(0)) { const value = typeof item === 'string' ? { text: item, images: [] } : item; if (value.images.length && !capabilities.images) throw Error(t('agent-images.unsupported')); currentInstruction = value.text; const message = agentUserMessage(value.text, value.images, runId); messages.push(message); transcript.push(message); this.event('steering', { text: value.text }); }
      checkpoint = structuredClone(messages); checkpointTranscript = structuredClone(transcript);
      this.turnMessages = checkpointTranscript;
    };
    this.log.push({ role: 'user', text }); this.event('user', { text, runId, startedAt: statistics.startedAt }); this.event('state', { busy: true });
    try {
      if (provider.modelInfo) { try { capabilities = { ...capabilities, ...await provider.modelInfo(config, { signal: controller.signal }) }; } catch (error) { checkAgentSignal(controller.signal); } }
      statistics.requestedMaxTokens = config.maxTokens ?? 65536;
      config.maxTokens = statistics.maxTokens = agentOutputLimit(config, capabilities);
      policy = agentContextPolicy(config, capabilities); budget = policy.threshold;
      if (images.length && !capabilities.images) throw Error(t('agent-images.unsupported'));
      trimAgentImages(messages, Boolean(capabilities.images), runId); checkpoint = structuredClone(messages);
      system = this.prompt();
      const contextMessage = agentRuntimeContext(this.context().summary, config, capabilities, instruction);
      messages.push(contextMessage);
      transcript.push(contextMessage); checkpoint = structuredClone(messages); checkpointTranscript = structuredClone(transcript);
      reportContext();
      if (compactOnly) {
        await compress(true);
        if (!this.steering.length) { this.messages = checkpoint = structuredClone(messages); success = true; status = 'completed'; this.event('compaction-only', { text: compacted ? t('agent.sfd58576') : t('agent.sfe0bbd6') }); return; }
        steer(); compactOnly = false;
      }
      const maxRounds = Math.max(1, Math.min(4096, config.maxRounds ?? 128)); let repaired = false;
      for (let round = 0; round < maxRounds; round++) {
        checkAgentSignal(controller.signal); if (!guard()) throw Error(t('agent.s5d3d59b'));
        if (this.steering.length) steer();
        if (policy.automatic) await compress(false);
        if (this.steering.length) steer();
        reportContext();
        this.event('round', { round: round + 1, maximum: maxRounds });
        let response;
        try { response = await invoke({ config, system, messages, tools: tools() }, 'chat'); }
        catch (error) {
          if (!controller.signal.aborted && this.steering.length) { steer(); continue; }
          if (policy.automatic && !repaired && !controller.signal.aborted && /context|上下文|token.*(?:limit|exceed)|maximum.*token/i.test(String(error.responseBody ?? error.message))) { repaired = true; budget = Math.max(8192, Math.floor(budget / 2)); if (await compress(true)) continue; }
          throw error;
        }
        if (!guard()) throw agentAbort();
        const { usage: tokenUsage, model, ...assistant } = response;
        messages.push(assistant); transcript.push(assistant); this.log.push({ role: 'assistant', text: assistant.content ?? '' });
        reportContext(Number.isFinite(tokenUsage?.prompt_tokens) ? tokenUsage.prompt_tokens + (tokenUsage.completion_tokens ?? 0) : undefined, !Number.isFinite(tokenUsage?.prompt_tokens));
        this.event('assistant-end', { text: assistant.content ?? '', reasoning: assistant.reasoning_content ?? '', final: !assistant.tool_calls?.length, model: model ?? config.model, usage: tokenUsage, durationMs: lastRequestMs });
        if (!assistant.tool_calls?.length) {
          checkpoint = structuredClone(messages); checkpointTranscript = structuredClone(transcript);
          this.turnMessages = checkpointTranscript;
          if (this.steering.length) { steer(); continue; }
          success = true; status = 'completed'; this.messages = checkpoint; return;
        }
        const images = [];
        for (const call of assistant.tool_calls) {
          checkAgentSignal(controller.signal); if (!guard()) throw agentAbort();
          let result; statistics.tools++;
          const toolController = new AbortController(); this.toolController = toolController;
          try {
            const args = JSON.parse(call.function.arguments); this.event('tool-start', { id: call.id, name: call.function.name, arguments: args });
            if (this.steering.length) result = { ok: false, cancelled: true, message: t('agent.sd7980bb') };
            else result = await this.commands.execute(call.function.name, args, { permission: config.permission, approve: this.approve, signal: AbortSignal.any([controller.signal, toolController.signal]), guard });
            if (toolController.signal.aborted && this.steering.length) result = { ok: false, cancelled: true, message: t('agent.s7c678e4') };
          } catch (error) {
            if (controller.signal.aborted) throw error;
            result = { ok: false, cancelled: toolController.signal.aborted, error: String(error.message).replaceAll(config.key, '[已隐藏]') };
          } finally { if (this.toolController === toolController) this.toolController = null; }
          if (call.function.name === 'agent_tools' && result.ok) for (const entry of result.result?.commands ?? []) {
            const registered = this.commands.entries.get(entry.name);
            if (registered && !definitions.has(entry.name)) definitions.set(entry.name, { type: 'function', function: { name: registered.name, description: registered.description, parameters: registered.parameters } });
            selectedTools.add(entry.name);
          }
          const image = result.result?.image; if (image) delete result.result.image;
          const content = JSON.stringify(result), message = { role: 'tool', tool_call_id: call.id, rpen_bounded_tool: true, content: content.length > 60000 ? JSON.stringify({ ok: false, error: t('agent.s7497cbc'), characters: content.length }) : content,
            ...(call.function.name === 'agent_tools' ? { rpen_tools: [...selectedTools] } : {}) };
          messages.push(message); transcript.push(message);
          this.log.push({ role: 'tool', name: call.function.name, text: content }); this.event('tool-end', { id: call.id, name: call.function.name, result });
          if (image && capabilities.images) images.push({ role: 'user', content: [{ type: 'text', text: t('agent.sa72ef18') + call.function.name + t('agent.s4d1f0a3') }, { type: 'image_url', image_url: { url: image } }] });
        }
        messages.push(...images); transcript.push(...images);
        trimAgentImages(messages, Boolean(capabilities.images), runId);
        this.messages = checkpoint = structuredClone(messages); checkpointTranscript = structuredClone(transcript);
        this.turnMessages = checkpointTranscript;
        if (this.steering.length) steer();
      }
      throw Error(t('agent.se4c2f89'));
    } catch (error) {
      const message = controller.signal.aborted ? t('agent.sa3e2c2f') : String(error.message).replaceAll(config.key, '[已隐藏]');
      status = controller.signal.aborted ? 'stopped' : 'failed'; this.event('error', { message, aborted: controller.signal.aborted }); this.log.push({ role: 'error', text: message });
      if (this.context().session === owner) this.messages = checkpoint;
    } finally {
      statistics.durationMs = this.lastDurationMs = this.elapsedMs(); this.busy = false; this.controller = this.requestController = this.toolController = null;
      this.event('turn-end', { runId, status, statistics, messages: structuredClone(checkpointTranscript), contextMessages: structuredClone(checkpoint), contextUsage: this.contextUsage, compacted });
      this.event('state', { busy: false, success });
    }
  }
}
