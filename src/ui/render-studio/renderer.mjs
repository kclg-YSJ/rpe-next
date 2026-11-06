// Adapted from Autoplay Studio 1.1.7 by NyamonZone; integrated RPEN renderer.
import { Preview } from '../preview.mjs';
import { ProjectImages } from '../../platform/images.mjs';
import { RpeSkin } from '../skin.mjs';
import { ResourceNoteSkin } from '../resource-note-skin.mjs';
import { previewPositionScale } from '../../core/editor-display.mjs';
import { hitParticles as studioHitParticles, HIT_PARTICLE_SECONDS } from '../../core/render-particles.mjs';
import { noiseRenderingLayers, parseNoiseSkin } from '../../core/noise-skin.mjs';
import { installBuiltinNoiseSkin } from '../../platform/noise-skins.mjs';
import { assetUrl } from '../../core/asset-url.mjs';
import { builtinNoteSkins, readNoteSkins } from '../../platform/note-skins.mjs';
import { parseNoteSkin } from '../../core/note-skin.mjs';
import { hitFrame } from '../../core/visual-constants.mjs';
import { drawAutoplayHud } from './hud.mjs';
import { attachStudioNoise } from './noise.mjs';
import { LargeChartView } from '../large-chart-view.mjs';
import { attachRenderExtensions } from '../render-extensions.mjs';
import { emitModHook } from '../../core/mod-hooks.mjs';
import { checkRenderAbort, renderAwait } from '../../core/render-task.mjs';
import { t } from '../../i18n.mjs';

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));

// 播放器默认音符宽度（1350 舞台坐标）。音符大小设置用百分比表示，100% 就是它。
const BASE_NOTE_SIZE = 175;
const WHITE = { rgb: [255, 255, 255], alpha: 1 };
const lineColorPacks = new WeakMap();

/**
 * 判定线颜色（AP 指示）：Preview 只读 skin.resourcePack.perfectColor。
 * 这里绝不能写成 { ...pack, perfectColor } —— ResourceNoteSkin 是 class，
 * hold / head / drawHit / noteImage 都在原型上，展开会把它们全部丢掉，
 * 结果就是 this.resourcePack.hold is not a function、音符整片消失。
 * 用 Proxy 代理原对象，只拦 perfectColor，方法仍然在真身上调用。
 */
function lineColorPack(pack, perfectColor) {
  const key = perfectColor === WHITE ? 'white' : 'skin';
  const cached = lineColorPacks.get(pack);
  if (cached?.key === key) return cached.proxy;
  const proxy = new Proxy(pack, {
    get(target, property) {
      if (property === 'perfectColor') return perfectColor;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  });
  lineColorPacks.set(pack, { key, proxy });
  return proxy;
}


function upperBound(array, value) {
  let low = 0, high = array.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (array[middle] < value) low = middle + 1; else high = middle;
  }
  return low;
}

export async function noteSkinChoices(editor) {
  const records = new Map();
  records.set('default', null);
  if (editor?.noteSkins?.records instanceof Map) {
    for (const [id, record] of editor.noteSkins.records) records.set(id, record);
  } else {
    try {
      for (const record of await builtinNoteSkins()) records.set(record.id, record);
      for (const stored of await readNoteSkins()) {
        try {
          if (records.has(stored.id)) continue;
          records.set(stored.id, parseNoteSkin(new Map(stored.files), stored.id));
        } catch { /* 跳过损坏皮肤 */ }
      }
    } catch { /* 没有皮肤目录时只保留默认 */ }
  }
  return records;
}

// RpeSkin.load() 要解 40 多张贴图；换皮肤时重建实例会让预览卡住一两秒，
// 而且旧实例可能在上一帧还被引用。这里整个会话只建一次，换皮肤只换 resourcePack。
const baseSkins = new WeakMap();
function baseSkinFor(owner) {
  if (!baseSkins.has(owner)) {
    baseSkins.set(owner, (async () => {
      const skin = new RpeSkin(() => {});
      await skin.load();
      return skin;
    })());
  }
  return baseSkins.get(owner);
}

/**
 * 噪域皮肤：播放器要自己把内置 NoiseField 装进 assets，否则 noisePreview 找不到
 * shader/NoiseField/main.glsl，会退回「整屏半透明色块」甚至什么都不画。
 * 装进副本，避免污染编辑器的 assets（那会在保存时多出一堆没用的文件）。
 */
async function installNoiseFieldSkin(assets) {
  const read = async path => {
    const response = await fetch(assetUrl('noise-skins/' + path), { cache: 'force-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + path);
    return new Uint8Array(await response.arrayBuffer());
  };
  const catalogue = JSON.parse(new TextDecoder().decode(await read('index.json')));
  const entry = Array.isArray(catalogue) ? catalogue.find(item => item?.name === 'NoiseField') : null;
  if (!entry || !Array.isArray(entry.files)) throw new Error(t('render.ui.c2f8f37b2'));
  const files = new Map();
  for (const path of entry.files) files.set(path, await read(entry.name + '/' + path));
  const installed = installBuiltinNoiseSkin({ ...parseNoiseSkin(files), name: entry.name, files }, assets);
  for (const [path, bytes] of installed.entries) assets.set(path, bytes);
  return installed.root;
}


export class AutoplayScene {
  constructor(project, settings, { purpose = 'preview', signal, overlays } = {}) {
    this.signal = signal; this.purpose = purpose; this.overlays = overlays;
    this.project = project;
    this.settings = settings;
    this.chart = project.chart;
    this.tempo = project.tempo;
    this.width = settings.width;
    this.height = settings.height;
    this.dpr = Math.max(1, Math.min(4, Number(globalThis.devicePixelRatio) || 1));
    this.output = document.createElement('canvas');
    this.output.width = this.width;
    this.output.height = this.height;
    this.context = this.output.getContext('2d', { alpha: false });
    this.renderCanvas = document.createElement('canvas');
    this.renderCanvas.style.width = `${this.width / this.dpr}px`;
    this.renderCanvas.style.height = `${this.height / this.dpr}px`;
    // Preview 通过 getBoundingClientRect 决定 backing store；离屏渲染时给一个与目标分辨率
    // 完全对应的 CSS 矩形，让 devicePixelRatio 只负责像素缩放，不改变 UI 比例。
    this.renderCanvas.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: this.width / this.dpr, bottom: this.height / this.dpr,
      width: this.width / this.dpr, height: this.height / this.dpr,
      toJSON() { return {}; },
    });
    this.preview = new Preview(this.renderCanvas);
    if (project.large) {
      this.largeOwner = { summary: project.large, revision: project.large.revision, pageGeneration: 0, locations: new Map() };
      this.largeView = new LargeChartView(this.largeOwner); this.preview.largeChartView = this.largeView;
    }
    this.images = new ProjectImages(() => {}, message => console.warn('[autoplay-studio] ' + message));
    this.preview.visible = true;
    this.preview.images = this.images;
    // 噪域要拿到谱面素材和内置皮肤；副本避免把皮肤文件写回编辑器项目。
    this.noiseAssets = new Map(project.assets ?? []);
    this.preview.noisePreview.getAssets = () => this.noiseAssets;
    this.preview.noisePreview.seamless = true;
    this.preview.noisePreview.invalidate = () => {};
    this.preview.noisePreview.report = message => console.warn(t('render.ui.a530991cd') + message);
    // overlay 合成和默认皮肤仅用于渲染；几何缩放与普通预览共用。
    this.noise = attachStudioNoise(this.preview, {
      report: message => console.warn(t('render.ui.a530991cd') + message),
    });
    // HUD 交给 Preview 的 drawUi 画：它的调用点正好在「普通 shader 之后、噪域之前」，
    // 于是合成顺序天然是 场景 → 普通 shader → HUD → 噪域 → 全局 shader，
    // 和编辑器预览 / 试玩完全一致（HUD 之上压噪域，噪域之上再吃全局 shader）。
    this.preview.showGameUI = true;
    this.preview.drawUi = (context, chart, tempo, seconds, selectedLine, frame) => this.paintHud(context, frame, seconds);
    this.preview.drawRenderHits = (context, chart, tempo, seconds, selectedLine, frame) => { if(this.hudEnabled)this.paintHitEffects(context,frame,seconds); };
    this.preview.aspectRatio = this.width / this.height;
    this.preview.allLines = true;
    // 打击特效（命中贴图 + 粒子）由模组整体接管，见 paintHitEffects()：
    // 原生路径把粒子和贴图绑在一起，关掉就丢贴图、开着就改不了粒子参数。
    this.preview.showHitEffects = false;
    this.preview.showHitEffect = false;
    this.preview.lineNumbers = false;
    this.preview.lineArrows = false;
    // 双押提示贴图：Preview 用 preview.highlight 决定同时按的音符是否换成 *_mh 贴图。
    // 这里默认开，具体值在 applySettings 里按设置项覆盖（曾经写死 false，导致双押永远没高亮）。
    this.preview.highlight = true;
    this.preview.forceLineOpacity = false;
    this.preview.viewportOverflow = false;
    this.preview.applyShaders = true;
    this.preview.effectsSince = 0;
    this.positionScale = previewPositionScale(this.preview.aspectRatio);
    // 时间线状态：lastRenderSeconds 用于识别跳变，lastHudSeconds 只服务 HUD 命中计数。
    this.lastRenderSeconds = null;
    this.lastHudSeconds = -Infinity;
    this.lastCompleted = 0;
    this.noteSkinRecord = null;
    this.disposed = false;
    this.hudEnabled = true;
    this.releaseExtensions = attachRenderExtensions(this.preview, purpose);
  }

  async init(noteSkinRecord = null) {
    await this.images.load(this.chart, this.project.assets, this.project.chartName, this.project.info ?? {});
    if (this.project.largeCover) this.images.background = this.project.largeCover;
    await this.preloadImages();
    if ((this.chart.blockAreaList?.length ?? 0) > 0) {
      try { this.noise?.setDefaultSkin(await installNoiseFieldSkin(this.noiseAssets)); }
      catch (error) { console.warn(t('render.ui.961c21531'), error); }
    }
    await this.setNoteSkin(noteSkinRecord);
    checkRenderAbort(this.signal);
    this.applySettings(this.settings);
    const first = Number(this.settings.start) || 0;
    await this.prepare(first, this.signal); this.render(first, { hud: false });
    await this.ready(this.signal);
    return this;
  }
  async prepare(seconds, signal = this.signal) {
    checkRenderAbort(signal); this.project.assertCurrent?.();
    if (this.largeView && !this.largeView.contains(seconds)) {
      this.preview.scene.compile(this.chart, this.tempo);
      const states = this.preview.scene.sample(seconds), maximum = states.reduce((m,s) => Math.max(m, Math.hypot(s.x,s.y)), 0);
      const radius = Math.min(20000, (2000 + maximum) / this.positionScale.y);
      this.largeView.set(await this.project.readWindow(seconds, radius, signal, Math.max(.75, Number(this.skin?.hitLifetime)||0)));
    }
  }
  async ready(signal = this.signal) {
    if (this.preview.shaderRuntime.loading.size) {
      const deadline=performance.now()+10000;
      while(this.preview.shaderRuntime.loading.size&&performance.now()<deadline) await renderAwait(new Promise(resolve=>setTimeout(resolve,10)),signal);
      if (this.preview.shaderRuntime.loading.size) throw Error(t('render.resourcesTimeout'));
    }
    if (this.settings.shaders !== false && this.preview.shaderRuntime.errors.size) throw Error([...this.preview.shaderRuntime.errors.values()][0]);
    if (this.settings.shaders !== false && this.preview.shaderPipeline.activeError) throw Error(this.preview.shaderPipeline.activeError);
    for (const skin of this.preview.noisePreview.gpu?.skins?.values() ?? []) if (skin.ready) { await renderAwait(skin.ready,signal); if(skin.error)throw skin.error; }
    if (typeof document !== 'undefined') await renderAwait(document.fonts.ready,signal);
  }
  async frame(seconds, options = {}) {
    await this.prepare(seconds, options.signal ?? this.signal);
    // Shader programs and noise textures must exist before the first captured frame.
    if (!this.resourcesReady) { this.render(seconds,options); await this.ready(options.signal ?? this.signal); this.preview.noisePreview.gpu?.reset(); this.resourcesReady=true; }
    return this.render(seconds,options);
  }
  reset() { this.lastRenderSeconds=null;this.lastCompleted=0;this.lastHudSeconds=-Infinity;this.preview.effectsSince=0;this.preview.noisePreview.gpu?.reset(); }
  async preloadImages() {
    const names = new Set([this.images.backgroundName, ...(this.chart.judgeLineList ?? []).map(line => line.Texture)].filter(Boolean));
    await Promise.all([...names].map(async name => {
      const record = this.images.describe(name);
      if (!record) return;
      this.images.texture(name, 1);
      if (record.pending) await record.pending;
    }));
  }

  /**
   * 换音符皮肤：串行化 + 先备好新资源再换，绝不在渲染中途把旧资源丢掉。
   * 上一次切换没完成时新的排队等它，避免两次 prepare 交错把 pack 互相 dispose。
   */
  async setNoteSkin(record) {
    this.noteSkinRecord = record ?? null;
    const run = async () => {
      const skin = await baseSkinFor(this);
      const previous = this.noteSkinPack;
      let resource = null;
      if (record) resource = await ResourceNoteSkin.prepare({ ...record, info: structuredClone(record.info) }, skin.tintedSource.bind(skin));
      if (this.disposed || this.signal?.aborted) { resource?.dispose?.(); return; }
      this.noteSkinPack = resource;
      // setResourcePack 内部会 dispose 上一个 pack（包括我们包的 Proxy → 真身）。
      skin.setResourcePack(resource);
      this.skin = skin;
      this.skinResource = resource;
      this.preview.skin = skin;
      this.preview.showHitEffects = false;
      this.applyLineColor();
      void previous;
    };
    this.skinSwitching = (this.skinSwitching ?? Promise.resolve()).then(run, run);
    await this.skinSwitching;
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.output.width = width; this.output.height = height;
    this.renderCanvas.style.width = `${width / this.dpr}px`;
    this.renderCanvas.style.height = `${height / this.dpr}px`;
    this.preview.aspectRatio = width / height;
    this.positionScale = previewPositionScale(this.preview.aspectRatio);
    this.applySettings(this.settings);
    this.lastRenderSeconds = null;
    this.lastHudSeconds = -Infinity;
    this.lastCompleted = 0;
  }

  applySettings(settings) {
    this.settings = settings;
    // 音符大小用百分比存，播放器里 100% 对应 175（1350 舞台坐标）。
    this.preview.noteSize = BASE_NOTE_SIZE * (Math.max(10, Number(settings.noteScale) || 100) / 100);
    this.preview.lineScale = Number(settings.lineScale) || 1;
    this.preview.backgroundAlpha = 1 - clamp01(settings.backgroundDim);
    // 1080p 下的 px 数作为基准，其他分辨率按高度等比换算；Preview 接收 CSS px。
    this.preview.backgroundBlur = Math.max(0, Number(settings.backgroundBlur) || 0) * (this.height / 1080) / this.dpr;
    this.applyLineColor();
    this.preview.applyShaders = settings.shaders !== false;
    // 原生机制恒关（否则会和模组画的重复）；具体开关在 paintHitEffects 里判断。
    this.preview.showHitEffects = false;
    // 双押提示：同时按的音符换用皮肤包的 *_mh 贴图（尺寸按 highlightScale 放大）。
    this.preview.highlight = settings.noteHighlight !== false;
    try {
      const layers = noiseRenderingLayers(this.chart);
      this.preview.noisePreview.hiddenLayers = settings.noise === false ? new Set(layers.map(layer => layer.id)) : new Set();
      this.preview.noisePreview.forceSimple = false;
    } catch (error) { console.warn(t('render.ui.cc1f4460e'), error); }
    this.lastRenderSeconds = null;
    this.lastHudSeconds = -Infinity;
    this.lastCompleted = 0;
  }

  /**
   * 判定线颜色（AP 指示）：关掉时线恒白；开启时跟皮肤包 perfectColor 走
   * （真机判定里 Good/Miss 会把线切成 good/bad 色，Autoplay 全 Perfect 所以稳定是完美色）。
   */
  applyLineColor() {
    const pack = this.noteSkinPack ?? null;
    if (!this.skin) return;
    if (!pack) { this.skin.resourcePack = null; return; }
    const wanted = this.settings?.skinPolicy === 'skin' ? (pack.perfectColor ?? WHITE)
      : this.settings?.showApBadge === false ? WHITE : (pack.perfectColor ?? WHITE);
    this.skin.resourcePack = lineColorPack(pack, wanted);
  }

  render(seconds, { hud = true } = {}) {
    if (this.disposed) return this.output;
    checkRenderAbort(this.signal); this.project.assertCurrent?.();
    const time = Math.max(0, Number(seconds) || 0);
    this.hudEnabled = hud;
    // 打击效果的时间窗口（Preview 用 effectsSince 当 recentHits 的下界）只在
    // 「明确的时间跳变」时重置：拖动进度条、重新开始、换渲染区间。
    // 之前这里每帧都做 Math.min(effectsSince, time)，再叠加 paintHud 里 1ms 级的
    // 回退判定，只要音频时钟抖一下就会把窗口推到当前时刻 —— 表现就是粒子闪一下、
    // 然后整片消失约 0.6 秒（旧粒子全被 since 挡在窗口外）。
    const previous = this.lastRenderSeconds;
    // previous === null 表示新的一段渲染（刚打开面板 / 刚渲染完开始编码）：
    // 必须把窗口对齐到起点，否则上一次播放停在 300s，effectsSince 还是 300，
    // 从 0 开始渲染的整段视频就一个打击粒子都出不来。
    if (previous === null || time + 0.05 < previous || time - previous > 1) {
      this.preview.effectsSince = time;
      this.lastCompleted = 0;
      this.lastHudSeconds = -Infinity;
    }
    this.lastRenderSeconds = time;
    // 全局 shader 吃的是「场景 + HUD + 噪域」整帧，结果只落在 shaderCanvas 里，
    // 所以有全局 shader 时最终画面以它为准（HUD/噪域已经在里面了）。
    const modView = emitModHook('preview:before', { chart: this.chart, seconds: time, lineIndex: 0, purpose: this.purpose });
    this.preview.draw(modView.chart, this.tempo, modView.seconds, modView.lineIndex);
    this.overlays?.(this.preview, { target: 'preview', chart: modView.chart, tempo: this.tempo, seconds: modView.seconds, lineIndex: modView.lineIndex, purpose: this.purpose });
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#000';
    context.fillRect(0, 0, this.width, this.height);
    context.drawImage(this.renderCanvas, 0, 0, this.width, this.height);
    if (this.preview.shaderCanvas?.style?.visibility === 'visible') {
      context.drawImage(this.preview.shaderCanvas, 0, 0, this.width, this.height);
    }
    if (this.preview.overlayCanvas?.style?.visibility === 'visible') {
      context.drawImage(this.preview.overlayCanvas, 0, 0, this.width, this.height);
    }
    return this.output;
  }

  /** Renderer and ordinary playback share hit enumeration, cached geometry,
   * viewport culling and bounded GPU batches. A style controls appearance only;
   * it never drops newer hits when the recent-hit window is dense. */
  paintHitEffects(context, frame, seconds) {
    const preview=this.preview;
    if(!preview?.scene||this.settings.showHitEffects===false)return;
    const scale=frame?.scale??preview.viewScale??1;if(!scale)return;
    const width=frame?.width??this.width/this.dpr,height=frame?.height??this.height/this.dpr;
    const positionScale=frame?.positionScale??this.positionScale;
    const originX=width/2-(frame?.center?.x??0)*scale,originY=height/2+(frame?.center?.y??0)*scale;
    const style=this.settings.skinPolicy==='skin'?null:{
      lifetime:Math.max(HIT_PARTICLE_SECONDS,Number(this.skin?.hitLifetime)||0),
      radius:size=>Math.max(preview.skin?.hitRadius?.(size)??size,Math.abs(Number(this.noteSkinPack?.info?.hitFxScale)||1)*size*1.1),
      draw:(target,hit)=>this.drawRenderHit(target,hit),
    };
    context.save();
    try{preview.drawHits(context,Math.max(0,Number(seconds)||0),preview.scene.order??[0],originX,originY,scale,positionScale,
      frame?.viewport??{left:0,top:0,width,height},width,height,true,style);}
    finally{context.restore();}
  }

  drawRenderHit(context,{age,x,y,size,rotation,color=[255,236,160],seed}) {
    const skin=this.preview.skin,info=this.noteSkinPack?.info,particleSize=size/1.4;
    if(info&&typeof skin?.drawHit==='function'){
      const hidden=info.hideParticles;let painted=false;info.hideParticles=true;
      try{painted=skin.drawHit(context,{age,x,y,size,rotation,color,seed,good:false});}
      finally{info.hideParticles=hidden;}
      if(painted){this.paintStudioParticles(context,age,seed,x,y,particleSize*(Number(info.hitFxScale)||1),info.hitFxTinted?color:[255,255,255]);return;}
    }
    const frame=hitFrame(age),picture=frame===null?null:skin?.tinted?.('img-'+frame,color);
    if(picture)context.drawImage(picture,x-size/2,y-size/2,size,size);
    this.paintStudioParticles(context,age,seed,x,y,particleSize,color);
  }

  /** 模组自己的粒子：OutQuad 外扩 + 末段收缩，参数独立于 rpen 核心。 */
  paintStudioParticles(context, age, seed, x, y, size, color) {
    const particles = studioHitParticles(age, seed, size);
    if (!particles.length) return;
    context.save();
    context.fillStyle = `rgb(${color.join(',')})`;
    for (const particle of particles) {
      context.globalAlpha = particle.alpha;
      context.fillRect(x + particle.x - particle.radius, y + particle.y - particle.radius,
        particle.radius * 2, particle.radius * 2);
    }
    context.restore();
  }

  paintHud(context, frame, seconds) {
    if (!this.hudEnabled) return;
    // 先画打击粒子，再画 HUD：drawUi 的调用点正好在「普通 shader 之后、HUD 之前」，
    // 所以粒子的层级仍然是「场景 → 粒子 → HUD」，和官方一致。
    const states = frame?.states ?? [];
    if (!states.length) return;
    const time = Math.max(0, Number(seconds) || 0);
    const completion = this.preview.completionTimes ?? [];
    const largeScore = typeof completion.scoreAt === 'function' ? completion.scoreAt(time + 1e-6) : null;
    const completed = largeScore?.combo ?? upperBound(completion, time + 1e-6);
    // 时间倒退由 render() 统一处理（阈值 50ms）；这里只管 HUD 自己的命中计数，
    // 不要再动 preview.effectsSince —— 那会把粒子窗口一起推走。
    if (time + 0.001 < this.lastHudSeconds) this.lastCompleted = 0;
    const freshHits = [];
    if (!largeScore) for (let index = Math.max(this.lastCompleted, upperBound(completion, time - .42)); index < completed; index++) freshHits.push({ time: completion[index], offset: 0, grade: 'perfect' });
    this.lastCompleted = completed;
    this.lastHudSeconds = time;
    const total = this.project.large?.realNotes ?? completion.length;
    const state = {
      seconds: time,
      duration: this.project.duration,
      score: total ? Math.round(1000000 * completed / total) : 0,
      accuracy: 1,
      combo: completed,
      maxCombo: completed,
      counts: [completed, 0, 0, 0],
      totalNotes: total,
      earlyTotal: 0,
      lateTotal: 0,
      meanOffset: 0,
      freshHits,
      apText: 'AP',
      alpha: 1,
      chartStart: 0,
    };
    context.save();
    // 这里的 context 来自 Preview 的 prepareCanvas：已经 setTransform(devicePixelRatio)，
    // 坐标就是 CSS 像素（frame.width/height 也是 CSS 像素）。再除一次 dpr 或再乘一次
    // 变换都会把 HUD 缩成 1/dpr，看起来就是「HUD 不按游玩区域分辨率」。
    drawAutoplayHud(context, {
      chart: this.chart, skin: this.skin,
      width: frame?.width ?? this.width / this.dpr,
      height: frame?.height ?? this.height / this.dpr,
      scale: frame?.scale ?? this.preview.viewScale ?? (this.width / this.dpr) / 1350,
      seconds: time, duration: this.project.duration, states, settings: this.settings, state,
    });
    context.restore();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.skinResource?.dispose?.(); } catch { /* 忽略 */ }
    try { this.skin?.setResourcePack?.(null); } catch { /* 忽略 */ }
    try { this.images.clear(); } catch { /* 忽略 */ }
    this.releaseExtensions?.(); this.releaseExtensions=null;
    this.largeView?.dispose(); this.preview.dispose();
    this.skin?.images?.clear(); this.skin?.tints?.clear();
    this.output.width = this.output.height = 1;
    this.renderCanvas.width = this.renderCanvas.height = 1;
    this.project = null; this.chart = null; this.tempo = null; this.overlays = null; this.noiseAssets.clear();
  }
}
