import { localPreferences } from '../platform/local-preferences.mjs';
import { CollaborationTransport } from '../platform/collaboration-transport.mjs';
import { sendCollaborationAsset } from '../platform/collaboration-assets.mjs';
import { digestBytes } from '../platform/collaboration-media.mjs';
import { mediaErrorCode } from '../platform/media-diagnostics.mjs';
import { CollaborationClient } from '../application/collaboration-client.mjs';
import { parseInvitation, COLLAB_ID } from '../core/collaboration.mjs';
import { eventListAt } from '../application/event-commands.mjs';
import { isTextEntry, usesNativeTextShortcut } from './keyboard.mjs';
import { download } from '../platform/files.mjs';
import { collaborationMarkerPosition, collaborationLabelBackground } from './collaboration-display.mjs';
import { editorSkinState, editorSkinSignal } from './editor-skin-state.mjs';
import { t } from '../i18n.mjs';

const node = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
const button = (text, run) => { const element = node('button', text); element.type = 'button'; element.onclick = run; return element; };
const input = (host, text, type = 'text', value = '') => { const label = node('label', text, 'field'); const field = node('input'); field.type = type; field.value = value; field.setAttribute('aria-label', text); label.append(field); host.append(label); return field; };
const hash = digestBytes;

export class CollaborationPanel {
  constructor(host, context, { receiveChart, receiveAsset, notify, activate, confirmJoin }) {
    editorSkinState({ collaboration: 'offline' });
    this.host = host; this.context = context; this.receiveAsset = receiveAsset; this.notify = notify; this.activate = activate; this.confirmJoin = confirmJoin;
    this.transfers = new Map(); this.transport = new CollaborationTransport();
    this.client = new CollaborationClient(this.transport, { session: () => context().session, receiveChart, notify, interactionBusy: () => Boolean(context().timeline.drag || context().timeline.eventInteraction.drag || context().interactionBusy) });
    this.client.addEventListener('change', () => {
      const state = this.client.ready ? 'ready' : this.client.active ? 'connecting' : 'offline';
      if (state !== document.documentElement.dataset.rpenCollaboration) editorSkinSignal('collaboration-changed');
      editorSkinState({ collaboration: state }); this.renderState();
    });
    this.client.addEventListener('asset', event => this.asset(event.detail).catch(error => notify(error.message, 'warning')));
    this.client.addEventListener('asset-manifest', event => {
      if (!this.acceptAssets.checked) return;
      this.transport.media.receive(event.detail, receiveAsset).catch(error => { this.assetStatus.textContent = error.message; notify(error.message, 'warning'); });
    });
    this.transport.media.addEventListener('progress', event => this.mediaProgress(event.detail));
    this.createForm(); this.createChat();
    this.cursors = node('div', '', 'collaboration-cursors'); document.body.append(this.cursors);
    this.markers = node('div', '', 'collaboration-markers'); this.markers.setAttribute('aria-label', t('collaboration.s28c8b58')); document.querySelector('.scrubber-wrap').append(this.markers);
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
          event.preventDefault(); event.stopImmediatePropagation(); notify(owner ? t('collaboration.s16f918a') : t('collaboration.sd340f13'), 'warning');
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
    const title = node('h3', t('collaboration.se55c4de')); this.host.append(title);
    const intro = node('p', t('collaboration.s2966cdd'), 'hint'); this.host.append(intro);
    this.name = input(this.host, t('collaboration.s25124ed'), 'text', localPreferences.getItem('rpe-collab-name') ?? t('collaboration.s9d3c09a')); this.name.maxLength = 32;
    this.color = input(this.host, t('collaboration.s68c5010'), 'color', localPreferences.getItem('rpe-collab-color') ?? '#64dba5');
    this.server = input(this.host, t('collaboration.s2eb291f'), 'url', localPreferences.getItem('rpe-collab-server') ?? 'ws://127.0.0.1:4182/collab');
    this.server.placeholder = t('collaboration.s2d25e9f');
    this.creationKey = input(this.host, t('collaboration.s25a791c'), 'password');
    this.invitation = input(this.host, t('collaboration.s3549f91'));
    this.acceptAssets = input(this.host, t('collaboration.s45f3d47'), 'checkbox'); this.acceptAssets.checked = false;
    this.transport.subscribeAssets(false);
    this.acceptAssets.onchange = () => this.transport.subscribeAssets(this.acceptAssets.checked);
    this.host.append(node('p', t('collaboration.s7bcd4eb'), 'hint'));
    const actions = node('div', '', 'collaboration-actions');
    this.create = button(t('collaboration.s1688ee1'), () => this.connect());
    this.join = button(t('collaboration.s8ea651e'), () => this.confirmJoin(() => this.connect(true)));
    this.copy = button(t('collaboration.sf729372'), async () => {
      try {
        const payload = encodeURIComponent(JSON.stringify({ server: this.client.server, room: this.client.room, token: this.client.token }));
        const invitation = `rpenext:${payload}`;
        await navigator.clipboard.writeText(invitation); this.invitation.value = invitation; this.notify(t('collaboration.sf55ea1c'), 'success');
      } catch (error) { this.notify(error.message, 'warning'); }
    });
    this.leave = button(t('collaboration.s8e1df6d'), () => this.client.leave());
    this.share = button(t('collaboration.sa500676'), () => this.shareAssets());
    this.recovery = button(t('collaboration.s7f8282e'), () => { if (this.client.recoveryChart) download(new Blob([JSON.stringify(this.client.recoveryChart)], { type: 'application/json' }), 'collaboration-recovery.json'); });
    this.diagnostics = button(t('collaboration.s845467e'), () => download(new Blob([JSON.stringify({ format: 2, diagnosticBuild: 'media-local-route-v3', framed: true, mediaHttp: this.transport.mediaHttp === true, activeMedia: this.transport.media.diagnostics.snapshot(), entries: this.transport.diagnostics }, null, 2)], { type: 'text/plain' }), 'rpe-collaboration-diagnostics.log'));
    actions.append(this.create, this.join, this.copy, this.leave, this.share, this.recovery, this.diagnostics); this.host.append(actions);
    this.host.append(node('p', t('collaboration.s0fd2c08'), 'hint'));
    this.status = node('p', '', 'hint'); this.status.setAttribute('role', 'status'); this.host.append(this.status);
    this.assetStatus = node('p', '', 'hint'); this.assetStatus.setAttribute('role', 'status'); this.host.append(this.assetStatus);
    this.requests = node('div'); this.host.append(this.requests);
    this.users = node('div', '', 'collaboration-users'); this.host.append(this.users);
    this.host.append(node('p', t('collaboration.see8ebec'), 'hint'));
    this.renderState();
  }
  connect(joining = false) {
    try {
      const invitation = joining ? parseInvitation(this.invitation.value) : null;
      const url = new URL(invitation?.server ?? this.server.value.trim());
      if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error(t('collaboration.sde8b807'));
      if (location.protocol === 'https:' && url.protocol !== 'wss:') throw new Error(t('collaboration.s1c13ed1'));
      localPreferences.setItem('rpe-collab-name', this.name.value); localPreferences.setItem('rpe-collab-color', this.color.value); localPreferences.setItem('rpe-collab-server', url.href);
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
    this.status.textContent = t('collaboration.sf720e94', { p0: client.state, p1: active ? t('collaboration.s28865e2', { p0: client.latency ?? 0, p1: client.queue.length, p2: direct }) : '', p2: client.ready ? this.transport.mediaHttp ? t('collaboration.s0192379') : t('collaboration.sa04a1ee') : '' });
    const requestSignature = JSON.stringify([host, client.requests]);
    if (requestSignature !== this.requestSignature) {
      this.requestSignature = requestSignature; this.requests.replaceChildren();
      if (host) for (const request of client.requests) {
        const row = node('div', '', 'collaboration-user'); row.append(node('span', t('collaboration.s3fd4176', { p0: request.profile.name })), button(t('collaboration.s4c0c0ae'), () => client.approve(request.request, true)), button(t('collaboration.s03e210a'), () => client.approve(request.request, false))); this.requests.append(row);
      }
    }
    const signature = JSON.stringify(client.members.map(member => [member.id, member.online, member.stats, Math.round((member.id === client.id ? client.latency ?? 0 : member.presence?.latency ?? 0) / 10)]));
    if (signature !== this.userSignature) {
      this.userSignature = signature; this.users.replaceChildren();
      for (const member of client.members) {
        const row = node('div', '', 'collaboration-user'); const name = node('strong', t('collaboration.s2698673', { p0: member.name, p1: member.host ? t('collaboration.sa231459') : '', p2: member.id === client.id ? t('collaboration.s0820a2a') : '' })); name.style.color = member.color;
        row.append(name, node('span', t('collaboration.s300c7a2', { p0: member.online ? t('collaboration.s0373ff9') : t('collaboration.s211357d'), p1: Math.round(member.id === client.id ? client.latency ?? 0 : member.presence?.latency ?? 0) })), node('small', t('collaboration.s32e2dfa', { p0: member.stats.notes, p1: member.stats.events, p2: member.stats.operations })));
        if (host && member.id !== client.id) row.append(button(t('collaboration.s0d01c5a'), () => this.transport.send({ type: 'kick', id: member.id })));
        this.users.append(row);
      }
    }
    if (this.chatLog) this.renderChat();
  }
  createChat() {
    this.chatBox = node('div', '', 'collaboration-chat'); this.chatBox.hidden = true;
    this.chatLog = node('div', '', 'collaboration-chat-log'); this.chatLog.setAttribute('role', 'log');
    this.chatInput = node('input'); this.chatInput.maxLength = 1000; this.chatInput.placeholder = t('collaboration.s428e4b0'); this.chatInput.setAttribute('aria-label', t('collaboration.sae0c322'));
    this.chatBox.append(this.chatLog, this.chatInput); document.body.append(this.chatBox);
    window.addEventListener('keydown', event => this.handleChatKey(event), true);
    this.toast = node('div', '', 'collaboration-chat-toast'); this.toast.hidden = true; this.toast.setAttribute('role', 'log'); document.body.append(this.toast);
  }
  openChat() {
    this.chatBox.hidden = false; this.chatInput.focus(); this.chatLog.scrollTop = this.chatLog.scrollHeight;
    this.updateChatVisibility();
  }
  closeChat() {
    this.chatBox.hidden = true; this.chatInput.blur(); this.updateChatVisibility();
  }
  updateChatVisibility() {
    if (!this.toast) return;
    const visible = this.client.active && this.chatBox.hidden;
    this.toast.hidden = !visible;
    for (const message of this.toast.children) {
      clearTimeout(message.fadeTimer); clearTimeout(message.removeTimer);
      message.classList.remove('leaving');
      if (visible) message.fadeTimer = setTimeout(() => {
        message.classList.add('leaving');
        message.removeTimer = setTimeout(() => message.remove(), 1000);
      }, 5000);
    }
  }
  handleChatKey(event) {
    if (globalThis.document?.querySelector?.('dialog[open]')) return;
    if (!this.client.active || event.isComposing) return;
    if (event.key === 'Escape' && !this.chatBox.hidden) {
      event.preventDefault(); event.stopImmediatePropagation(); this.closeChat(); return;
    }
    if (event.target === this.chatInput) {
      event.stopImmediatePropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        try {
          if (this.chatInput.value.trim()) this.transport.send({ type: 'chat', text: this.chatInput.value });
          this.chatInput.value = ''; this.closeChat();
        } catch (error) { this.notify(error.message, 'warning'); }
      }
    } else if (event.key === '/' && !isTextEntry(event.target) && !usesNativeTextShortcut(event) && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation(); this.openChat();
    }
  }
  renderChat() {
    const signature = JSON.stringify(this.client.chat); if (signature === this.chatSignature) return;
    this.chatSignature = signature; this.chatLog.replaceChildren();
    for (const item of this.client.chat) { const row = node('div'); const name = node('strong', `${item.name}：`); name.style.color = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#fff'; row.append(name, node('span', item.text)); this.chatLog.append(row); }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    const last = this.client.chat.at(-1);
    if (!last) {
      for (const message of this.toast.children) { clearTimeout(message.fadeTimer); clearTimeout(message.removeTimer); }
      this.toast.replaceChildren(); this.toast.hidden = true; return;
    }
    const message = node('div', `${last.name}：${last.text}`, 'collaboration-chat-message'); this.toast.append(message);
    while (this.toast.children.length > 5) {
      const oldest = this.toast.firstElementChild; clearTimeout(oldest.fadeTimer); clearTimeout(oldest.removeTimer); oldest.remove();
    }
    this.toast.hidden = !this.client.active || !this.chatBox.hidden;
    if (!this.toast.hidden) message.fadeTimer = setTimeout(() => {
      message.classList.add('leaving'); message.removeTimer = setTimeout(() => message.remove(), 1000);
    }, 5000);
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
    const visibleMembers = client.members.filter(member => member.id !== client.id && member.online && member.presence).sort((left, right) => left.presence.seconds - right.presence.seconds);
    for (const marker of this.markers.children) if (!visibleMembers.some(member => member.id === marker.dataset.member)) marker.remove();
    const selectedOwner = client.selectionIds().map(id => client.locks.get(id)).find(owner => owner && owner !== client.id);
    this.banner.hidden = !client.active || client.ready && !selectedOwner;
    this.banner.textContent = selectedOwner ? t('collaboration.s669d40d', { p0: client.members.find(member => member.id === selectedOwner)?.name ?? t('collaboration.s24fb8a8') }) : t('collaboration.s4742276');
    const markerRows = [];
    const scrubber = document.querySelector('#scrubber'); const track = scrubber.getBoundingClientRect(); const markerBounds = this.markers.getBoundingClientRect();
    for (const member of visibleMembers) {
      const presence = member.presence; const label = t('collaboration.s255ad81', { p0: member.name, p1: presence.line });
      const position = track.left - markerBounds.left + collaborationMarkerPosition(presence.seconds, { offset: this.context().offset, minimum: scrubber.min || 0, maximum: scrubber.max || duration, width: track.width });
      let row = markerRows.findIndex(end => position - 65 > end); if (row < 0) row = markerRows.length; markerRows[row] = position + 65;
      let marker = [...this.markers.children].find(marker => marker.dataset.member === member.id);
      if (!marker) { marker = button(label, () => { const current = client.members.find(entry => entry.id === member.id)?.presence; if (current) seek(current.seconds); }); marker.dataset.member = member.id; this.markers.append(marker); }
      marker.textContent = label; marker.style.left = `${position}px`; marker.style.top = `${-row * 17}px`; marker.style.color = member.color; marker.style.backgroundColor = collaborationLabelBackground(member.color); marker.title = `${label} · ${presence.seconds.toFixed(2)} s`;
      const cursor = presence.cursor; if (!cursor || !Number.isFinite(cursor.x)) continue;
      if (cursor.area === 'preview' && Number.isFinite(cursor.y)) {
        const preview = document.querySelector('.preview-wrap').hidden ? document.querySelector('#realtime-preview') : document.querySelector('#preview');
        const bounds = preview.getBoundingClientRect(); const pointer = node('div', `➤ ${label}`, 'collaboration-pointer'); pointer.style.color = member.color;
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
      const pointer = node('div', `➤ ${label}`, 'collaboration-pointer'); pointer.style.color = member.color; pointer.style.opacity = inView ? '1' : '.35';
      pointer.style.left = `${rectangle.left + Math.max(2, Math.min(rectangle.width - 40, horizontal))}px`; pointer.style.top = `${rectangle.top + Math.max(2, Math.min(rectangle.height - 20, vertical))}px`; this.cursors.append(pointer);
    }
    if (!client.active) { this.chatBox.hidden = true; this.toast.hidden = true; }
  }
  async shareAssets() {
    if (this.sharing) return;
    this.sharing = true; this.renderState();
    this.transport.trace?.('media-share-click', { channel: this.transport.mediaHttp ? 'http' : 'websocket' });
    try {
      const { sharedAssets } = this.context(); let count = 0;
      if (this.transport.mediaHttp) {
        const files = sharedAssets().filter(([name, bytes]) => /\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(name) && bytes.length > 0 && bytes.length <= 128 * 1024 * 1024);
        await this.transport.media.publish(files);
        this.notify(t('collaboration.s4547a3e'), 'success'); return;
      }
      for (const [name, bytes] of sharedAssets()) {
        if (!/\.(png|jpe?g|webp|gif|ogg|mp3|wav|flac|m4a)$/i.test(name) || bytes.length > 128 * 1024 * 1024) continue;
        this.assetStatus.textContent = t('collaboration.sce43ded', { p0: name });
        const digest = await this.transport.media.hash(bytes, undefined, { direction: 'upload', fileIndex: count, kind: /\.(png|jpe?g|webp|gif)$/i.test(name) ? 'image' : 'audio' }); const started = performance.now();
        this.assetStatus.textContent = t('collaboration.s47e18a2', { p0: name });
        const delivered = this.transport.media.diagnostics.start('legacy-delivery', { fileIndex: count, bytes: bytes.length });
        try { await sendCollaborationAsset(this.transport, name, bytes, digest, (sent, total) => {
          const speed = sent / Math.max(0.1, (performance.now() - started) / 1000) / 1048576;
          this.assetStatus.textContent = t('collaboration.sca15567', { p0: name, p1: Math.floor(sent / total * 100), p2: speed.toFixed(2) });
        }); delivered(); } catch (error) { delivered('failed', { error: mediaErrorCode(error) }); throw error; }
        count++;
      }
      this.assetStatus.textContent = t('collaboration.sb559c8c', { p0: count });
      this.notify(this.assetStatus.textContent, 'success');
    } catch (error) { this.transport.trace?.('media-share-failed', { error: mediaErrorCode(error) }); this.assetStatus.textContent = error.message; this.notify(error.message, 'warning'); }
    finally { this.sharing = false; this.renderState(); }
  }
  mediaProgress(progress) {
    if (!this.assetStatus) return;
    if (progress.phase === 'hash') this.assetStatus.textContent = t('collaboration.s1066a16', { p0: progress.name });
    else if (progress.phase === 'prepare') this.assetStatus.textContent = t('collaboration.s1130683');
    else if (progress.phase === 'upload-fallback') this.assetStatus.textContent = t('collaboration.s2432e5e');
    else if (progress.phase === 'upload-transfer') this.assetStatus.textContent = t('collaboration.sf201469', { p0: Math.floor(progress.sent / progress.total * 100) });
    else if (progress.phase === 'upload' && !progress.bytes) this.assetStatus.textContent = progress.total ? t('collaboration.s558732c') : t('collaboration.sb3715ce');
    else if (progress.phase === 'commit') this.assetStatus.textContent = t('collaboration.se84bc77');
    else if (progress.phase === 'verify') this.assetStatus.textContent = t('collaboration.s882ed5f', { p0: progress.name });
    else if (progress.phase === 'published') this.assetStatus.textContent = t('collaboration.sfa8f4ce', { p0: progress.count, p1: progress.skippedBytes ? t('collaboration.s9e303d3') : '' });
    else if (progress.phase === 'received') this.assetStatus.textContent = t('collaboration.s7617e24', { p0: progress.count });
    else {
      const speed = progress.bytes / Math.max(0.1, progress.seconds) / 1048576;
      this.assetStatus.textContent = t('collaboration.s2ba55e0', { p0: progress.phase === 'upload-stream' ? t('collaboration.s46377c7') : progress.phase === 'upload' ? t('collaboration.sa977650') : t('collaboration.s2b9d013'), p1: progress.name, p2: Math.floor(progress.bytes / progress.total * 100), p3: speed.toFixed(2), p4: progress.channel === 'socket' ? t('collaboration.s5a30350') : progress.channel === 'local' ? t('collaboration.s9ba0ee2') : t('collaboration.s5ee1ff9') });
    }
  }
  async asset(message) {
    if (!this.acceptAssets.checked || message.from !== this.client.host) return;
    const key = message.transfer ?? message.hash;
    if (message.index === 0) for (const [id, entry] of this.transfers) if (id !== key && entry.name === message.name) this.transfers.delete(id);
    if (this.transfers.size > 8) this.transfers.clear();
    let transfer = this.transfers.get(key);
    if (!transfer) { transfer = { chunks: new Map(), size: 0, name: message.name, total: message.total, hash: message.hash }; this.transfers.set(key, transfer); }
    if (transfer.total !== message.total || transfer.name !== message.name || transfer.hash !== message.hash || transfer.chunks.has(message.index)) return;
    const bytes = Uint8Array.from(atob(message.data), character => character.charCodeAt(0)); transfer.chunks.set(message.index, bytes); transfer.size += bytes.length;
    this.assetStatus.textContent = t('collaboration.sace7f0c', { p0: message.name, p1: Math.floor(transfer.chunks.size / transfer.total * 100), p2: (transfer.size / 1048576).toFixed(1) });
    if (transfer.size > 128 * 1024 * 1024) { this.transfers.delete(key); throw new Error(t('collaboration.s67059a7')); }
    if (transfer.chunks.size !== transfer.total) return;
    const result = new Uint8Array(transfer.size); let offset = 0;
    for (let index = 0; index < transfer.total; index++) { const chunk = transfer.chunks.get(index); result.set(chunk, offset); offset += chunk.length; }
    this.transfers.delete(key); if (await hash(result) !== message.hash) throw new Error(t('collaboration.s3a96dd8'));
    await this.receiveAsset(message.name, result); this.notify(t('collaboration.s3924d1b', { p0: message.name }), 'success');
  }
}
