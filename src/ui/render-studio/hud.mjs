// Adapted from Autoplay Studio 1.1.7 by NyamonZone; integrated RPEN renderer.
import { gameUiBindings } from '../../core/game-ui.mjs';

// 逆向布局（PhiHUD还原.html）：u = 画面高度 / 1623，所有 top/left/right/bottom 与字号
// 都是这个 u 的倍数。字体使用 RPEGame（cmdysj.ttf，与逆向文件内嵌的
// Source Han Sans & Saira Hybrid 共享全部字形；ascender 0.88 / descender 0.12）。
const U = 1623;
const ASC = 0.88;
const DESC = 0.12;
const PAUSE_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAApCAYAAACyXOB4AAAAiUlEQVRYhe3YQQoCMRAF0W6ZK3sKDx0ZkCAhgeo4DC7q7QTnU2TZ2VprwWVmTv88mdnefRQ+jFXQr8bdo7j3HH6/voNrj77eLb3UXYyijKKMooyijKKMooyijKKMooyijKKMooyijKKMooyijKL+Muo8xPbT7OdKOx5bd23v9pe64hw92yjvRsQbArsNzBTo85gAAAAASUVORK5CYII=';
let pausePicture = null;
let pauseCleaned = null;
function pauseIcon() {
  if (!pausePicture) {
    pausePicture = new Image();
    pausePicture.decoding = 'async';
    pausePicture.src = PAUSE_ICON;
  }
  if (!pausePicture.complete || !pausePicture.naturalWidth) return null;
  // 这张 37x41 的贴图边缘带一层灰阴影（老版素材），线上 HUD 是纯白剪影。
  // 先在离屏画布上把暗像素（阴影）清成透明，只留图标本体，再按 59u x 41/37 等比绘制。
  if (!pauseCleaned) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = pausePicture.naturalWidth; canvas.height = pausePicture.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(pausePicture, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (data[i + 3] === 0) continue;
        if (luma < 168) { data[i + 3] = 0; continue; }
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      }
      context.putImageData(image, 0, 0);
      pauseCleaned = canvas;
    } catch (error) { pauseCleaned = pausePicture; }
  }
  return pauseCleaned;
}

const alphaOf = binding => binding ? Math.max(0, Math.min(1, Number(binding.alpha ?? 255) / 255)) : 1;
const rgb = color => Array.isArray(color) && color.length >= 3 ? `rgb(${color.slice(0, 3).map(value => Math.round(Math.max(0, Math.min(255, value)))).join(',')})` : '#fff';

function lineBoxText(context, text, x, top, fontPx, align, color, alpha, wordSpacing = 0) {
  if (!text) return;
  context.save();
  context.globalAlpha *= alpha;
  context.fillStyle = color;
  context.font = `400 ${fontPx}px RPEGame, RPE, sans-serif`;
  context.textAlign = align;
  context.textBaseline = 'alphabetic';
  const baseline = top + fontPx * ASC;
  if (wordSpacing > 0) {
    const parts = String(text).split(/(\s+)/);
    const width = parts.reduce((sum, part) => sum + context.measureText(part).width + (/^\s+$/.test(part) ? wordSpacing : 0), 0);
    let cursor = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    context.textAlign = 'left';
    for (const part of parts) {
      context.fillText(part, cursor, baseline);
      cursor += context.measureText(part).width + (/^\s+$/.test(part) ? wordSpacing : 0);
    }
  } else context.fillText(String(text), x, baseline);
  context.restore();
}

function transform(context, binding, scale, x, y) {
  context.translate(x + (binding?.x ?? 0) * scale, y - (binding?.y ?? 0) * scale);
  context.rotate((binding?.rotation ?? 0) * Math.PI / 180);
  context.scale(binding?.scaleX ?? 1, binding?.scaleY ?? 1);
}

function drawScoreRows(context, x, top, u, state, alpha) {
  const rows = [
    ['PERFECT', state.counts?.[0] ?? 0],
    ['GOOD', state.counts?.[1] ?? 0],
    ['BAD', state.counts?.[2] ?? 0],
    ['MISS', state.counts?.[3] ?? 0],
    ['MAX COMBO', state.maxCombo ?? 0],
  ];
  context.save();
  context.globalAlpha *= alpha;
  context.textAlign = 'right';
  context.textBaseline = 'alphabetic';
  context.font = `400 ${30 * u}px RPEGame, RPE, sans-serif`;
  for (let index = 0; index < rows.length; index++) {
    context.fillStyle = index === 0 ? '#f6ffac' : index === 1 ? '#a7edff' : index >= 2 ? '#d0c7dd' : 'rgba(255,255,255,.82)';
    context.fillText(`${rows[index][0]} ${rows[index][1]}`, x, top + index * 38 * u + 30 * u * ASC);
  }
  context.restore();
}

function drawApBadge(context, width, height, u, text, alpha) {
  const label = text || 'AP';
  const font = 36 * u;
  const padX = 18 * u, boxW = Math.max(54 * u, (label.length * 22 + 28) * u), boxH = 52 * u;
  const x = width / 2 - boxW / 2, y = 196 * u;
  context.save();
  context.globalAlpha *= alpha;
  context.fillStyle = 'rgba(15,16,20,.64)';
  context.strokeStyle = 'rgba(255,220,112,.8)';
  context.lineWidth = Math.max(1, 2 * u);
  context.beginPath();
  context.roundRect(x, y, boxW, boxH, 12 * u);
  context.fill(); context.stroke();
  context.fillStyle = '#ffdc70';
  context.font = `400 ${font}px RPEGame, RPE, sans-serif`;
  context.textAlign = 'center'; context.textBaseline = 'alphabetic';
  context.fillText(label, width / 2, y + boxH / 2 + font * (ASC - 0.5));
  context.restore();
  void height; void padX;
}

function drawOffsetBar(context, width, height, u, seconds, hits, alpha) {
  const barW = 140 * u, barH = 12.5 * u, stroke = 3 * u;
  const cx = width / 2, cy = height * 5 / 6;
  context.save();
  context.globalAlpha = alpha * 0.42;
  context.fillStyle = '#7b7f87';
  context.fillRect(cx - barW / 2, cy - barH / 2, barW, barH);
  context.globalAlpha = alpha * 0.8;
  context.fillStyle = '#fff';
  for (const ratio of [0.25, 0.5, 0.75]) context.fillRect(cx - barW / 2 + barW * ratio - stroke / 2, cy - barH * 1.4, stroke, barH * 2.8);
  for (const hit of hits) {
    const age = seconds - hit.time;
    if (age < 0 || age > 0.42) continue;
    context.globalAlpha = alpha * (1 - age / 0.42);
    context.fillStyle = '#fff4bd';
    context.fillRect(cx - stroke / 2, cy - barH * 1.8, stroke, barH * 3.6);
  }
  context.restore();
}

/**
 * 渲染器的 Autoplay HUD。位置/字号严格按逆向 HUD；attachUI 绑定仍作为变换叠加。
 * 传入的是最终视频的 CSS 尺寸（renderer 已对 devicePixelRatio 做过反算）。
 */
export function drawAutoplayHud(context, {
  chart, skin, width, height, scale, seconds, duration, states,
  settings, state,
}) {
  if (!chart || settings.display === 'clean' || !width || !height) return;
  const u = height / U;
  const bindings = gameUiBindings(chart, states);
  const baseAlpha = Math.max(0, Math.min(1, Number(state.alpha ?? 1)));
  const colorOf = (key, fallback = '#fff') => bindings.get(key) ? rgb(bindings.get(key).color) : fallback;

  if (settings.showProgress !== false) {
    const progress = Math.max(0, Math.min(1, (Number(seconds) || 0) / Math.max(0.001, Number(duration) || 0.001)));
    if (progress > 0) {
      context.save();
      context.fillStyle = '#939393';
      context.fillRect(0, 0, width * progress, 18 * u);
      context.fillStyle = '#fff';
      const cap = 9 * u;
      context.fillRect(Math.max(0, width * progress - cap), 0, cap, 18 * u);
      context.restore();
    }
  }

  if (settings.showPause) {
    const binding = bindings.get('pause');
    context.save();
    context.globalAlpha = baseAlpha * alphaOf(binding);
    transform(context, binding, scale, 53 * u, 58 * u);
    const icon = pauseIcon();
    if (icon) context.drawImage(icon, 0, 0, 59 * u, 59 * u * 41 / 37);
    context.restore();
  }

  if (settings.showCombo !== false && (state.combo ?? 0) >= 3) {
    let binding = bindings.get('combonumber');
    context.save();
    context.globalAlpha = baseAlpha * alphaOf(binding);
    transform(context, binding, scale, width / 2, 24 * u);
    lineBoxText(context, state.combo, 0, 0, 111 * u, 'center', colorOf('combonumber'), 1, null);
    context.restore();
    if (settings.autoplayText !== '') {
      binding = bindings.get('combo');
      context.save();
      context.globalAlpha = baseAlpha * alphaOf(binding);
      transform(context, binding, scale, width / 2, 134 * u);
      lineBoxText(context, settings.autoplayText, 0, 0, 40 * u, 'center', colorOf('combo'), 1, null);
      context.restore();
    }
  }

  const scoreBinding = bindings.get('score');
  context.save();
  context.globalAlpha = baseAlpha * alphaOf(scoreBinding);
  transform(context, scoreBinding, scale, width - 58 * u, 47.5 * u);
  if (settings.display === 'information') {
    lineBoxText(context, `${((Number(state.accuracy) || 0) * 100).toFixed(2)}%`, 0, 0, 80 * u, 'right', colorOf('score'), 1, null);
    drawScoreRows(context, 0, 92 * u, u, state, 0.86);
  } else {
    lineBoxText(context, String(Math.max(0, Math.min(1000000, Math.round(Number(state.score) || 0)))).padStart(7, '0'), 0, 0, 80 * u, 'right', colorOf('score'), 1, null);
  }
  context.restore();

  if (settings.showChartName !== false) {
    const binding = bindings.get('name');
    context.save();
    context.globalAlpha = baseAlpha * alphaOf(binding);
    transform(context, binding, scale, 66 * u, height - 50 * u - 58 * u);
    lineBoxText(context, chart.META?.name ?? '', 0, 0, 58 * u, 'left', colorOf('name'), 1, null);
    context.restore();
  }
  if (settings.showChartLevel !== false) {
    const binding = bindings.get('level');
    context.save();
    context.globalAlpha = baseAlpha * alphaOf(binding);
    transform(context, binding, scale, width - 64 * u, height - 50 * u - 58 * u);
    lineBoxText(context, chart.META?.level ?? '', 0, 0, 58 * u, 'right', colorOf('level'), 1, 58 * u * 0.29);
    context.restore();
  }

  if (settings.showOffsetBar) drawOffsetBar(context, width, height, u, seconds, state.freshHits ?? [], baseAlpha);
  // 「AP 指示器」不再是角上的徽标：它控制判定线是否随判定变色（见 renderer 的 lineColor）。
  if (settings.watermark) {
    context.save();
    context.globalAlpha = baseAlpha * 0.7;
    context.fillStyle = 'rgba(255,255,255,.8)';
    context.font = `400 ${26 * u}px RPEGame, RPE, sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'alphabetic';
    context.fillText(settings.watermark, width / 2, height - 22 * u);
    context.restore();
  }
  void skin;
}
