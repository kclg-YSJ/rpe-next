import { ShaderPipeline } from './shader-pipeline.mjs';
import { ShaderPreviewScene } from './shader-preview-scene.mjs';
import { shaderPreviewTargets } from '../core/shader-preview.mjs';
import { SHADER_NAMES, canonicalShaderName } from '../core/shader.mjs';
import { shaderTypeFields, shaderParameters } from '../core/shader-events.mjs';
import { chartShaderChoices, shaderAssetPath, chartShaderEvents, shaderText, MAX_SHADER_BYTES } from '../core/shader-assets.mjs';
import { shaderAssetLabel, shaderAssetInfo, shaderAssetName, shaderSourceBody, shaderSourceInfo, namedShaderSource, chartNamePrefix, inferShaderAssetNames } from '../core/shader-source-info.mjs';
import { shaderUniforms, shaderVariableProblems } from '../core/shader-uniforms.mjs';
import { replaceShaderResource, shaderReferenceCount } from '../application/shader-resource-commands.mjs';
import { SHADER_PRESETS } from '../core/shader-presets.mjs';
import { readShaderSource } from '../platform/shader-sources.mjs';
import { assertShaderSource, readShaderLibrary, saveShaderTemplate, removeShaderTemplate, materializeShader } from '../platform/shader-library.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';
import { selectedEventEntries as selectedEvents, transformEvents } from '../application/event-commands.mjs';
import { download } from '../platform/files.mjs';
import { curveIcon } from './curve-icons.mjs';
import { t } from '../i18n.mjs';

export async function openShaderEditor(getContext, options = {}) {
  const initial = getContext(); if (!initial?.hasDocument) throw Error(t('render.openChart'));
  const session = initial.session, signature = () => JSON.stringify([session.lineIndex, session.eventLayer, [...session.eventSelection], [...(session.multiEventSelection ?? [])].map(([line, keys]) => [line, [...keys]])]);
  const initialSelection = signature();
  const tr = key => t('shader-editor.' + key), el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const root = el('section', 'shader-code-window'); root.id = 'shader-code-window'; root.tabIndex = -1; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', tr('title')); root.setAttribute('popover', 'manual');
  let disposed = false, frame = 0, timer = 0, resizeTimer = 0, draftId = null, savedSource = '', savedText = '', validSource = '', sourceGeneration = 0, busy = false, playing = false, seconds = Math.max(0, initial.chartSeconds()), last = 0, waiting = false, refreshScene = false, selectionValid = true, drag, maximized = false;
  let values = {}, defaults = {}, parameterFields = [], liveScene, library = readShaderLibrary(), prefs = {}, savedName = '', selectedChoice = '', chartPath = null, chartBytes = null, chartInfo = null, draftIdentity = crypto.randomUUID();
  const previewTargets = shaderPreviewTargets(selectedEvents(session).filter(entry => entry.type === 'paintEvents'));
  try { prefs = JSON.parse(localPreferences.getItem('rpen-shader-window-v1') || '{}'); } catch {}
  const pipeline = new ShaderPipeline(), source = document.createElement('canvas'), draftOutput = document.createElement('canvas'), previousFocus = document.activeElement;
  source.width = 960; source.height = 540;
  const header = el('header', 'shader-code-header'), title = el('h2', '', tr('title')), actions = el('div', 'shader-code-actions'); header.append(title, actions); root.append(header);
  function button(icon, key, action, parent = actions, caption = false) {
    const b = el('button', 'curve-button'); b.type = 'button'; b.title = b.ariaLabel = tr(key); b.dataset.action = key; b.append(curveIcon(icon)); if (caption) b.append(el('span', '', tr(key)));
    b.onclick = () => { Promise.resolve().then(action).catch(error => status(error.message, true)); }; parent.append(b); return b;
  }
  const helpButton = button('help', 'help', () => { help.hidden = !help.hidden; helpButton.setAttribute('aria-expanded', String(!help.hidden)); });
  button('maximize', 'maximize', () => { maximized = !maximized; layout(); });
  const cancel = button('close', 'cancel', () => {
    if (busy) return;
    code.value = savedText; name.value = savedName; values = {}; dispose();
  }, actions, true); cancel.title = tr('cancelHint');
  const done = button('check', 'close', () => { if (!busy && (!dirty() || confirm(tr('discard')))) dispose(); }, actions, true);
  const toolbar = el('div', 'shader-code-toolbar'), choices = el('select'); choices.id = 'shader-source-choice'; choices.ariaLabel = tr('load'); toolbar.append(choices);
  button('add', 'new', () => { if (dirty() && !confirm(tr('discard'))) return; loadDraft(SHADER_PRESETS[0].source, '', null); choices.value = 'preset:passthrough'; }, toolbar);
  button('copy', 'fork', () => { const text = code.value, title = name.value; loadDraft(text, title); choices.selectedIndex = -1; selectedChoice = ''; }, toolbar);
  const upload = el('input'); upload.type = 'file'; upload.accept = '.glsl,.frag,.fs,.fsh'; upload.hidden = true;
  button('import', 'import', () => upload.click(), toolbar); button('export', 'export', () => { assertShaderSource(code.value); download(new Blob([code.value], { type: 'text/plain;charset=utf-8' }), (name.value.trim() || 'shader').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.glsl'); }, toolbar);
  const search = el('input'); search.type = 'search'; search.placeholder = tr('search'); search.ariaLabel = tr('search'); search.onkeydown = event => { if (event.key === 'Enter') { const start = code.selectionEnd, text = code.value.toLowerCase(), query = search.value.toLowerCase(); const at = text.indexOf(query, start) >= 0 ? text.indexOf(query, start) : text.indexOf(query); if (at >= 0 && query) { code.focus(); code.setSelectionRange(at, at + query.length); code.scrollTop = Math.max(0, code.value.slice(0, at).split('\n').length - 5) * 21; syncScroll(); } } }; toolbar.append(search, upload); root.append(toolbar);
  const help = el('div', 'shader-code-help'); help.hidden = true; help.append(el('strong', '', tr('helpTitle')), el('p', '', tr('helpText')), el('pre', '', SHADER_PRESETS[1].source)); root.append(help);
  const scope = el('div', 'shader-code-scope'); scope.id = 'shader-code-scope'; root.append(scope);
  const body = el('div', 'shader-code-body'), codeSide = el('div', 'shader-code-side'), previewSide = el('div', 'shader-code-preview'); root.append(body); body.append(codeSide, previewSide);
  const editor = el('div', 'shader-code-input'), lineNumbers = el('pre', 'shader-line-numbers'), highlighted = el('pre', 'shader-highlight'), code = el('textarea'); code.id = 'shader-code'; code.ariaLabel = tr('code'); code.spellcheck = false; code.autocapitalize = 'off'; code.autocomplete = 'off'; code.wrap = 'off'; editor.append(lineNumbers, highlighted, code); codeSide.append(editor);
  lineNumbers.setAttribute('aria-hidden', 'true'); highlighted.setAttribute('aria-hidden', 'true');
  const diagnostic = el('pre', 'shader-code-diagnostic'); diagnostic.setAttribute('role', 'status'); codeSide.append(diagnostic);
  const previewBar = el('div', 'shader-preview-toolbar'); previewSide.append(previewBar);
  const play = button('play', 'play', () => { playing = !playing; syncPlayback(); last = 0; draw(); }, previewBar); play.setAttribute('aria-pressed', 'false');
  const scene = el('select'); scene.ariaLabel = tr('scene'); scene.append(new Option(tr('currentScene'), 'chart'), new Option(tr('testScene'), 'test')); previewBar.append(scene);
  button('load', 'refresh', captureScene, previewBar);
  const time = el('input'); time.type = 'number'; time.step = '.1'; time.min = '0'; time.value = seconds.toFixed(1); time.ariaLabel = tr('time');
  time.oninput = time.onchange = () => { if (!time.value.trim() || !time.validity.valid || !Number.isFinite(Number(time.value))) return; seconds = Number(time.value); last = 0; refreshScene = true; draw(); }; previewBar.append(time);
  const outputWrap = el('div', 'shader-preview-image'), output = el('canvas'); output.id = 'shader-code-preview'; outputWrap.append(output); previewSide.append(outputWrap);
  const params = el('div', 'shader-preview-params'); previewSide.append(el('small', 'hint', tr('previewParameters')), params);
  const footer = el('footer', 'shader-code-footer'), name = el('input'); name.id = 'shader-template-name'; name.placeholder = name.ariaLabel = tr('name'); footer.append(name);
  const save = button('save', 'save', () => saveTemplate(false), footer, true), saveNew = button('saveNew', 'saveNew', () => saveTemplate(true), footer);
  const remove = button('delete', 'remove', async () => {
    if (busy || !draftId || !confirm(tr('deleteConfirm'))) return;
    const id = draftId, generation = sourceGeneration; busy = true; updateButtons();
    try { await removeShaderTemplate(id, savedSource); if (disposed || generation !== sourceGeneration || draftId !== id) return; draftId = null; library = readShaderLibrary(); refreshChoices(); choices.selectedIndex = -1; selectedChoice = ''; status(tr('deleted')); }
    finally { busy = false; updateButtons(); }
  }, footer);
  const apply = button('load', 'apply', applyToSelection, footer, true); root.append(footer);
  const message = el('div', 'shader-code-status'); message.setAttribute('role', 'status'); root.append(message);
  function status(text, error = false) { if (disposed) return; message.textContent = text; message.classList.toggle('error', error); }
  function dirty() { return code.value !== savedText || name.value !== savedName; }
  function updateButtons() {
    const current = getContext(), validSession = current?.session === session;
    save.disabled = saveNew.disabled = busy || code.value !== validSource || !validSession;
    remove.disabled = busy || !draftId;
    cancel.disabled = done.disabled = busy;
    choices.disabled = busy;
    apply.disabled = busy || code.value !== validSource || !selectionValid || !validSession || !!chartPath && dirty() || !selectedEvents(session).some(e => e.type === 'paintEvents');
    const key = chartPath ? 'saveChart' : 'save'; save.title = save.ariaLabel = tr(key); save.querySelector('span:last-child').textContent = tr(key);
    saveNew.title = saveNew.ariaLabel = tr(chartPath ? 'saveGlobalCopy' : 'saveNew');
    scope.textContent = chartPath ? t('shader-editor.chartScope', { count: validSession ? shaderReferenceCount(session.chart, current.assets, chartPath, current.chartName) : 0 }) + (session.largeDocument || session.collaboration ? ' ' + tr('assetSaveScope') : '') : tr(draftId ? 'libraryScope' : 'copyScope');
    scope.title = chartPath ?? ''; root.dataset.scope = chartPath ? 'chart' : draftId ? 'library' : 'draft';
  }
  name.oninput = () => { sourceGeneration++; updateButtons(); };
  function refreshChoices() {
    const selected = choices.value; choices.replaceChildren();
    const group = (title, rows) => { const group = el('optgroup'); group.label = tr(title); for (const [id, label] of rows) group.append(new Option(label, id)); choices.append(group); };
    group('presets', SHADER_PRESETS.map(p => ['preset:' + p.id, tr('preset.' + p.id)]));
    group('builtins', SHADER_NAMES.map(n => ['builtin:' + n, n]));
    group('library', library.map(entry => ['library:' + entry.id, entry.name]));
    const current = getContext(), paths = chartShaderChoices(session.chart, current.assets, current.chartName); inferShaderAssetNames(paths, current.assets, library);
    group('chartOnly', paths.map(path => ['chart:/' + path, shaderAssetLabel(path, current.assets, session.chart, current.chartName)]));
    if ([...choices.options].some(option => option.value === selected)) choices.value = selected;
  }
  function loadDraft(text, title, entry, path = null) {
    sourceGeneration++; draftIdentity = crypto.randomUUID(); chartPath = path; chartBytes = path ? getContext().assets.get(path) : null; chartInfo = path ? shaderAssetInfo(chartBytes) : null;
    code.value = shaderSourceBody(text); name.value = path ? shaderAssetName(path, getContext().assets) : title || ''; draftId = entry?.id ?? null; savedSource = entry?.source ?? ''; savedText = code.value; savedName = name.value; selectedChoice = choices.value; values = {}; highlight(); compile(); updateButtons();
  }
  choices.onchange = async () => {
    const value = choices.value, generation = ++sourceGeneration;
    if (dirty() && !confirm(tr('discard'))) { choices.value = selectedChoice; return; }
    try {
      if (value.startsWith('preset:')) { const preset = SHADER_PRESETS.find(p => p.id === value.slice(7)); loadDraft(preset.source, tr('preset.' + preset.id)); }
      else if (value.startsWith('library:')) { const entry = library.find(e => e.id === value.slice(8)); loadDraft(entry.source, entry.name, entry); }
      else { const current = getContext(), builtin = value.startsWith('builtin:'); const ref = builtin ? shaderTypeFields(value.slice(8)).shader : value.slice(6); const text = await readShaderSource(ref, current.assets, current.chartName); if (!disposed && generation === sourceGeneration) loadDraft(text, builtin ? value.slice(8) : value.slice(6).split('/').at(-1).replace(/\.[^.]*$/, ''), null, builtin ? null : shaderAssetPath(current.assets, ref, current.chartName)); }
    } catch (error) { status(error.message, true); }
  };
  upload.onchange = async () => { const file = upload.files[0]; if (!file) return; const generation = ++sourceGeneration; try { if (file.size > MAX_SHADER_BYTES) throw Error(tr('tooLarge')); const text = shaderText(new Uint8Array(await file.arrayBuffer())); if (disposed || generation !== sourceGeneration || getContext()?.session !== session) return; if (dirty() && !confirm(tr('discard'))) return; loadDraft(text, file.name.replace(/\.[^.]+$/, '')); choices.selectedIndex = -1; } catch (error) { status(error.message, true); } finally { upload.value = ''; } };
  function highlight() {
    highlighted.replaceChildren(); const pattern = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|^\s*#[^\n]*|\b(?:uniform|varying|precision|mediump|lowp|highp|float|int|bool|vec[234]|mat[234]|sampler2D|void|if|else|for|return|const|true|false)\b|\b\d+(?:\.\d*)?(?:e[+-]?\d+)?\b/gm;
    let last = 0; for (const match of code.value.matchAll(pattern)) { highlighted.append(document.createTextNode(code.value.slice(last, match.index))); const token = el('span', /^\//.test(match[0]) ? 'shader-token-comment' : /^\s*#/.test(match[0]) ? 'shader-token-directive' : /^\d/.test(match[0]) ? 'shader-token-number' : 'shader-token-keyword', match[0]); highlighted.append(token); last = match.index + match[0].length; } highlighted.append(document.createTextNode(code.value.slice(last) + '\n'));
    lineNumbers.textContent = Array.from({ length: code.value.split('\n').length }, (_, i) => i + 1).join('\n'); syncScroll();
  }
  function syncScroll() {
    // Match the input's content viewport, including the space taken by native
    // scrollbars, so the mirrors can reach the same final row and column.
    highlighted.style.width = code.clientWidth + 'px'; highlighted.style.height = lineNumbers.style.height = code.clientHeight + 'px';
    highlighted.scrollTop = lineNumbers.scrollTop = code.scrollTop; highlighted.scrollLeft = code.scrollLeft;
  }
  code.onscroll = syncScroll;
  code.oninput = () => { sourceGeneration++; highlight(); clearTimeout(timer); if (code.value === validSource) compile(); else timer = setTimeout(compile, 260); updateButtons(); };
  function insertCode(text) { if (!document.execCommand('insertText', false, text)) { code.setRangeText(text, code.selectionStart, code.selectionEnd, 'end'); code.dispatchEvent(new Event('input')); } }
  code.onkeydown = event => {
    if (event.key === 'Tab') { event.preventDefault(); insertCode('  '); }
    else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); const at = code.selectionStart, prefix = code.value.slice(0, at).split('\n').at(-1), indent = prefix.match(/^\s*/)[0] + (prefix.trimEnd().endsWith('{') ? '  ' : ''); insertCode('\n' + indent); }
  };
  function compile() {
    clearTimeout(timer); if (disposed) return;
    try {
      assertShaderSource(code.value);
      if (!pipeline.ensure(draftOutput)) throw Error(tr('webgl'));
      if (!pipeline.compile('draft', code.value)) throw Error(pipeline.lastError || tr('compileError'));
      validSource = code.value; diagnostic.textContent = ''; diagnostic.hidden = true; values = {}; defaults = {}; parameterFields = [];
      params.replaceChildren();
      for (const parameter of shaderParameters(code.value)) {
        defaults[parameter.name] = parameter.value;
        const label = el('label', 'field'), input = el('input'); label.append(parameter.name, input); input.value = Array.isArray(parameter.value) ? parameter.value.join(', ') : parameter.value; input.ariaLabel = parameter.name;
        input.oninput = () => { const parsed = input.value.split(',').map(n => n.trim()); if (parsed.length !== parameter.dimensions || parsed.some(n => !n || !Number.isFinite(Number(n)))) { input.setCustomValidity(tr('invalidValue')); return; } input.setCustomValidity(''); values[parameter.name] = parameter.dimensions === 1 ? Number(parsed[0]) : parsed.map(Number); draw(); }; parameterFields.push({ parameter, input }); params.append(label);
      }
      const current = getContext(), schema = Object.fromEntries(shaderUniforms(code.value).map(p => [p.name, p]));
      const problems = chartPath && current?.session === session ? chartShaderEvents(session.chart).filter(event => shaderAssetPath(current.assets, event.shader, current.chartName) === chartPath).flatMap(event => shaderVariableProblems(event, schema)) : [];
      if (problems.length) { diagnostic.hidden = false; diagnostic.textContent = [...new Set(problems.map(problem => t('diag.' + problem.code, { name: problem.name, shader: name.value, type: problem.type })))].join('\n') + '\n' + tr('checkAfterSave'); }
      status(tr('compiled')); draw();
    } catch (error) { diagnostic.hidden = false; diagnostic.textContent = error.message; status(tr('compileError'), true); }
    updateButtons();
  }
  function captureScene() {
    if (getContext()?.session !== session) return;
    scene.value = 'chart'; refreshScene = true; liveScene?.preview.noisePreview.gpu?.reset(); status(tr('snapshot')); draw();
  }
  function paintTest() {
    const c = source.getContext('2d'), gradient = c.createLinearGradient(0, 0, 960, 540); gradient.addColorStop(0, '#13233c'); gradient.addColorStop(.5, '#71354d'); gradient.addColorStop(1, '#e8a151'); c.fillStyle = gradient; c.fillRect(0, 0, 960, 540);
    c.strokeStyle = '#ffffff28'; c.lineWidth = 1; for (let x = 0; x < 960; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 540); c.stroke(); } for (let y = 0; y < 540; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(960, y); c.stroke(); }
    c.fillStyle = '#efdfaa'; c.fillRect(80, 440, 800, 3); const colors = ['#6ee3ff', '#ffe27c', '#f0a0b6']; for (let i = 0; i < 9; i++) { c.fillStyle = colors[i % 3]; c.fillRect(150 + i % 3 * 260, 100 + Math.floor(i / 3) * 100, 120, 12); } c.font = '600 28px system-ui'; c.fillStyle = '#fff'; c.fillText('RPEN / GLSL', 80, 75);
  }
  scene.onchange = () => { last = 0; waiting = false; if (scene.value === 'test') paintTest(); else refreshScene = true; draw(); };
  function syncPlayback() { play.replaceChildren(curveIcon(playing ? 'pause' : 'play')); play.setAttribute('aria-pressed', String(playing)); }
  function requestDraw() { if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(tick); }
  function tick(timestamp) {
    frame = 0; if (disposed || document.hidden) return;
    if (playing && last && timestamp - last < 1000 / 30) { requestDraw(); return; }
    if (playing && last && !waiting) seconds += Math.min(.1, Math.max(0, (timestamp - last) / 1000));
    last = timestamp; draw();
  }
  function draw() {
    if (disposed) return;
    try {
      let image, sample = { ...defaults, ...values };
      if (validSource && scene.value === 'chart') {
        const current = getContext(); if (current?.session !== session) return;
        liveScene ??= new ShaderPreviewScene(requestDraw, message => { playing = false; syncPlayback(); status(message, true); });
        liveScene.configure(validSource, { path: chartPath, targets: previewTargets, defaults, parameters: values });
        image = liveScene.draw(current, seconds, { refresh: refreshScene }); refreshScene = false; waiting = !image;
        sample = liveScene.values ?? sample;
      } else if (validSource) {
        waiting = false;
        if (pipeline.render(source, draftOutput, [{ shader: 'draft', values }], seconds, () => validSource, { left: 0, top: 0, width: 960, height: 540, scale: 1 }, { width: 960, height: 540 })) image = draftOutput;
      }
      if (image) {
        if (output.width !== image.width || output.height !== image.height) { output.width = image.width; output.height = image.height; }
        outputWrap.style.aspectRatio = `${image.width} / ${image.height}`;
        const context = output.getContext('2d'); context.clearRect(0, 0, output.width, output.height); context.drawImage(image, 0, 0);
        for (const { parameter, input } of parameterFields) { const value = sample[parameter.name]; if (document.activeElement !== input && value !== undefined) input.value = Array.isArray(value) ? value.join(', ') : String(value); }
      }
    } catch (error) { playing = false; syncPlayback(); status(error.message, true); }
    if (!playing && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (document.activeElement !== time) time.value = seconds.toFixed(1);
    if (playing) { if (!last) last = performance.now(); requestDraw(); }
  }
  async function saveTemplate(copy) {
    if (busy) return; busy = true; updateButtons();
    try {
      const current = getContext(); if (current?.session !== session) throw Error(tr('stale'));
      if (code.value !== validSource) throw Error(tr('compileError'));
      if (chartPath && !copy) {
        if (!name.value.trim()) throw Error(tr('nameRequired'));
        const text = namedShaderSource(code.value, { ...chartInfo, name: name.value, chart: chartNamePrefix(session.chart, current.chartName) }); assertShaderSource(text);
        const bytes = new TextEncoder().encode(text); chartBytes = replaceShaderResource(current, chartPath, bytes, chartBytes); chartInfo = shaderSourceInfo(text); savedText = code.value; savedName = name.value = chartInfo.name;
        refreshChoices(); selectedChoice = choices.value = 'chart:/' + chartPath; current.diagnostics?.update(); status(t('shader-editor.savedChart', { name: shaderAssetLabel(chartPath, current.assets, session.chart, current.chartName) }));
      } else {
        const generation = sourceGeneration, draft = code.value, title = name.value;
        const entry = await saveShaderTemplate({ id: copy ? undefined : draftId, name: title, source: draft }, { source: savedSource, name: savedName }); if (disposed || getContext()?.session !== session || generation !== sourceGeneration || code.value !== draft || name.value !== title) return;
        chartPath = chartBytes = chartInfo = null; draftId = entry.id; savedSource = savedText = entry.source; savedName = name.value = entry.name; library = readShaderLibrary(); refreshChoices(); selectedChoice = choices.value = 'library:' + entry.id; status(tr('saved'));
      }
    }
    finally { busy = false; updateButtons(); }
  }
  async function applyToSelection() {
    if (busy) return; const current = getContext(), before = session.chart, selection = signature();
    if (current?.session !== session || !selectionValid || selection !== initialSelection || code.value !== validSource) throw Error(tr('stale'));
    const draft = code.value;
    busy = true; updateButtons();
    try {
      const resource = chartPath ? { path: chartPath, shader: '/' + chartPath, bytes: chartBytes } : await materializeShader({ id: draftId && !dirty() ? draftId : undefined, origin: 'draft:' + draftIdentity, source: draft, name: name.value || 'Shader' }, current.assets, chartNamePrefix(session.chart, current.chartName));
      if (disposed || getContext()?.session !== session || session.chart !== before || signature() !== selection || code.value !== draft) throw Error(tr('stale'));
      if (!current.assets.has(resource.path)) current.addAsset(resource.path, resource.bytes);
      transformEvents(session, tr('applied'), (event, type) => type === 'paintEvents' ? { ...event, shader: resource.shader, clone: false, vars: event.shader === resource.shader ? event.vars : {} } : event);
      loadDraft(shaderText(current.assets.get(resource.path)), name.value, null, resource.path); refreshChoices(); selectedChoice = choices.value = 'chart:/' + chartPath;
      status(tr('applied')); current.invalidate();
    } finally { busy = false; updateButtons(); }
  }
  function changed() {
    const current = getContext(); selectionValid = current?.session === session && signature() === initialSelection;
    if (chartPath && current?.session === session && current.assets.get(chartPath) !== chartBytes && !busy) {
      const bytes = current.assets.get(chartPath);
      if (bytes && !dirty()) { loadDraft(shaderText(bytes), name.value, null, chartPath); refreshChoices(); selectedChoice = choices.value = 'chart:/' + chartPath; }
      else status(tr('fileConflict'), true);
    }
    if (!selectionValid && !chartPath) status(tr('stale'), true); updateButtons(); draw();
  }
  session.addEventListener('change', changed);
  function keyboard(event) {
    if (!root.contains(event.target)) return;
    if (event.type === 'keydown') { if (event.target === code) code.onkeydown?.(event); else if (event.target === search) search.onkeydown?.(event); }
    event.stopImmediatePropagation();
    if (event.type === 'keyup' || event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveTemplate(false).catch(error => status(error.message, true)); }
    else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compile(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.focus(); search.select(); }
    else if (event.key === 'Escape') { event.preventDefault(); if (!busy && (!dirty() || confirm(tr('discard')))) dispose(); }
  }
  root.handleShaderKey = keyboard;
  window.addEventListener('keydown', keyboard, true); window.addEventListener('keyup', keyboard, true);
  function layout() {
    const width = maximized ? innerWidth - 16 : Math.min(Math.max(640, prefs.width || 1200), innerWidth - 16), height = maximized ? innerHeight - 16 : Math.min(Math.max(420, prefs.height || 760), innerHeight - 16);
    const left = maximized ? 8 : Math.max(8, Math.min(prefs.left ?? (innerWidth - width) / 2, innerWidth - width - 8)), top = maximized ? 8 : Math.max(8, Math.min(prefs.top ?? (innerHeight - height) / 2, innerHeight - height - 8));
    Object.assign(root.style, { width: width + 'px', height: height + 'px', left: left + 'px', top: top + 'px' }); root.classList.toggle('compact', width < 880);
  }
  const remember = () => { if (disposed || maximized) return; const r = root.getBoundingClientRect(); prefs = { width: r.width, height: r.height, left: r.left, top: r.top }; localPreferences.setItem('rpen-shader-window-v1', JSON.stringify(prefs)); };
  header.onpointerdown = event => { if (event.button || event.target.closest('button') || maximized) return; const rect = root.getBoundingClientRect(); drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }; header.setPointerCapture(event.pointerId); event.preventDefault(); };
  header.onpointermove = event => { if (!drag) return; root.style.left = Math.max(0, Math.min(innerWidth - 80, drag.left + event.clientX - drag.x)) + 'px'; root.style.top = Math.max(0, Math.min(innerHeight - 40, drag.top + event.clientY - drag.y)) + 'px'; };
  header.onpointerup = event => { if (!drag) return; drag = null; header.releasePointerCapture(event.pointerId); remember(); };
  header.onpointercancel = () => { drag = null; remember(); };
  const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(remember, 250); root.classList.toggle('compact', root.clientWidth < 880); syncScroll(); });
  observer.observe(code);
  function visibility() { last = 0; if (!document.hidden) draw(); else { cancelAnimationFrame(frame); frame = 0; } }
  document.addEventListener('visibilitychange', visibility); window.addEventListener('resize', layout);
  function dispose() {
    if (disposed) return; remember(); disposed = true; sourceGeneration++; cancelAnimationFrame(frame); clearTimeout(timer); clearTimeout(resizeTimer); observer.disconnect(); liveScene?.dispose(); pipeline.dispose();
    session.removeEventListener('change', changed); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('keyup', keyboard, true); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', layout);
    root.hidePopover?.(); root.remove(); root.replaceChildren(); source.width = source.height = draftOutput.width = draftOutput.height = 1; if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); options.onDispose?.(root);
  }
  document.body.append(root); root.showPopover?.(); layout(); observer.observe(root); refreshChoices();
  let text = SHADER_PRESETS[0].source, initialError;
  if (options.reference) { try { text = await readShaderSource(options.reference, initial.assets, initial.chartName); } catch (error) { initialError = error.message; } }
  if (disposed || getContext()?.session !== session) { dispose(); return { dispose }; }
  const initialPath = !initialError && shaderAssetPath(initial.assets, options.reference, initial.chartName);
  loadDraft(text, options.reference ? canonicalShaderName(options.reference) || options.reference.split('/').at(-1).replace(/\.[^.]+$/, '') : '', null, initialPath || null);
  if (initialPath) selectedChoice = choices.value = 'chart:/' + initialPath; if (initialError) status(initialError, true); root.focus();
  return { dispose, root };
}
