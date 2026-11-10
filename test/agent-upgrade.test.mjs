import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentConversations, conversationMessages } from '../src/application/agent-conversations.mjs';
import { AgentConversationRepository } from '../src/platform/agent-store.mjs';
import { AgentCommands, agentSchema } from '../src/core/agent-commands.mjs';
import { EditorAgent } from '../src/application/agent.mjs';
import { AgentProviders, createDeepSeekProvider } from '../src/platform/agent-provider.mjs';
import { AGENT_MEMORY_PREFIX, AGENT_COMPACTION_PROMPT, prepareAgentHistory, trimAgentImages } from '../src/core/agent-context.mjs';
import { createChart, createNote } from '../src/core/chart.mjs';
import { agentScriptChanges } from '../src/core/agent-script.mjs';
import { runAgentChartScript } from '../src/platform/agent-script.mjs';
import { registerAgentComponentTools } from '../src/application/agent-component-tools.mjs';

const call = (name, args = {}, id = 'call') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
function engine(complete, { commands = new AgentCommands(), ...settings } = {}) {
  const providers = new AgentProviders(), session = {};
  providers.register({ id: 'fixture', capabilities: () => ({ images: true }), complete });
  return new EditorAgent({ commands, providers, context: () => ({ session, summary: {} }), config: () => ({ provider: 'fixture', model: 'fixture-model', key: 'sk-private-fixture', permission: 'full', ...settings }), prompt: () => 'system' });
}
function storage() {
  const values = new Map(); return { values, read: async key => structuredClone(values.get(key)), write: async (key, value) => { values.set(key, structuredClone(value)); } };
}

test('同谱面的多对话、上下文、草稿和完整请求独立持久化；重新打开不丢失且不串谱面', async () => {
  const memory = storage(), id = crypto.randomUUID(), repository = new AgentConversationRepository(id, memory), book = new AgentConversations();
  const first = book.current; first.title = 'first'; first.draft = 'draft'; first.turns = [{ id: 'turn-a', text: 'task', status: 'completed', answer: 'done', messages: [{ role: 'user', content: 'task' }, { role: 'assistant', content: 'done' }], exchanges: [{ id: 'trace-a' }] }];
  first.memory = { through: 'turn-a', messages: [{ role: 'user', content: AGENT_MEMORY_PREFIX + 'summary' }] };
  const second = book.create('second'); second.context.mode = 'last'; second.turns = [{ id: 'turn-b', text: 'queued', status: 'queued', messages: [] }];
  await repository.saveTrace({ id: 'trace-a', request: { body: { messages: [{ content: 'x'.repeat(80000) }] } }, response: { body: 'response'.repeat(20000) } });
  await repository.save(book, { turns: [...first.turns, ...second.turns], memories: [first] });
  const loaded = await new AgentConversationRepository(id, memory).load(); assert.equal(loaded.selected, second.id); assert.equal(loaded.records.get(first.id).draft, 'draft');
  assert.equal(loaded.current.turns[0].paused, true); assert.equal(loaded.records.get(first.id).turns[0].answer, 'done'); assert.equal(conversationMessages(loaded.records.get(first.id))[0].content, AGENT_MEMORY_PREFIX + 'summary');
  assert.equal((await repository.trace('trace-a')).request.body.messages[0].content.length, 80000); assert.equal((await repository.trace('trace-a')).response.body.length, 160000);
  assert.equal((await new AgentConversationRepository(crypto.randomUUID(), memory).load()).current.turns.length, 0);
});

test('快速退出重进等待同谱面旧写入，迟到任务收尾不覆盖新建对话元数据', async () => {
  const memory = storage(), id = crypto.randomUUID(), first = new AgentConversationRepository(id, memory), book = new AgentConversations();
  const turn = { id: 'late', status: 'running', messages: [] }; book.current.turns.push(turn);
  const pending = first.save(book, { turns: [turn] }), second = new AgentConversationRepository(id, memory), loaded = await second.load(); await pending;
  assert.equal(loaded.current.turns[0].status, 'stopped'); const created = loaded.create('new'); await second.save(loaded);
  turn.status = 'stopped'; await first.saveTurns([turn]); const latest = await second.load(); assert.equal(latest.selected, created.id); assert.equal(latest.records.size, 2);
});

test('原对话重发后保存重开不会恢复旧回复、后续消息或失效摘要，其他对话保持原样', async () => {
  const memory = storage(), workspace = crypto.randomUUID(), repository = new AgentConversationRepository(workspace, memory), book = new AgentConversations(), record = book.current;
  record.title = '原对话'; record.turns = [0, 1, 2].map(index => ({ id: 'old-' + index, status: 'completed', text: 'old-' + index, answer: 'old answer', messages: [{ role: 'user', content: 'old-' + index }, { role: 'assistant', content: 'old answer' }] }));
  record.memory = { through: 'old-2', messages: [{ role: 'user', content: 'future summary' }] };
  const other = book.create('另一对话'); other.draft = 'keep'; await repository.save(book, { turns: record.turns, memories: [record] });
  book.truncate(record.id, 1); const replacement = { id: 'replacement', text: 'new task', status: 'completed', messages: [{ role: 'user', content: 'new task' }, { role: 'assistant', content: 'new answer' }] }; record.turns.push(replacement);
  await repository.save(book, { turns: [replacement] });
  const loaded = await new AgentConversationRepository(workspace, memory).load(); assert.equal(loaded.records.size, 2); assert.equal(loaded.current.id, record.id); assert.equal(loaded.current.title, '原对话');
  assert.deepEqual(loaded.current.turns.map(turn => turn.id), ['old-0', 'replacement']); assert.equal(loaded.current.memory, undefined); assert.equal(loaded.records.get(other.id).draft, 'keep');
  assert.deepEqual(conversationMessages(loaded.current).map(message => message.content), ['old-0', 'old answer', 'new task', 'new answer']);
});

test('长上下文自动压缩，保留完整本轮记录与工具配对，而不是报废对话', async () => {
  let compressions = 0, chat = 0, ended;
  const agent = engine(async request => {
    if (request.system === AGENT_COMPACTION_PROMPT) { compressions++; assert.deepEqual(request.tools, []); assert.ok(!JSON.stringify(request.messages).includes('private-old-thinking')); return { role: 'assistant', content: '用户要求整理谱面；已修改十个音符，需核查最新状态。' }; }
    chat++; assert.ok(request.messages[0].content.startsWith(AGENT_MEMORY_PREFIX)); assert.equal(request.messages.findLast(message => message.role === 'user' && !message.rpen_context).content, '继续'); return { role: 'assistant', content: 'done' };
  }, { contextBudget: 8192 });
  const history = Array.from({ length: 40 }, (_, index) => [{ role: 'user', content: '旧任务 ' + index + ' 数据'.repeat(400) }, { role: 'assistant', content: '结果'.repeat(400), reasoning_content: 'private-old-thinking' }]).flat();
  agent.addEventListener('turn-end', event => { ended = event.detail; }); await agent.run('继续', { history });
  assert.ok(compressions > 0); assert.equal(chat, 1); assert.equal(ended.status, 'completed'); assert.equal(ended.compacted, true);
  assert.deepEqual(ended.messages.filter(message => !message.rpen_context).map(message => message.role), ['user', 'assistant']); assert.equal(ended.messages[0].content, '继续'); assert.ok(ended.contextMessages.length < history.length);
});

test('请求进行中插话会取消未完成响应并重新规划，保留完整请求状态且隐藏密钥', async () => {
  let pending = false, count = 0, ended; const exchanges = [];
  const agent = engine(async request => {
    count++;
    if (count === 1) return new Promise((resolve, reject) => { pending = true; request.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }); });
    assert.equal(request.messages.at(-1).content, '改为移动预览时间'); return { role: 'assistant', content: 'done' };
  });
  agent.addEventListener('exchange-end', event => exchanges.push(event.detail)); agent.addEventListener('turn-end', event => { ended = event.detail; });
  const running = agent.run('原任务'); while (!pending) await wait(); assert.equal(agent.steer('改为移动预览时间'), true); await running;
  assert.equal(ended.status, 'completed'); assert.deepEqual(exchanges.map(exchange => exchange.status), ['interrupted', 'completed']);
  assert.deepEqual(ended.messages.filter(message => message.role === 'user' && !message.rpen_context).map(message => message.content), ['原任务', '改为移动预览时间']); assert.ok(!JSON.stringify(exchanges).includes('sk-private-fixture')); assert.equal(agent.steer('idle'), false);
});

test('多工具执行中插话取消剩余修改，所有工具调用仍有对应返回', async () => {
  const commands = new AgentCommands(); let started = false, mutations = 0, requests = 0;
  commands.register({ name: 'slow', access: 'read', description: 'slow', parameters: agentSchema(), prepare: (args, { signal }) => ({ apply: () => new Promise((resolve, reject) => { started = true; signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }); }) }) });
  commands.register({ name: 'mutate', access: 'edit', description: 'mutate', parameters: agentSchema(), prepare: () => ({ apply: () => mutations++ }) });
  const agent = engine(async request => {
    if (++requests === 1) return { role: 'assistant', content: null, tool_calls: [call('slow', {}, 'a'), call('mutate', {}, 'b')] };
    const assistant = request.messages.find(message => message.tool_calls); assert.deepEqual(assistant.tool_calls.map(call => call.id), ['a', 'b']);
    assert.deepEqual(request.messages.filter(message => message.role === 'tool').map(message => message.tool_call_id), ['a', 'b']); assert.equal(request.messages.at(-1).content, '停止修改，解释即可'); return { role: 'assistant', content: 'done' };
  }, { commands });
  const running = agent.run('task'); while (!started) await wait(); agent.steer('停止修改，解释即可'); await running; assert.equal(mutations, 0); assert.equal(requests, 2);
});

test('工具按需发现，初始请求不重复携带无关命令的完整定义', async () => {
  const commands = new AgentCommands(); let count = 0;
  commands.register({ name: 'agent_tools', access: 'read', description: 'discover', parameters: agentSchema(), prepare: () => ({ apply: () => ({ commands: [{ name: 'optional_generator' }] }) }) });
  commands.register({ name: 'optional_generator', access: 'edit', description: 'large'.repeat(1000), parameters: agentSchema(), prepare: () => ({ apply: () => null }) });
  const agent = engine(async request => { if (++count === 1) { assert.ok(!request.tools.some(tool => tool.function.name === 'optional_generator')); return { role: 'assistant', content: null, tool_calls: [call('agent_tools')] }; } assert.ok(request.tools.some(tool => tool.function.name === 'optional_generator')); return { role: 'assistant', content: 'done' }; }, { commands });
  await agent.run('discover'); assert.equal(count, 2);
});

test('旧思考与过大工具结果不重复进入上下文，图像裁剪保留文字任务', () => {
  const history = [{ role: 'assistant', content: 'a', reasoning_content: 'thinking' }, { role: 'tool', content: 'x'.repeat(30000) }];
  const prepared = prepareAgentHistory(history); assert.equal(prepared[0].reasoning_content, undefined); assert.ok(prepared[1].content.length < 16000); assert.equal(history[0].reasoning_content, 'thinking');
  const messages = [0, 1, 2].map(index => ({ role: 'user', content: [{ type: 'text', text: '保留目标 ' + index }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }));
  trimAgentImages(messages); assert.ok(messages[0].content.includes('保留目标 0')); assert.ok(Array.isArray(messages[1].content)); trimAgentImages(messages, false); assert.ok(messages.every(message => typeof message.content === 'string' && message.content.includes('保留目标')));
});

test('完整请求和原始 SSE 返回可检查，凭据不放入请求头记录', async () => {
  const wire = 'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', traces = [];
  const provider = createDeepSeekProvider(async () => new Response(wire));
  const response = await provider.complete({ config: { key: 'sk-private', model: 'deepseek-flash' }, system: 'full system', messages: [{ role: 'user', content: 'full user' }], tools: [], onTrace: trace => traces.push(trace) });
  assert.equal(response.content, 'done'); assert.equal(traces[0].request.body.messages[0].content, 'full system'); assert.equal(traces[1].response.body, wire); assert.ok(!JSON.stringify(traces).includes('sk-private'));
});

test('谱面脚本检测整线删改与大量删除，普通批量新增仍是普通编辑', () => {
  const before = createChart(); before.judgeLineList[0].notes = Array.from({ length: 80 }, (_, index) => createNote(1, index, 0));
  const added = structuredClone(before); added.judgeLineList[0].notes.push(createNote(4, 90, 0)); assert.equal(agentScriptChanges(before, added, [0]).dangerous, false);
  const removed = structuredClone(before); removed.judgeLineList[0].notes = []; assert.equal(agentScriptChanges(before, removed, [0]).dangerous, true);
  assert.equal(agentScriptChanges(before, added, [null]).removedLines, 1);
});

test('脚本超时或停止终止 Worker，不向原谱面应用任何数据', async () => {
  const chart = createChart(); let terminated = 0;
  const workerFactory = () => ({ postMessage() {}, terminate() { terminated++; } });
  await assert.rejects(runAgentChartScript('while(true){}', chart, {}, undefined, { timeout: 20, workerFactory }), /超时/);
  const controller = new AbortController(), task = runAgentChartScript('await something', chart, {}, controller.signal, { workerFactory }); controller.abort(); await assert.rejects(task, /停止/);
  assert.equal(terminated, 2); assert.equal(chart.judgeLineList[0].notes.length, 0);
});

test('通用组件入口可发现并调用原生能力，修改和调用受危险审批，不能访问构造器或凭据', async () => {
  const commands = new AgentCommands(), editor = { session: {}, timeline: { scale: 500, change(value) { this.scale = value; return { scale: value }; } }, render() {}, invalidate() {} };
  registerAgentComponentTools(commands, editor);
  const describe = await commands.execute('editor_api', { action: 'describe', target: 'timeline' }, { permission: 'ask' }); assert.ok(describe.result.members.some(member => member.name === 'change'));
  const denied = await commands.execute('editor_api', { action: 'call', target: 'timeline', member: 'change', arguments: [800] }, { permission: 'dangerous', approve: async plan => { assert.equal(plan.access, 'dangerous'); return false; } });
  assert.equal(denied.denied, true); assert.equal(editor.timeline.scale, 500);
  await commands.execute('editor_api', { action: 'call', target: 'timeline', member: 'change', arguments: [800] }, { permission: 'full' }); assert.equal(editor.timeline.scale, 800);
  await commands.execute('editor_api', { action: 'set', target: 'timeline', member: 'scale', value: 250 }, { permission: 'full' }); assert.equal(editor.timeline.scale, 250);
  await assert.rejects(commands.execute('editor_api', { action: 'call', target: 'timeline', member: 'constructor' }, { permission: 'full' }), /不可用/);
  await assert.rejects(commands.execute('editor_api', { action: 'describe', target: 'agent' }, { permission: 'full' }), /不存在/);
});
