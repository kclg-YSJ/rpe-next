import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorAgent } from '../src/application/agent.mjs';
import { AgentCommands, agentSchema } from '../src/core/agent-commands.mjs';
import { AgentProviders, createDeepSeekProvider } from '../src/platform/agent-provider.mjs';
import { agentSettings } from '../src/ui/agent-panel.mjs';
import { agentCacheUsage, prepareAgentHistory, agentRuntimeContext } from '../src/core/agent-context.mjs';
import { createAgentProfile } from '../src/core/agent-routing.mjs';
import { agentUsageText } from '../src/ui/agent-dialogues.mjs';

test('changing editor state and permissions appends runtime snapshots without rewriting system or prior messages', async () => {
  const requests = [], session = {}, commands = new AgentCommands(), providers = new AgentProviders(); let beat = 0, permission = 'ask';
  providers.register({ id: 'fixture', complete: async request => { requests.push(structuredClone({ system: request.system, messages: request.messages, tools: request.tools })); return { role: 'assistant', content: 'done' }; } });
  const agent = new EditorAgent({ commands, providers, context: () => ({ session, summary: { beat } }), config: () => ({ provider: 'fixture', key: 'test', permission, autoCompact: false }), prompt: () => 'stable rules' });
  await agent.run('first'); const history = structuredClone(agent.messages); beat = 5; permission = 'full'; await agent.run('second');
  assert.equal(requests[0].system, 'stable rules'); assert.equal(requests[1].system, requests[0].system);
  assert.deepEqual(requests[1].messages.slice(0, history.length), history);
  const snapshot = requests[1].messages.at(-1); assert.equal(snapshot.rpen_context, true); assert.ok(snapshot.content.includes('"beat":5')); assert.ok(snapshot.content.includes('"permission":"full"'));
});

test('tool definitions are captured once, appended in stable order and remembered after an unused discovery', async () => {
  const commands = new AgentCommands(), providers = new AgentProviders(), session = {}, requests = []; let calls = 0, reads = 0;
  const tools = commands.tools.bind(commands); commands.tools = () => { reads++; return tools(); };
  commands.register({ name: 'lazy', description: 'lazy', access: 'read', parameters: agentSchema(), prepare: () => ({ apply: () => 'ok' }) });
  commands.register({ name: 'agent_tools', description: 'discover', access: 'read', parameters: agentSchema(), prepare: () => ({ apply: () => ({ commands: [{ name: 'lazy' }] }) }) });
  providers.register({ id: 'fixture', complete: async request => {
    requests.push(request.tools.map(tool => tool.function.name));
    if (calls++ === 0) return { role: 'assistant', content: null, tool_calls: [{ id: 'discover', type: 'function', function: { name: 'agent_tools', arguments: '{}' } }] };
    return { role: 'assistant', content: 'done' };
  } });
  const agent = new EditorAgent({ commands, providers, context: () => ({ session, summary: {} }), config: () => ({ provider: 'fixture', key: 'test', permission: 'ask', autoCompact: false }), prompt: () => 'stable' });
  await agent.run('discover'); assert.equal(reads, 1); await agent.run('continue'); assert.equal(reads, 2);
  assert.deepEqual(requests, [['agent_tools'], ['agent_tools', 'lazy'], ['agent_tools', 'lazy']]);
});

test('cache hit zero is displayed, missing cache metadata is not presented as a measured miss', () => {
  assert.deepEqual(agentCacheUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 }), { cacheKnown: true, cachedTokens: 0, uncachedTokens: 100 });
  assert.equal(agentCacheUsage({ prompt_tokens: 100 }).cacheKnown, false);
  assert.equal(agentCacheUsage({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 80 } }).uncachedTokens, 20);
  assert.match(agentUsageText({ cacheKnown: true, cachedTokens: 0, uncachedTokens: 100 }), /0\.0%/);
});

test('runtime snapshots omit model dropdown lists while retaining actual model capabilities', () => {
  const context = agentRuntimeContext({}, { permission: 'ask' }, { models: Array.from({ length: 10000 }, () => 'dropdown-only-model'), images: true, maxOutputTokens: 131072 });
  assert.equal(context.content.includes('dropdown-only-model'), false); assert.ok(context.content.includes('"images":true')); assert.ok(context.content.includes('131072'));
});

test('bounded tool replies keep an identical prefix on the next user turn while legacy oversized replies stay bounded', () => {
  const content = 'x'.repeat(40000), stable = { role: 'tool', content, rpen_bounded_tool: true };
  assert.equal(prepareAgentHistory([stable])[0].content, content);
  assert.ok(prepareAgentHistory([{ role: 'tool', content }])[0].content.length < 16000);
});

test('output budgets above 65536 survive active profiles, legacy migration, serialization and profile switching', () => {
  for (const maxTokens of [65537, 131072, 262144, 1048576]) {
    const first = agentSettings({ uiVersion: 5, provider: 'deepseek', maxTokens });
    assert.equal(first.maxTokens, maxTokens);
    const restored = agentSettings(JSON.parse(JSON.stringify(first))); assert.equal(restored.maxTokens, maxTokens); assert.equal(restored.profiles[0].maxTokens, maxTokens);
    const second = { ...createAgentProfile('custom', 'second'), maxTokens: 32768 };
    const switched = agentSettings({ ...restored, profiles: [...restored.profiles, second], activeProfile: second.id }); assert.equal(switched.maxTokens, 32768);
    assert.equal(agentSettings({ ...switched, activeProfile: restored.activeProfile }).maxTokens, maxTokens);
  }
  for (const maxTokens of [0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(agentSettings({ provider: 'deepseek', maxTokens }).maxTokens, 65536);
});

test('request layer transmits larger output budgets and still respects explicit model output metadata', async () => {
  let body;
  const request = async (url, options) => {
    if (options.method === 'GET') return Response.json({ data: [{ id: 'fixture', top_provider: { max_completion_tokens: 100000 } }] });
    body = JSON.parse(options.body);
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  const provider = createDeepSeekProvider(request), config = { ...createAgentProfile('deepseek'), model: 'fixture', key: 'test', maxTokens: 131072 };
  await provider.complete({ config, system: '', messages: [], tools: [] }); assert.equal(body.max_tokens, 131072);
  await provider.modelInfo(config); await provider.complete({ config, system: '', messages: [], tools: [] }); assert.equal(body.max_tokens, 100000);
});
