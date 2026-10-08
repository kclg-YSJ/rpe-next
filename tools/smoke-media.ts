import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
// The collaboration server is a standalone package written in plain JavaScript, so it ships no
// declarations. The one entry point this tool drives is described structurally here rather than
// typing the whole module; `collaboration-server/server.d.ts` supplies the declaration itself.
import { startCollaborationServer } from '../collaboration-server/server.mjs';

/**
 * The one Electron surface this smoke test drives. Declared structurally so the tool does not have
 * to depend on Electron's own type package, which is not installed for the test suite.
 */
export interface SmokeWebContents {
  executeJavaScript(code: string): Promise<unknown>;
}

export async function smokeMediaTransfer(webContents: SmokeWebContents): Promise<Record<string, unknown>> {
  const service = await startCollaborationServer({ port: 0 }); let downloads = 0;
  const proxy = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.includes('/file/')) downloads++;
    const upstream = httpRequest({ hostname: '127.0.0.1', port: service.port, path: request.url, method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode ?? 200, incoming.headers); incoming.pipe(response);
    });
    upstream.on('error', () => response.destroy()); request.pipe(upstream);
  });
  try {
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    // `address()` is typed `string | AddressInfo | null`; this server listens on a TCP port, so the
    // object form is what it returns. Binding it also keeps the value stable inside the template.
    const proxyPort = (proxy.address() as AddressInfo).port;
    const result = await webContents.executeJavaScript(`(async () => {
      const { createChart } = await import('/src/core/chart.ts');
      const { EditorSession } = await import('/src/application/session.ts');
      const { CollaborationClient } = await import('/src/application/collaboration-client.ts');
      const { CollaborationTransport } = await import('/src/platform/collaboration-transport.ts');
      const peers = []; const failures = [];
      const waitFor = async predicate => {
        const started = performance.now();
        while (!predicate()) {
          if (failures.length) throw new Error(failures[0]);
          if (performance.now() - started > 15000) throw new Error('桌面媒体测试超时');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      const createPeer = () => {
        const transport = new CollaborationTransport(); const session = new EditorSession(createChart()); const received = new Map();
        const client = new CollaborationClient(transport, { session: () => session, receiveChart: chart => { session.history.document = chart; }, notify: (message, level) => { if (level === 'error') failures.push(message); } });
        const peer = { transport, client, received }; peers.push(peer);
        transport.addEventListener('message', event => { if (event.detail.type === 'welcome') peer.welcome = event.detail; });
        client.addEventListener('asset-manifest', event => transport.media.receive(event.detail, async (name, bytes) => received.set(name, bytes)).catch(error => failures.push(error.message)));
        return peer;
      };
      try {
        const host = createPeer(); const guest = createPeer(); const address = 'ws://127.0.0.1:${service.port}/collab';
        host.client.connect(address, { name: 'Host' }); await waitFor(() => host.client.ready);
        guest.transport.subscribeAssets(true);
        guest.client.connect(address, { name: 'Guest' }, { room: host.client.room, token: host.client.token });
        await waitFor(() => host.client.requests.length); host.client.approve(host.client.requests[0].request, true); await waitFor(() => guest.client.ready);
        if (guest.welcome.mediaLocal) throw new Error('接收端不应获得房主本机探测配置');
        guest.transport.media.base.port = '${proxyPort}'; guest.transport.media.localRoute = false;
        host.transport.media.configure('wss://smoke.invalid/collab', host.client.room, host.welcome.mediaToken, null, host.welcome.mediaLocal);
        const assets = [['song.ogg', 6386962], ['cover.png', 436409], ['texture.png', 54493]].map(([name, length]) => {
          const bytes = new Uint8Array(length);
          for (let offset = 0; offset < length; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, offset + 65536));
          return [name, bytes];
        });
        const started = performance.now(); await host.transport.media.publish(assets); const uploadedMs = Math.round(performance.now() - started);
        await waitFor(() => guest.received.size === assets.length);
        if (!host.transport.media.localRoute || guest.transport.media.localRoute || failures.length) throw new Error('媒体通道或接收验证失败');
        return { bytes: assets.reduce((sum, [, bytes]) => sum + bytes.length, 0), uploadedMs, receivedMs: Math.round(performance.now() - started), localUploadVerified: true, recipientUsesProxy: true, filesVerified: guest.received.size };
      } finally { for (const peer of peers) peer.client.leave(); }
    })()`);
    if (downloads < 9) throw new Error('接收端未通过代理下载全部素材');
    // The renderer returns a plain object literal, which is what this tool reports back.
    const report: Record<string, unknown> = { ...(result as Record<string, unknown>) };
    report.proxyDownloadRequests = downloads;
    return report;
  } finally {
    proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); await service.close();
  }
}
