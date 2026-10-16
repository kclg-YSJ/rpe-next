import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationConnectSources } from '../src/core/collaboration-policy.ts';

test('默认 HTTP 权限仅允许本机和 Cloudflare 临时隧道的素材接口', () => {
  const sources = collaborationConnectSources().split(' ');
  assert.ok(!sources.includes('http:') && !sources.includes('https:') && !sources.includes('*'));
  assert.ok(sources.includes('https://*.trycloudflare.com/collab/media/'));
  assert.ok(sources.includes('http://127.0.0.1:*/collab/media/'));
});

test('固定服务器白名单仅接收明确源地址，并限制在素材接口路径', () => {
  assert.ok(collaborationConnectSources('https://media.example.com,http://192.168.1.2:4182').includes('http://192.168.1.2:4182/collab/media/'));
  for (const value of ['https://*.example.com', 'https://user:pass@example.com', 'https://example.com/other', 'file:///tmp', 'https://example.com/?token=secret']) assert.throws(() => collaborationConnectSources(value));
});
