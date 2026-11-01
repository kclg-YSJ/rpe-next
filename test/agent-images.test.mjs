import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentCommands } from '../src/core/agent-commands.mjs';
import { AgentProviders, createCompatibleProvider } from '../src/platform/agent-provider.mjs';
import { EditorAgent } from '../src/application/agent.mjs';
import { agentImages, agentUserMessage, agentTurnImages } from '../src/core/agent-images.mjs';
import { trimAgentImages } from '../src/core/agent-context.mjs';
import { AgentConversations, conversationMessages } from '../src/application/agent-conversations.mjs';
import { AgentConversationRepository } from '../src/platform/agent-store.mjs';

const image = index => ({ id: 'image-' + index, name: 'paste-' + index + '.png', url: 'data:image/png;base64,AA==' });
function engine(complete, supported = true) {
  const providers = new AgentProviders(); providers.register({ id: 'fixture', capabilities: () => ({ images: supported, contextWindow: 1048576 }), complete });
  return new EditorAgent({ commands: new AgentCommands(), providers, context: () => ({ session: {}, summary: {} }), config: () => ({ provider: 'fixture', model: 'vision', key: 'test', permission: 'full', maxTokens: 1024 }), prompt: () => 'test' });
}
test('图片输入只接受受限的本地栅格数据，拒绝远程链接、脚本、SVG 和过量图片', () => {
  assert.equal(agentImages([image(1)]).length, 1);
  for (const url of ['https://example.com/private.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AA==', 'data:image/png;base64,<script>']) assert.throws(() => agentImages([{ url }]));
  assert.throws(() => agentImages(Array.from({ length: 5 }, (_, index) => image(index))));
  const user = agentUserMessage('look', [image(1)], 'current'); assert.equal(user.content[0].text, 'look'); assert.equal(user.content[1].image_url.url, image(1).url);
  assert.deepEqual(agentTurnImages({ imageNames: [{ name: 'my.png' }], messages: [user] }), [{ name: 'my.png', url: image(1).url }]);
});
test('多模态请求保留本轮最多四张图，旧截图仍受预算限制，不支持图片时明确失败而不静默发送纯文本', async () => {
  let called = 0, request;
  const agent = engine(async input => { called++; request = input; return { role: 'assistant', content: 'done' }; });
  const session = {}; agent.context = () => ({ session, summary: {} });
  await agent.run('', { images: [image(0), image(1), image(2), image(3)] });
  assert.equal(called, 1); assert.equal(request.messages[0].content.filter(part => part.type === 'image_url').length, 4);
  const last = agentUserMessage('current', [image(0), image(1), image(2), image(3)], 'run');
  const history = [agentUserMessage('old', [image(0)]), last, agentUserMessage('tool shot', [image(0)])];
  trimAgentImages(history, true, 'run'); assert.equal(history[1].content.filter(part => part.type === 'image_url').length, 4);
  const unsupported = engine(() => assert.fail('should not send'), false); unsupported.context = () => ({ session, summary: {} });
  let error; unsupported.addEventListener('error', event => error = event.detail.message); await unsupported.run('look', { images: [image(1)] }); assert.match(error, /不支持图片/);
});
test('图片草稿和历史随对话独立持久化，切换和重发前截断不会丢失图片', async () => {
  const map = new Map(), store = new AgentConversations(), first = store.current;
  first.draftImages = [image(0)]; first.turns = [{ id: 'turn', text: 'look', status: 'completed', imageNames: [{ name: 'paste.png' }], messages: [agentUserMessage('look', [image(1)]), { role: 'assistant', content: 'done' }] }];
  const second = store.create('other'); second.draftImages = [image(2)];
  const repository = new AgentConversationRepository('image-test', { read: async key => structuredClone(map.get(key)), write: async (key, value) => map.set(key, structuredClone(value)) });
  await repository.save(store, { turns: first.turns }); const restored = await repository.load();
  assert.equal(restored.current.draftImages[0].id, 'image-2'); restored.select(first.id); assert.equal(restored.current.draftImages[0].id, 'image-0');
  assert.equal(conversationMessages(restored.current)[0].content[1].image_url.url, image(1).url);
  const images = agentTurnImages(restored.current.turns[0]); restored.truncate(first.id, 0); assert.equal(images[0].name, 'paste.png'); assert.equal(images[0].url, image(1).url);
});
test('兼容提供商请求携带 image_url 内容，内部附件标记不进入 API 请求体', async () => {
  let body;
  const provider = createCompatibleProvider({ id: 'fixture', name: 'Test', model: 'vision', baseUrl: 'https://example.com/v1', reasoningFormat: 'none' }, async (url, options) => {
    body = JSON.parse(options.body);
    return new Response('data: '+JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })+'\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await provider.complete({ config: { key: 'test', model: 'vision', maxTokens: 100 }, system: '', tools: [], messages: [agentUserMessage('look', [image(1)], 'private')] });
  assert.equal(body.messages[1].content[1].image_url.url, image(1).url); assert.equal(body.messages[1].rpen_input_images, undefined);
});

test('运行过程中图片可随插话进入当前任务，取消旧请求后下一次请求保留图像', async () => {
  let started, request, calls = 0; const waiting = new Promise(resolve => started = resolve);
  const agent = engine(async input => {
    calls++;
    if (calls === 1) { started(); return new Promise((resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Interrupted', 'AbortError')), { once: true })); }
    request = input; return { role: 'assistant', content: 'done' };
  });
  const session = {}; agent.context = () => ({ session, summary: {} });
  const running = agent.run('start'); await waiting; assert.equal(agent.steer('see this', [image(1)]), true); await running;
  assert.equal(calls, 2); assert.equal(request.messages.findLast(message => message.role === 'user').content[1].type, 'image_url');
  assert.equal(agent.turnMessages.filter(message => message.role === 'user').length, 2);
});
