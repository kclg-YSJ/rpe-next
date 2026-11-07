import { currentLocale } from '@rpen/core/i18n-core.mjs';
import { isTextEntry } from '@rpen/ui/keyboard.mjs';
import { evaluateNumericExpression } from '@rpen/core/numeric-expression.mjs';
import { NodeOwnership, positioned, controlSlot } from './ownership.mjs';
import { installFooterInfo } from './footer-info.mjs';
import { interfaceAsset } from './interface-assets.mjs';

const find = selector => document.querySelector(selector);
const text = (tag, content, className = '') => {
  const node = document.createElement(tag); node.className = className; node.textContent = content; return node;
};
const english = () => !currentLocale().locale.startsWith('zh');
const tr = (zh, en) => english() ? en : zh;

export class ClassicInterface {
  constructor(api, state, requestSync) {
    this.api = api; this.editor = api.editor; this.state = state; this.requestSync = requestSync;
    this.owner = new NodeOwnership(); this.settingsOwner = new NodeOwnership(); this.modeOwner = new NodeOwnership(); this.controller = new AbortController(); this.nodes = []; this.popovers = [];
    this.realtimeAlpha=find('#realtime-alpha');this.inspector=find('.inspector');
    this.page = state.toolbarPage ?? 0; this.homePage = state.homePage ?? 0; this.urls = state.urls ??= new Map(); this.proxyButtons = [];
    try {
    this.toolbar = this.mount(document.createElement('div'), find('.transport')); this.toolbar.id = 'rpe-classic-toolbar';
    this.toolbar.style.setProperty('--rc-slider-track', this.image('sliderbar'));
    this.toolbar.style.setProperty('--rc-slider-thumb', this.image('ball'));
    this.primary = document.createElement('div'); this.secondary = document.createElement('div'); this.common = document.createElement('div');
    this.toolbar.append(this.primary, this.secondary, this.common);
    this.toolMenu = this.menu('rpe-classic-tool-menu'); this.seekMenu = this.menu('rpe-classic-seek-menu');
    this.buildToolbar(); this.buildMenus(); this.buildHome(); this.buildModes(); this.buildFooter(); this.buildSettingsMenu();
    this.listen(this.toolbar, 'click', event => {
      const node = event.target.closest('button,select,input');
      // Native selects need focus until their popup commits a choice.
      if (node && node.tagName !== 'SELECT' && !isTextEntry(node)) queueMicrotask(() => node.blur());
    });
    this.listen(this.toolbar, 'change', event => { if (event.target.matches('select')) event.target.blur(); });
    this.listen(find('#notes-only'),'click',()=>{
      this.viewPane=this.editor.activePane;
    },{capture:true});
    this.listen(find('#notes-only'),'click',()=>{const pane=this.viewPane;this.viewPane=null;if(pane&&this.state.active&&this.editor.activePane!==pane)this.editor.activatePane(pane);});
    this.listen(window, 'pointerdown', event => {
      const input = event.target;
      if (event.button !== 0 || !input.matches?.('#rpe-classic-toolbar .rc-field > input.numeric-expression-number,#rpe-classic-toolbar .rc-field > input[type=number]')) return;
      const rect = input.getBoundingClientRect();
      // The host's expression editor reserves the last 16px for its internal
      // stepper. This skin uses external buttons; preserve native text focus and
      // caret defaults while preventing that document-level spin handler.
      if (event.clientX >= rect.right - 16) event.stopPropagation();
    }, {capture:true});
    this.listen(window, 'keydown', event => {
      if (event.key !== 'Escape') return;
      const open = this.popovers.find(node => node.matches(':popover-open'));
      if (open) { open.hidePopover(); event.preventDefault(); event.stopImmediatePropagation(); }
    }, { capture: true });
    this.listen(document, 'click', event => {
      const menu = event.target.closest('.rc-popover');
      if (menu && event.target.closest('button') && !event.target.closest('[data-rc-keep-menu]')) queueMicrotask(() => { if (menu.matches(':popover-open')) menu.hidePopover(); });
    });
    this.setPage(this.page); this.setHomePage(this.homePage); this.sync();
    } catch (error) { this.destroy(); throw error; }
  }
  listen(target, type, callback, options = {}) { target.addEventListener(type, callback, { ...options, signal: this.controller.signal }); }
  mount(node, parent = document.body) { parent.append(node); this.nodes.push(node); return node; }
  image(name) {
    if (!this.urls.has(name)) this.urls.set(name,interfaceAsset(this.api,name));
    return `url("${this.urls.get(name)}")`;
  }
  icon(parent, title, image, position, action, id) {
    const button = text('button', '', 'rc-icon'); button.type = 'button'; button.title = title; button.setAttribute('aria-label', title);
    if (id) button.id = id;
    if (image === 'heng') button.classList.add('rc-accent');
    button.style.setProperty('--rc-picture', this.image(image));
    button.onclick = () => { try { const result = action?.(); result?.catch?.(error => this.api.notify(error.message, 'error')); } catch (error) { this.api.notify(error.message, 'error'); } };
    parent.append(positioned(button, ...position)); return button;
  }
  native(parent, selector, position, { icon, className = '' } = {}) {
    const node = find(selector); if (!node) throw Error('RPE Classic: missing native control ' + selector);
    const slot = controlSlot(parent, null, position, className);
    this.owner.move(node, slot);
    if (icon) { this.owner.attribute(node, 'data-rc-icon', icon); slot.style.setProperty('--rc-picture', this.image(icon)); }
    return node;
  }
  checkbox(parent, selector, title, image, position) {
    const slot = controlSlot(parent, null, position), label = document.createElement('label');
    label.className = 'rc-icon-toggle'; label.title = title; label.style.setProperty('--rc-picture', this.image(image)); slot.append(label);
    const input = find(selector); this.owner.move(input, label); this.owner.attribute(input, 'aria-label', title); return input;
  }
  proxy(parent, selector, title, image, position, id) {
    const original = find(selector);
    const button = this.icon(parent, title, image, position, () => original?.click(), id);
    this.proxyButtons.push([button, original]); return button;
  }
  stepper(parent, selector, x, topY, bottomY) {
    const input = find(selector);
    const step = direction => {
      let value; try { value = evaluateNumericExpression(input.value); } catch { return; }
      const increment = input.step === 'any' ? 1 : Number(input.step) || 1;
      const next = Math.max(input.min === '' ? -Infinity : Number(input.min), Math.min(input.max === '' ? Infinity : Number(input.max), value + increment * direction));
      input.value = String(Number(next.toPrecision(12)));
      input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true}));
    };
    this.icon(parent, tr('增加','Increase'), 'arrowup', [x,topY,22,22], () => step(1), 'rpe-classic-'+input.id+'-up');
    this.icon(parent, tr('减少','Decrease'), 'arrowdown', [x,bottomY,22,22], () => step(-1), 'rpe-classic-'+input.id+'-down');
  }
  startPreview(replay) {
    this.previewStartMusicSeconds = this.editor.audio.time;
    this.editor.raw.togglePreview(true, false, replay, {autoplay:true});
  }
  endPreview(stay) {
    this.editor.pause();
    this.editor.raw.togglePreview(false, stay);
    if (!stay && this.previewStartMusicSeconds != null) this.editor.seek(this.previewStartMusicSeconds, {music:true,pause:true});
  }
  menu(id) {
    const node = document.createElement('div'); node.id = id; node.className = 'rc-popover'; node.setAttribute('popover', 'auto');
    this.mount(node); this.popovers.push(node); return node;
  }
  openMenu(menu, anchor) {
    if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
    const rect = anchor.getBoundingClientRect();
    for (const other of this.popovers) if (other.matches(':popover-open')) other.hidePopover();
    menu.style.left = Math.min(Math.max(5, rect.left), Math.max(5, innerWidth - 340)) + 'px';
    menu.style.top = Math.min(rect.bottom + 8, innerHeight - 120) + 'px'; menu.showPopover();
    if (menu === this.seekMenu) { find('#seek-beat').focus(); find('#seek-beat').select(); }
  }
  buildToolbar() {
    const a = this.primary, c = this.common;
    this.native(c, '#preferences', [40.32,37.8,40,40], {icon:'setting'});
    this.icon(c, '界面语言 / Language', 'translate', [44.16,97.2,40,40], () => {
      find('#preferences').click(); queueMicrotask(() => { const language = find('#language-settings'); language?.scrollIntoView({block:'start'}); find('#ui-language')?.focus(); });
    }, 'rpe-classic-language');
    this.native(c, '#notes-only', [104.256,37.8,40,40], {icon:'switch'});
    this.checkbox(c, '#realtime-enabled', tr('实时背景预览','Realtime background'), 'showback', [104.256,97.2,40,40]);
    this.play = this.icon(a, tr('从当前位置播放预览','Preview from the current position'), 'play', [172.8,37.8,40,40], () => this.startPreview(false), 'rpe-classic-play');
    this.pause = this.icon(a, tr('结束预览并返回起点','End preview and return to its start'), 'pause1', [230.4,37.8,40,40], () => this.endPreview(false), 'rpe-classic-pause');
    this.icon(a, tr('结束预览并停在当前时刻','End preview and stay at the current time'), 'jump', [288,37.8,40,40], () => this.endPreview(true), 'rpe-classic-jump');
    this.icon(a, tr('从头播放预览','Replay preview from the beginning'), 'replay', [345.6,37.8,40,40], () => this.startPreview(true), 'rpe-classic-replay');
    this.native(a, '#copy', [172.8,97.2,40,40], {icon:'copy'});
    this.native(a, '#cut', [230.4,97.2,40,40], {icon:'shear'});
    this.native(a, '#paste', [288,97.2,40,40], {icon:'paste'});
    this.native(a, '#undo', [345.6,97.2,40,40], {icon:'return'});
    this.icon(a, tr('实时预览透明度','Realtime preview opacity'), 'mask', [422.4,37.8,40,40]);
    this.alpha = document.createElement('input'); this.alpha.type = 'text'; this.alpha.inputMode = 'decimal'; this.alpha.setAttribute('aria-label', tr('实时预览透明度 0–255','Realtime preview opacity 0–255'));
    controlSlot(a, this.alpha, [483.07,37.8,70,40], 'rc-field');
    this.listen(this.alpha, 'input', () => {
      const raw = this.alpha.value.trim(), number = Number(raw);
      if (!raw || !Number.isFinite(number) || number < 0 || number > 255) return;
      const native = find('#realtime-alpha'); native.value = String(number / 255); native.dispatchEvent(new Event('input', { bubbles:true }));
    });
    this.icon(a, tr('判定线管理','Judge line manager'), 'edit', [420,97.2,40,40], () => find('[data-pane=lines]')?.click());
    this.line = document.createElement('input'); this.line.type = 'text'; this.line.inputMode = 'numeric'; this.line.setAttribute('aria-label', tr('当前线号','Current line index'));
    controlSlot(a, this.line, [483.07,97.2,70,40], 'rc-field');
    const selectLine = () => { if (!/^\d+$/.test(this.line.value.trim())) return; const index = Number(this.line.value); if (Number.isSafeInteger(index) && index < this.editor.chart.judgeLineList.length) this.editor.selectLine(index); };
    this.listen(this.line, 'change', selectLine);
    this.listen(this.line, 'keydown', event => { if (event.key === 'Enter') { selectLine(); this.line.blur(); event.preventDefault(); } });
    this.native(a, '#line-next', [531.26,86.4,22,22], {icon:'arrowup'});
    this.native(a, '#line-previous', [531.26,107.1,22,22], {icon:'arrowdown'});
    this.native(a, '#batch-run', [595.2,37.8,40,40], {icon:'operation'});
    this.native(a, '#batch-action', [697.92,37.8,155,45], {className:'rc-field'});
    this.native(a, '#reset-camera', [596.16,97.2,40,40], {icon:'shrink'});
    this.native(a, '#view-divisor', [656.45,97.2,65,40], {className:'rc-field'});
    this.native(a, '#camera-x', [740.16,97.2,65,40], {className:'rc-field'});
    this.icon(a, tr('拍数细分','Beat division'), 'heng', [825.6,37.8,40,40]);
    this.native(a, '#division', [883.2,37.8,60,40], {className:'rc-field'});
    this.stepper(a, '#division', 926.4, 27, 48.06);
    this.checkbox(a, '#snap-x', tr('横向吸附','Horizontal snap'), 'shu', [825.6,97.2,40,40]);
    this.native(a, '#grid-count', [883.2,97.2,60,40], {className:'rc-field'});
    this.stepper(a, '#grid-count', 926.4, 86.4, 107.46);
    this.icon(a, tr('音乐偏移（毫秒）','Music offset (ms)'), 'offset', [984.96,37.8,40,40]);
    this.native(a, '#offset', [1050.24,37.8,75,40], {className:'rc-field'});
    this.icon(a, tr('预览比例','Preview aspect ratio'), 'ratio', [984.96,97.2,40,40]);
    this.native(a, '#preview-ratio', [1050.24,97.2,75,45], {className:'rc-field'});
    this.checkbox(a, '#preserve-pitch', tr('变速保调','Preserve pitch'), 'speed', [1138.56,37.8,40,40]);
    const rate = this.native(a, '#rate', [1215.36,37.8,100,45], {className:'rc-field'});
    for (const option of rate.options) {
      const number = Number(option.value);
      if (Number.isFinite(number)) this.owner.attribute(option, 'label', (Number.isInteger(number) ? number.toFixed(1) : String(number)) + 'x');
    }
    this.native(a, '#game-ui', [1138.56,97.2,40,40], {icon:'layout'});
    this.native(a, '#mute-current-line', [1305.6,37.8,40,40], {icon:'mute'});
    this.checkbox(a, '#direct-placement-enabled', tr('启用直接放置，然后在播放预览中选择判定线','Enable direct placement, then select a line in playback preview'), 'direct-placement.svg', [1308.48,97.2,40,40]);
    this.icon(c, tr('切换工具栏','Switch toolbar page'), 'more', [1215.36,97.2,40,40], () => this.setPage(1-this.page), 'rpe-classic-more');
    this.native(c, '.scrubber-wrap', [1622.4,27,550,42], {className:'rc-time-progress'});
    this.native(c, '.time-readouts', [1622.4,62.1,550,32], {className:'rc-times'});
    this.native(c, '#bpm-display', [1622.4,62.1,150,32], {className:'rc-bpm'});
    this.native(c, '#y-scale-slider', [1622.4,97.2,550,30], {className:'rc-range'});
    c.append(positioned(text('span', tr('纵向拉伸','Vertical scale'), 'rc-label'), 1622.4,129.6,550,30));

  }
  buildMenus() {
    const toolGrid = document.createElement('div'); toolGrid.className = 'rc-menu-grid'; this.toolMenu.append(toolGrid);
    const seek = text('button', tr('定位拍数','Seek beat')); seek.type = 'button'; seek.id = 'rpe-classic-seek';
    seek.onclick = () => this.openMenu(this.seekMenu, seek); toolGrid.append(seek);
    for (const id of ['redo','rewind','clear-clipboard','delete','mirror']) if (find('#'+id)) this.owner.move(find('#'+id), toolGrid);
    toolGrid.append(text('div', tr('视图与输入','View and input'), 'rc-menu-title'));
    const views = document.createElement('div'); views.className = 'rc-native-views rc-menu-full'; toolGrid.append(views);
    this.owner.move(find('#y-scale')?.closest('label'), views);
    this.owner.move(find('.tools'), views);
    const lines = text('label', tr('当前线号','Current line')); views.append(lines); this.owner.move(find('#line-select'), lines);
    const select = find('.inspector-tabs [data-pane=notes]'), events = find('.inspector-tabs [data-pane=events]');
    if (select) this.owner.move(select, toolGrid); if (events) this.owner.move(events, toolGrid);
    const field = document.createElement('div'); field.className = 'rc-seek-field'; this.seekMenu.append(field);
    this.owner.move(find('.beat-seek'), field); this.owner.move(find('#seek'), field);
    this.listen(find('#seek-beat'), 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); find('#seek').click(); this.seekMenu.hidePopover(); } });
  }
  buildHome() {
    this.actionGrid = find('[data-panel=chart] .action-grid');
    this.home = this.mount(document.createElement('div'), this.actionGrid); this.home.id = 'rpe-classic-home';
    this.home.style.setProperty('--rc-textbox', this.image('textbox'));
    this.homeTools = new Set(); this.homeSlots = [];
    for (const selector of ['#metadata','#bpm','[data-pane=lines]','#curve-notes','#multi-line-tool','#assets','#ai-tool','#curve-trajectory','#audio-analysis-tool','#global-events-tool','#noise-areas-tool','#text-lines-tool','#noise-fit-tool','#noise-tracking-tool','#note-tracking-tool','#diagnose','#history-panel','#version-control-tool','#collaboration-tool','#clipboard-history']) {
      const node = find(selector); if (node) this.addHomeTool(node);
    }
    this.collectHomeTools();
    // Auxiliary editor commands retain an entry on the right; the second
    // toolbar page intentionally contains no tools.
    const utilities = text('button', tr('编辑与视图','Edit and view')); utilities.type = 'button'; utilities.id = 'rpe-classic-edit-tools';
    utilities.onclick = () => this.openMenu(this.toolMenu, utilities); this.home.append(utilities); this.addHomeTool(utilities);
    this.left = this.icon(this.home, tr('上一页','Previous page'), 'goup', [471.5,878,36,36], () => this.setHomePage(this.homePage - 1), 'rpe-classic-home-prev');
    this.right = this.icon(this.home, tr('下一页','Next page'), 'godown', [516.4,878,36,36], () => this.setHomePage(this.homePage + 1), 'rpe-classic-home-next');
    this.left.style.rotate = this.right.style.rotate = '-90deg';
    this.homeObserver = new MutationObserver(() => { if (this.collectHomeTools()) this.setHomePage(this.homePage); });
    this.homeObserver.observe(this.actionGrid, {childList:true});
    this.back = text('button', tr('‹ 谱面工具','‹ Chart tools')); this.back.type = 'button'; this.back.id = 'rpe-classic-back';
    this.back.style.setProperty('--rc-back-icon',this.image('return'));
    this.back.onclick = () => this.returnHome(); this.mount(this.back, find('.inspector')); find('.inspector').prepend(this.back);
    this.status = this.mount(document.createElement('div'),find('.inspector')); this.status.id='rpe-classic-check-status'; this.status.setAttribute('aria-hidden','true');
    const diagnostics=this.editor.diagnostics;
    const updateStatus=()=>{
      if(diagnostics?.pending)return;
      const error=Boolean(diagnostics?.issues.some(issue=>issue.severity==='error'));
      if(this.status.dataset.error!==String(error))this.status.dataset.error=String(error);
    };
    if(diagnostics)this.listen(diagnostics,'change',updateStatus);updateStatus();
    this.caption = this.mount(text('span', '', 'rc-stage-caption'), find('.stage'));
    const layerHost = this.mount(document.createElement('div'), find('.timeline-head')); layerHost.id = 'rpe-classic-layer'; this.owner.move(find('#layer'), layerHost);
    layerHost.style.setProperty('--rc-textbox', this.image('textbox'));
  }
  addHomeTool(node) {
    if (this.homeTools.has(node)) return;
    const index = this.homeTools.size;
    const slot = controlSlot(this.home, null, [147.6,93.6,250,100], 'rc-home-slot'); this.homeSlots.push(slot);
    slot.dataset.rcPage = String(Math.floor(index / 14)); this.owner.move(node, slot); this.homeTools.add(node);
    this.homePageCount = Math.ceil(this.homeTools.size / 14);
    // Balance a partially filled page while retaining seven rows per column.
    const start=Math.floor(index/14)*14,count=this.homeSlots.length-start,leftCount=Math.ceil(count/2);
    for(let i=0;i<count;i++)positioned(this.homeSlots[start+i],i<leftCount?147.6:416.4,93.6+(i<leftCount?i:i-leftCount)*118.8,250,100);
  }
  collectHomeTools() {
    const nodes = [...this.actionGrid.querySelectorAll(':scope > button,:scope > .skin-control-group button')];
    for (const node of nodes) this.addHomeTool(node);
    return nodes.length > 0;
  }
  returnHome() {
    if(this.settingsDialog?.open)this.settingsDialog.close();
    // The curve panel owns a separate pick/preview state. Its native cancel
    // clears that state; activating the chart pane alone leaves it intercepting
    // note clicks after the panel disappears.
    const pane=this.editor.activePane;
    if (this.editor.noiseEditor?.active) {
      if(pane==='noise-properties')this.editor.activatePane('noise');
      else this.editor.noiseEditor.close();
    } else if(this.editor.globalEvents?.active) {
      if(pane==='global-event-properties')this.editor.activatePane('global-events');
      else this.editor.globalEvents.close();
    } else if(this.editor.directPlacement?.active) {
      find('#close-direct-placement').click();this.editor.setPreview(false,{stay:true,autoplay:false});this.editor.activatePane('chart');
    } else if(this.editor.session.multiLineActive) {
      if(pane!=='multi-line')this.editor.activatePane('multi-line');
      else {find('#multi-line-toggle').click();this.editor.activatePane('chart');}
    } else if (pane === 'curve') find('#curve-cancel')?.click();
    else this.editor.activatePane('chart');
    this.back.blur();
  }
  buildModes() {
    this.modeActions=this.mount(document.createElement('div'),find('.inspector'));this.modeActions.id='rpe-classic-mode-actions';this.modeActions.hidden=true;
    this.listen(this.modeActions,'click',event=>{const button=event.target.closest('button');if(button)queueMicrotask(()=>button.blur());});
    this.back.after(this.modeActions);
    this.modeExit=document.createElement('button');this.modeExit.type='button';this.modeExit.id='rpe-classic-mode-exit';
    this.modeExit.onclick=()=>{
      const e=this.editor;
      if(e.noiseEditor.active)e.noiseEditor.close();
      else if(e.globalEvents.active)e.globalEvents.close();
      else if(e.directPlacement.active){find('#close-direct-placement').click();e.setPreview(false,{stay:true,autoplay:false});}
      else if(e.session.multiLineActive)find('#multi-line-toggle').click();
      e.activatePane('chart');this.modeExit.blur();
    };this.modeActions.append(this.modeExit);
    this.multiActions=document.createElement('div');this.multiActions.className='rc-multi-actions';this.modeActions.append(this.multiActions);
    for(const id of ['multi-line-prev-add','multi-line-prev-remove','multi-line-next-remove','multi-line-next-add','multi-line-merge','multi-line-open'])this.owner.move(find('#'+id),this.multiActions);
    this.modeLayers=document.createElement('div');this.modeLayers.className='rc-mode-layers';this.modeLayers.hidden=true;
    this.modeLayers.style.setProperty('--rc-textbox',this.image('textbox'));this.modeActions.append(this.modeLayers);
    this.directActions=document.createElement('div');this.directActions.className='rc-direct-actions';this.directActions.hidden=true;this.modeActions.append(this.directActions);
    this.modeHead=this.mount(document.createElement('div'),find('.stage'));this.modeHead.id='rpe-classic-mode-head';this.modeHead.hidden=true;
    this.modeColumns=document.createElement('div');this.modeColumns.className='rc-mode-columns';this.modeHead.append(this.modeColumns);
  }
  syncModes() {
    const e=this.editor,mode=e.noiseEditor?.active?'noise':e.globalEvents?.active?'global':e.directPlacement?.active?'direct':e.session.multiLineActive?'multi':'';
    const name=mode==='noise'?tr('噪域编辑','Noise areas'):mode==='global'?tr('全局事件','Global events'):mode==='direct'?tr('直接放置','Direct placement'):tr('多线编辑','Multi-line editing');
    if(this.mode!==mode){
      this.mode=mode;this.state.mode=mode;
      if(mode)document.documentElement.dataset.rpeClassicMode=mode;else delete document.documentElement.dataset.rpeClassicMode;
      this.modeActions.hidden=!mode||mode==='multi';this.multiActions.hidden=true;
      this.modeHead.hidden=!['noise','global'].includes(mode);
      this.modeExit.textContent=tr('退出','Exit ')+name;this.modeColumnKey=null;
      if(mode==='direct'&&e.activePane==='chart'){e.activatePane('notes');e.render();}
      if(mode==='multi'&&e.activePane==='chart')find('#multi-line-tool').click();
    }
    let key,entries;
    if(mode==='noise'){
      const n=e.noiseEditor;key=[mode,this.state.scale,e.session.chart,n.selected,n.area()?.Name];
      if(!this.modeColumnKey||key.some((value,i)=>value!==this.modeColumnKey[i])){
        const l=n.layout();entries=[{left:0,width:l.split,text:name+' · '+(n.area()?`#${n.selected} ${n.area().Name||''}`:tr('请选择噪域','Select a noise area'))},...n.modeTracks.map((node,i)=>({left:l.eventLeft+i*l.eventWidth,width:l.eventWidth,text:node.textContent}))];
      }
    }else if(mode==='global'){
      const g=e.globalEvents;key=[mode,g.geometry,g.timeline.eventLabels,g.canvas.parentElement.scrollLeft];
      if(!this.modeColumnKey||key.some((value,i)=>value!==this.modeColumnKey[i]))entries=(g.geometry??[]).map((r,i)=>({...r,text:g.timeline.eventLabels?.[i]??''}));
    }
    if(entries&&(!this.modeColumnKey||key.some((value,i)=>value!==this.modeColumnKey[i]))){
      this.modeColumnKey=key;
      this.modeColumns.replaceChildren(...entries.map(r=>{const node=text('span',r.text);node.style.left=r.left+'px';node.style.width=r.width+'px';return node;}));
      this.modeColumns.style.transform=mode==='global'?`translateX(${-e.globalEvents.canvas.parentElement.scrollLeft}px)`:'none';
    }
    const resource=mode==='direct'?'direct':'';
    if(resource!==this.modeResource){
      this.modeResource=resource;this.modeOwner.restore();this.modeLayers.hidden=true;this.directActions.hidden=mode!=='direct';
      if(mode==='direct')this.modeOwner.move(find('.tools'),this.directActions);
    }
    const active=Boolean(mode),pane=e.activePane;
    const property=pane==='multi'?this.state.batchHeader:this.state.propertyHeaders?.[pane];
    const title=property??(mode==='noise'&&pane==='noise-properties'?tr('‹ 噪域列表','‹ Noise areas'):mode==='global'&&pane==='global-event-properties'?tr('‹ 全局事件','‹ Global events'):mode==='multi'&&pane!=='multi-line'?tr('‹ 多线编辑','‹ Multi-line editing'):tr('‹ 谱面工具','‹ Chart tools'));
    if(Boolean(property)!==this.back.hasAttribute('data-property'))this.back.toggleAttribute('data-property',Boolean(property));
    if(this.back.textContent!==title)this.back.textContent=title;
    return active;
  }
  setPage(page) {
    this.page = page; this.state.toolbarPage = page; this.primary.hidden = page !== 0; this.secondary.hidden = page !== 1;
    for (const menu of this.popovers) if (menu.matches(':popover-open')) menu.hidePopover();
  }
  buildFooter() {
    const host = this.mount(document.createElement('div'), find('body > footer')); host.id = 'rpe-classic-footer-icons';
    this.native(host, '#help', [20,18,28,28], {icon:'help'});
    this.native(host, '#chart-info-toggle', [55,18,28,28], {icon:'info'});
    this.footerInfo=installFooterInfo(find('#chart-info'),find('body > footer'));
  }
  buildSettingsMenu() {
    this.settingsDialog = find('#settings-modal'); this.headerNav = find('header nav');
    this.settingsMenu = this.mount(document.createElement('div'), this.settingsDialog);
    this.settingsMenu.id = 'rpe-classic-settings-menu'; this.settingsMenu.hidden = true;
    this.settingsObserver = new MutationObserver(() => this.syncSettingsMenu());
    this.settingsObserver.observe(this.settingsDialog, {attributes:true,attributeFilter:['open']});
    this.syncSettingsMenu();
  }
  syncSettingsMenu() {
    const open = Boolean(this.settingsDialog?.open);
    if (open === this.settingsMenuOpen) return; this.settingsMenuOpen = open;
    if (open) {
      this.settingsMenu.hidden = false; this.settingsOwner.move(this.headerNav, this.settingsMenu);
      for (const [node, origin] of this.owner.moves) if (origin.parent === this.headerNav && origin.anchor.parentNode === this.headerNav) this.settingsOwner.move(node, this.headerNav, origin.anchor);
    } else { this.settingsOwner.restore(); if (this.settingsMenu) this.settingsMenu.hidden = true; }
  }
  setHomePage(page) {
    page = Math.max(0, Math.min(this.homePageCount - 1, page));
    this.homePage = page; this.state.homePage = page;
    for (const node of this.home.querySelectorAll('[data-rc-page]')) node.hidden = Number(node.dataset.rcPage) !== page;
    this.left.disabled = page === 0; this.right.disabled = page === this.homePageCount - 1;
    this.home.dataset.page = String(page); this.home.dataset.pages = String(this.homePageCount);
  }
  sync() {
    const pressed = String(this.editor.preview.visible);
    if (this.play.getAttribute('aria-pressed') !== pressed) this.play.setAttribute('aria-pressed', pressed);
    for (const [button, original] of this.proxyButtons){const disabled=!original||original.disabled;if(button.disabled!==disabled)button.disabled=disabled;}
    if (document.activeElement !== this.alpha) {
      const alpha = String(Math.round(Number(this.realtimeAlpha.value) * 255));
      if (this.alpha.value !== alpha) this.alpha.value = alpha;
    }
    if (document.activeElement !== this.line && this.line.value !== String(this.editor.session.lineIndex)) this.line.value = String(this.editor.session.lineIndex);
    const modeActive=this.syncModes();
    const home = this.editor.activePane === 'chart'&&!modeActive;
    if (this.back.hidden !== home) this.back.hidden = home;
    if (this.lastPane !== this.editor.activePane) {
      this.lastPane = this.editor.activePane;
      if(this.lastPane==='chart'&&this.settingsDialog?.open)this.settingsDialog.close();
      this.inspector.scrollTop = 0;
      const panel = find(`.inspector > [data-panel="${this.lastPane}"]`);
      if (panel) panel.scrollTop = 0;
    }
    const line = this.editor.session.line, name = String(line?.Name ?? line?.name ?? this.editor.session.lineIndex);
    if (this.caption.textContent !== name) this.caption.textContent = name;
  }
  ready(){return this.realtimeAlpha?.isConnected&&this.inspector?.isConnected&&this.toolbar?.isConnected;}
  destroy() {
    this.footerInfo?.();
    delete document.documentElement.dataset.rpeClassicMode;
    this.modeOwner.restore();
    this.homeObserver?.disconnect(); this.settingsObserver?.disconnect(); this.settingsOwner.restore();
    this.controller.abort();
    for (const menu of this.popovers) if (menu.matches(':popover-open')) menu.hidePopover();
    this.owner.restore();
    for (const node of this.nodes.reverse()) node.remove();
    this.nodes.length = 0;
  }
}
