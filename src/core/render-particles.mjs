// Adapted from Autoplay Studio 1.1.8 by NyamonZone; integrated RPEN renderer.
/**
 * 打击粒子（模组自带一份）。
 *
 * 之前靠 `@rpen/core/editor-display.mjs` 的 hitParticles，参数一改就得跟着编辑器版本走；
 * 换一个 rpen 版本、或者 APP 里内置的 web 包没同步，渲染器的手感就和试玩不一致。
 * 所以这里复制一份实现，Autoplay Studio 自己画粒子（默认皮肤路径），
 * 参数独立于核心，模组包到哪都是同一套。
 *
 * 曲线：外扩 OutQuad（先冲出去再收速），末段连带收缩半径，让「淡出 + 微缩」同时发生。
 */
export const HIT_PARTICLE_SECONDS = 2 / 3;

export function hitParticles(age, seed, size) {
  if (age < 0 || age >= HIT_PARTICLE_SECONDS) return [];
  // progress 覆盖粒子整个寿命（2/3 秒）。
  const progress = Math.min(1, age * 1.5);
  // 外扩 OutQuad：前段快、后段收速，和官方粒子的手感一致。
  const spread = 1 - (1 - progress) ** 2;
  // 最后 60% 寿命连带收半径：透明度归零时尺寸也在收，
  // 不是一颗方块啪地不见。收缩幅度 25.3%，起点在 progress 0.4。
  const shrink = progress < 0.4 ? 1 : 1 - 0.253 * ((progress - 0.4) / 0.6) ** 2;
  return Array.from({ length: 4 }, (unused, index) => {
    const random = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    const angle = (random - Math.floor(random)) * Math.PI * 2;
    return {
      x: Math.cos(angle) * size * 1.1 * spread,
      y: Math.sin(angle) * size * 1.1 * spread,
      radius: size * 0.0907 * spread * shrink,
      alpha: Math.max(0, 1 - progress),
    };
  });
}
