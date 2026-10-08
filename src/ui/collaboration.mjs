import { CollaborationTransport } from '../platform/collaboration-transport.mjs';
import { CollaborationClient } from '../application/collaboration-client.mjs';
import { parseInvitation, COLLAB_ID } from '../core/collaboration.mjs';
import { eventListAt } from '../application/event-commands.mjs';
import { isTypingText } from './keyboard.mjs';
import { download } from '../platform/files.mjs';

const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
const button = (text, run) => { const element = node('button', text); element.type = 'button'; element.onclick = run; return element; };
const input = (host, text, type = 'text', value = '') => { const label = node('label', text, 'field'); const field = node('input'); field.type = type; field.value = value; field.setAttribute('aria-label', text); label.append(field); host.append(label); return field; };
const safeColor = color => /^#[0-9a-f]{6}$/i.test(color) ? color : '#fff';
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const hash = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

export class CollaborationPanel {
  constructor(host, context, { receiveChart, receiveAsset, notify, activate, confirmJoin }) {
    this.host = host; this.context = context; this.receiveAsset = receiveAsset; this.notify = notify; this.activate = activate; this.confirmJoin = confirmJoin;
    this.transfers = new Map(); this.transport = new CollaborationTransport();
    this.client = new CollaborationClient(this.transport, { session: () => context().session, receiveChart, notify, interactionBusy: () => Boolean(context().timeline.drag || context().timeline.eventInteraction.drag || context().interactionBusy) });
    this.client.addEventListener('change', () => this.renderState());
    this.client.addEventListener('asset', event => this.asset(event.detail).catch(error => notify(error.message, 'warning')));
    this.createForm(); this.createChat();
    this.cursors = node('div', '', 'collaboration-cursors'); document.body.append(this.cursors);
    this.markers = node('div', '', 'collaboration-markers'); this.markers.setAttribute('aria-label', '协作者时间位置'); document.querySelector('.scrubber-wrap').append(this.markers);
    this.banner = node('div', '', 'collaboration-banner'); document.querySelector('.stage').append(this.banner); this.banner.hidden = true;
    for (const [area, canvas] of [['notes', context().timeline.notesCanvas], ['events', context().timeline.eventsCanvas]]) {
      canvas.addEventListener('pointermove', event => this.pointer(event, canvas, area));
      canvas.addEventListener('pointerleave', () => { this.cursor = null; });
      canvas.addEventListener('pointerdown', event => {
        if (!this.client.active) return;
        const timeline = context().timeline; const point = timeline.point(event, canvas);
        const hit = area === 'notes' ? timeline.hit(point) : timeline.eventInteraction.hit(point);
        const item = area === 'notes' ? hit?.item : hit && eventListAt(context().session, hit.lineIndex ?? context().session.lineIndex, hit.type, timeline.layer)?.[hit.index];
        const owner = item && this.client.locks.get(item[COLLAB_ID]);
        if (owner && owner !== this.client.id || !this.client.ready) {
          event.preventDefault(); event.stopImmediatePropagation(); notify(owner ? '该物件正由其他人编辑' : '连接未就绪，编辑暂停', 'warning');
        }
      }, true);
    }
    const preview = document.querySelector('#preview');
    preview.addEventListener('pointermove', event => { const bounds = preview.getBoundingClientRect(); this.cursor = { area: 'preview', x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, line: context().session.lineIndex }; });
    preview.addEventListener('pointerleave', () => { this.cursor = null; });
    this.timer = setInterval(() => this.tick(), 100);
    window.addEventListener('beforeunload', event => { if (this.client.queue.length) { event.preventDefault(); event.returnValue = ''; } });
    const fragment = location.hash.startsWith('#collab=') ? location.href : null;
    if (fragment) { this.invitation.value = fragment; history.replaceState(null, '', location.pathname + location.search); }
  }
  createForm() {
    const title = node('h3', '联机协作'); this.host.append(title);
    const intro = node('p', '创建房间后复制邀请；伙伴粘贴邀请并等待房主批准。编辑自动同步，各自播放位置独立。', 'hint'); this.host.append(intro);
    this.name = input(this.host, '昵称', 'text', localStorage.getItem('rpe-collab-name') ?? '制谱者'); this.name.maxLength = 32;
    this.color = input(this.host, '我的远端鼠标颜色', 'color', localStorage.getItem('rpe-collab-color') ?? '#64dba5');
    this.server = input(this.host, '服务器地址', 'url', localStorage.getItem('rpe-collab-server') ?? 'ws://127.0.0.1:4182/collab');
    this.server.placeholder = '由维护者提供，通常为 wss://域名/collab';
    this.creationKey = input(this.host, '创建房间密钥（可选）', 'password');
    this.invitation = input(this.host, '粘贴邀请链接');
    this.acceptAssets = input(this.host, '接收房主发送的音乐和图片', 'checkbox'); this.acceptAssets.checked = false;
    const actions = node('div', '', 'collaboration-actions');
    this.create = button('创建房间', () => this.connect());
    this.join = button('加入邀请', () => this.confirmJoin(() => this.connect(true)));
    this.copy = button('复制邀请', async () => {
      try {
        const payload = encodeURIComponent(JSON.stringify({ server: this.client.server, room: this.client.room, token: this.client.token }));
        const invitation = `rpenext:${payload}`;
        await navigator.clipboard.writeText(invitation); this.invitation.value = invitation; this.notify('邀请已复制，房主批准后才能加入', 'success');
      } catch (error) { this.notify(error.message, 'warning'); }
    });
    this.leave = button('离开房间', () => this.client.leave());
    this.share = button('发送本谱面引用的音乐和图片', () => this.shareAssets());
    this.recovery = button('导出冲突前本地副本', () => { if (this.client.recoveryChart) download(new Blob([JSON.stringify(this.client.recoveryChart)], { type: 'application/json' }), 'collaboration-recovery.json'); });
    actions.append(this.create, this.join, this.copy, this.leave, this.share, this.recovery); this.host.append(actions);
    this.status = node('p', '', 'hint'); this.status.setAttribute('role', 'status'); this.host.append(this.status);
    this.requests = node('div'); this.host.append(this.requests);
    this.users = node('div', '', 'collaboration-users'); this.host.append(this.users);
    this.host.append(node('p', '传输：编辑操作经服务器可靠确认；鼠标优先 P2P，失败自动回退。昵称/颜色只保存在本机；邀请和密钥不写入设置。房间保留在服务器内存中，请正常保存或导出谱面。', 'hint'));
    this.renderState();
  }
  connect(joining = false) {
    try {
      const invitation = joining ? parseInvitation(this.invitation.value) : null;
      const url = new URL(invitation?.server ?? this.server.value.trim());
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error('请使用有效的 ws:// 或 wss:// 服务器地址');
      if (location.protocol === 'https:' && url.protocol !== 'wss:') throw new Error('在线 HTTPS 编辑器须使用 wss:// 公网入口');
      localStorage.setItem('rpe-collab-name', this.name.value); localStorage.setItem('rpe-collab-color', this.color.value); localStorage.setItem('rpe-collab-server', url.href);
      this.client.connect(url.href, { name: this.name.value, color: this.color.value }, invitation, this.creationKey.value); this.creationKey.value = '';
    } catch (error) { this.notify(error.message, 'error'); }
  }
  renderState() {
    if (!this.status) return;
    const client = this.client; const active = Boolean(client.active); const host = client.id === client.host;
    this.create.disabled = active; this.join.disabled = active; this.name.disabled = active; this.color.disabled = active; this.server.disabled = active;
    this.copy.disabled = !client.ready; this.leave.disabled = !active; this.share.hidden = !active || !host; this.share.disabled = this.sharing || !client.ready;
    this.recovery.hidden = !client.recoveryChart;
    const direct = [...this.transport.peers.values()].filter(peer => peer.channel?.readyState === 'open').length;
    this.status.textContent = `${client.state}${active ? ` · ${client.latency ?? 0} ms · ${client.queue.length} 项待确认 · ${direct} 位鼠标直连` : ''}`;
    this.requests.replaceChildren();
    if (host) for (const request of client.requests) {
      const row = node('div', '', 'collaboration-user'); row.append(node('span', `${request.profile.name} 请求加入`), button('允许', () => client.approve(request.request, true)), button('拒绝', () => client.approve(request.request, false))); this.requests.append(row);
    }
    const signature = JSON.stringify(client.members.map(member => [member.id, member.online, member.stats, Math.round((member.id === client.id ? client.latency ?? 0 : member.presence?.latency ?? 0) / 10)]));
    if (signature !== this.userSignature) {
      this.userSignature = signature; this.users.replaceChildren();
      for (const member of client.members) {
        const row = node('div', '', 'collaboration-user'); const name = node('strong', `${member.name}${member.host ? ' · 房主' : ''}${member.id === client.id ? '（我）' : ''}`); name.style.color = safeColor(member.color);
        row.append(name, node('span', `${member.online ? '在线' : '离线'} · ${Math.round(member.id === client.id ? client.latency ?? 0 : member.presence?.latency ?? 0)} ms`), node('small', `本次操作涉及：音符 ${member.stats.notes} · 事件 ${member.stats.events} · 提交 ${member.stats.operations}`));
        if (host && member.id !== client.id) row.append(button('移出', () => this.transport.send({ type: 'kick', id: member.id })));
        this.users.append(row);
      }
    }
    if (this.chatLog) this.renderChat();
  }
  createChat() {
    this.chatBox = node('div', '', 'collaboration-chat'); this.chatBox.hidden = true;
    this.chatLog = node('div', '', 'collaboration-chat-log'); this.chatLog.setAttribute('role', 'log');
    this.chatInput = node('input'); this.chatInput.maxLength = 1000; this.chatInput.placeholder = 'Enter 发送 · Esc 关闭'; this.chatInput.setAttribute('aria-label', '联机聊天');
    this.chatBox.append(this.chatLog, this.chatInput); document.body.append(this.chatBox);
    window.addEventListener('keydown', event => {
      if (!this.client.active) return;
      if (event.target === this.chatInput) {
        event.stopImmediatePropagation();
        if (event.key === 'Escape') { event.preventDefault(); this.chatBox.hidden = true; this.chatInput.blur(); }
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault(); if (this.chatInput.value.trim()) { try { this.transport.send({ type: 'chat', text: this.chatInput.value }); this.chatInput.value = ''; } catch (error) { this.notify(error.message, 'warning'); } }
        }
      } else if (event.key === '/' && !isTypingText(event.target) && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault(); event.stopImmediatePropagation(); this.chatBox.hidden = false; this.chatInput.focus(); this.chatLog.scrollTop = this.chatLog.scrollHeight;
      }
    }, true);
    this.toast = node('div', '', 'collaboration-chat-toast'); document.body.append(this.toast);
  }
  renderChat() {
    const signature = JSON.stringify(this.client.chat); if (signature === this.chatSignature) return;
    this.chatSignature = signature; this.chatLog.replaceChildren();
    for (const item of this.client.chat) { const row = node('div'); const name = node('strong', `${item.name}：`); name.style.color = safeColor(item.color); row.append(name, node('span', item.text)); this.chatLog.append(row); }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    const last = this.client.chat.at(-1); if (last) { this.toast.textContent = `${last.name}：${last.text}`; this.toast.hidden = false; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, 6000); }
  }
  pointer(event, canvas, area) {
    const { session, timeline } = this.context(); const point = timeline.point(event, canvas); const line = timeline.lineIndexAt(point.x, canvas.clientWidth, area); const factor = timeline.factorForLine(line);
    const seconds = timeline.tempo.seconds(timeline.origin, factor) + (canvas.clientHeight - timeline.judgementOffset - point.y) / timeline.scale;
    const local = point.x - timeline.panelHorizontal(0, line, canvas.clientWidth, area);
    this.cursor = { area, line, beat: timeline.tempo.beat(seconds, factor), x: area === 'notes' ? timeline.notePositionAt(point.x, line) : local / timeline.panelWidth(canvas.clientWidth, area), layer: timeline.layer };
  }
  tick() {
    const { session, timeline, seconds, duration, seek } = this.context(); const client = this.client;
    client.finishInteraction();
    if (client.active && client.ready) {
      try {
        client.flush();
        this.transport.presence({ type: 'presence', seconds, line: session.lineIndex, cursor: this.cursor, latency: client.latency ?? 0 });
        if (!this.heartbeat || Date.now() - this.heartbeat > 3000) { this.transport.send({ type: 'ping', time: Date.now() }); this.transport.send({ type: 'locks', ids: client.selectionIds() }); this.heartbeat = Date.now(); }
        const locks = JSON.stringify(client.selectionIds()); if (locks !== this.lastLocks) { this.lastLocks = locks; this.transport.send({ type: 'locks', ids: JSON.parse(locks) }); }
      } catch {}
    }
    this.cursors.replaceChildren();
    const visibleMembers = client.members.filter(member => member.id !== client.id && member.online && member.presence);
    for (const marker of this.markers.children) if (!visibleMembers.some(member => member.id === marker.dataset.member)) marker.remove();
    const selectedOwner = client.selectionIds().map(id => client.locks.get(id)).find(owner => owner && owner !== client.id);
    this.banner.hidden = !client.active || client.ready && !selectedOwner;
    this.banner.textContent = selectedOwner ? `由 ${client.members.find(member => member.id === selectedOwner)?.name ?? '他人'} 编辑中 · 只读查看` : '联机编辑暂停 · 等待连接或房主恢复';
    const markerRows = [];
    for (const member of visibleMembers) {
      const presence = member.presence; const label = `${member.name} 线:${presence.line}`;
      const position = Math.max(0, Math.min(1, (presence.seconds + this.context().offset) / Math.max(1, duration))) * this.markers.clientWidth;
      let row = markerRows.findIndex(end => position - 65 > end); if (row < 0) row = markerRows.length; markerRows[row] = position + 65;
      let marker = [...this.markers.children].find(marker => marker.dataset.member === member.id);
      if (!marker) { marker = button(label, () => { const current = client.members.find(entry => entry.id === member.id)?.presence; if (current) seek(current.seconds); }); marker.dataset.member = member.id; this.markers.append(marker); }
      marker.textContent = label; marker.style.left = `${position}px`; marker.style.top = `${-row * 17}px`; marker.style.color = safeColor(member.color); marker.title = `${label} · ${presence.seconds.toFixed(2)} s`;
      const cursor = presence.cursor; if (!cursor || !Number.isFinite(cursor.x)) continue;
      if (cursor.area === 'preview' && Number.isFinite(cursor.y)) {
        const preview = document.querySelector('.preview-wrap').hidden ? document.querySelector('#realtime-preview') : document.querySelector('#preview');
        const bounds = preview.getBoundingClientRect(); const pointer = node('div', `➤ ${label}`, 'collaboration-pointer'); pointer.style.color = safeColor(member.color);
        pointer.style.opacity = Math.abs(presence.seconds - seconds) < 1 ? '1' : '.35';
        pointer.style.left = `${bounds.left + Math.max(0, Math.min(1, cursor.x)) * bounds.width}px`; pointer.style.top = `${bounds.top + Math.max(0, Math.min(1, cursor.y)) * bounds.height}px`; this.cursors.append(pointer); continue;
      }
      if (!Number.isFinite(cursor.beat)) continue;
      const canvas = cursor.area === 'events' ? timeline.eventsCanvas : timeline.notesCanvas;
      const rectangle = canvas.getBoundingClientRect(); if (!rectangle.width || !rectangle.height) continue;
      const lineVisible = session.multiLineActive ? session.multiLineIndices.includes(cursor.line) && session.multiLineMode === cursor.area : cursor.line === session.lineIndex;
      const mappedLine = lineVisible ? cursor.line : session.lineIndex;
      const horizontal = cursor.area === 'notes' ? timeline.noteHorizontal(cursor.x, mappedLine) : timeline.panelHorizontal(cursor.x * timeline.panelWidth(rectangle.width, 'events'), mappedLine, rectangle.width, 'events');
      const vertical = timeline.verticalForLine(cursor.beat, cursor.line, rectangle.height);
      const ownRange = [timeline.timeAt(rectangle.height), timeline.timeAt(0)];
      const timeVisible = presence.seconds >= Math.min(...ownRange) && presence.seconds <= Math.max(...ownRange);
      const inView = timeVisible && lineVisible && vertical >= 0 && vertical <= rectangle.height && horizontal >= 0 && horizontal <= rectangle.width;
      const pointer = node('div', `➤ ${label}`, 'collaboration-pointer'); pointer.style.color = safeColor(member.color); pointer.style.opacity = inView ? '1' : '.35';
      pointer.style.left = `${rectangle.left + Math.max(2, Math.min(rectangle.width - 40, horizontal))}px`; pointer.style.top = `${rectangle.top + Math.max(2, Math.min(rectangle.height - 20, vertical))}px`; this.cursors.append(pointer);
    }
    if (!client.active) { this.chatBox.hidden = true; this.toast.hidden = true; }
  }
  async shareAssets() {
    this.sharing = true; this.renderState();
    try {
      const { sharedAssets } = this.context(); let count = 0;
      for (const [name, bytes] of sharedAssets()) {
        if (!/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(name) || bytes.length > 128 * 1024 * 1024) continue;
        const digest = await hash(bytes); const total = Math.ceil(bytes.length / 49152);
        for (let index = 0; index < total; index++) {
          if (!this.client.ready) throw new Error('连接中断，素材传输已停止');
          const data = btoa(String.fromCharCode(...bytes.subarray(index * 49152, (index + 1) * 49152)));
          this.transport.send({ type: 'asset', name, hash: digest, index, total, data }); await new Promise(resolve => setTimeout(resolve, 40));
        }
        count++;
      }
      this.notify(`已发送 ${count} 个引用素材；接收者需勾选接收素材`, 'success');
    } catch (error) { this.notify(error.message, 'warning'); }
    finally { this.sharing = false; this.renderState(); }
  }
  async asset(message) {
    if (!this.acceptAssets.checked || message.from !== this.client.host) return;
    if (this.transfers.size > 8) this.transfers.clear();
    let transfer = this.transfers.get(message.hash);
    if (!transfer) { transfer = { chunks: new Map(), size: 0, name: message.name, total: message.total }; this.transfers.set(message.hash, transfer); }
    if (transfer.total !== message.total || transfer.name !== message.name || transfer.chunks.has(message.index)) return;
    const bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0)); transfer.chunks.set(message.index, bytes); transfer.size += bytes.length;
    if (transfer.size > 128 * 1024 * 1024) { this.transfers.delete(message.hash); throw new Error('接收素材超过 128 MiB，已停止'); }
    if (transfer.chunks.size !== transfer.total) return;
    const result = new Uint8Array(transfer.size); let offset = 0;
    for (let index = 0; index < transfer.total; index++) { const chunk = transfer.chunks.get(index); result.set(chunk, offset); offset += chunk.length; }
    this.transfers.delete(message.hash); if (await hash(result) !== message.hash) throw new Error('素材校验失败，请重新发送');
    await this.receiveAsset(message.name, result); this.notify(`已接收素材：${message.name}`, 'success');
  }
}
