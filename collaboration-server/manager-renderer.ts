/** The state the manager's main process broadcasts. */
interface ServerState {
  running: boolean;
  port?: number;
  preferences: { port: number; lan: boolean };
  tunnel: boolean;
  tunnelPath: string;
  publicAddress: string;
  rooms: number;
  users: number;
  message: string;
  localAddresses: string[];
}

/** The bridge `preload.ts` exposes on `window`. */
interface ServerManagerBridge {
  action(action: string, values?: Record<string, unknown>): Promise<ServerState>;
  subscribe(callback: (state: ServerState) => void): void;
}

const bridge = (window as unknown as { serverManager: ServerManagerBridge }).serverManager;

const field = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
function render(state: ServerState): void {
  field<HTMLButtonElement>('start').disabled = state.running; field<HTMLButtonElement>('stop').disabled = !state.running;
  field<HTMLInputElement>('port').disabled = state.running; field<HTMLInputElement>('lan').disabled = state.running; field<HTMLInputElement>('key').disabled = state.running;
  field<HTMLButtonElement>('tunnel').disabled = !state.running || state.tunnel || !state.tunnelPath;
  field('status').textContent = state.message; field('counts').textContent = `${state.rooms} 个房间 · ${state.users} 位在线用户`;
  field('local').textContent = state.running ? `本机：ws://127.0.0.1:${state.port}/collab　${state.localAddresses.join('　')}` : '';
  field<HTMLInputElement>('public').value = state.publicAddress; field('tunnel-path').textContent = state.tunnelPath.split(/[\\/]/).at(-1) ?? '';
}
for (const action of ['start', 'stop', 'choose-tunnel', 'tunnel']) field<HTMLButtonElement>(action).onclick = async () => render(await bridge.action(action, {
  port: field<HTMLInputElement>('port').value, lan: field<HTMLInputElement>('lan').checked, key: field<HTMLInputElement>('key').value, token: field<HTMLInputElement>('token').value,
}));
const download = document.createElement('button'); download.textContent = '打开官方下载页'; download.onclick = () => { void bridge.action('download-tunnel'); }; field('choose-tunnel').before(download);
const diagnostics = document.createElement('button'); diagnostics.textContent = '打开脱敏诊断日志'; diagnostics.onclick = () => { void bridge.action('diagnostics'); }; field('status').before(diagnostics);
field<HTMLButtonElement>('copy').onclick = async () => { const address = field<HTMLInputElement>('public').value; if (address) { await navigator.clipboard.writeText(address); field('status').textContent = '公网地址已复制'; } };
bridge.subscribe(render);
void bridge.action('state').then(state => { field<HTMLInputElement>('port').value = String(state.preferences.port); field<HTMLInputElement>('lan').checked = state.preferences.lan; render(state); });
