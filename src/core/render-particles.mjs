// Adapted from Autoplay Studio 1.1.8 by NyamonZone; integrated RPEN renderer.
/**
 * 打击粒子（模组自带一份）。
 *
 * 之前靠 `@rpen/core/editor-display.mjs` 的 hitParticles，参数一改就得跟着编辑器版本走；
 * 换一个 rpen 版本、或者 APP 里内置的 web 包没同步，渲染器的手感就和试玩不一致。
 * 所以这里复制一份实现，Autoplay Studio 自己画粒子（默认皮肤路径），
 * 参数独立于核心，模组包到哪都是同一套。
 *
 * 曲线：有理函数缓动（拟合官方粒子的外扩轨迹），末段连带收缩半径，
 * 让「淡出 + 微缩」同时发生。
 */
export const HIT_PARTICLE_SECONDS = 2 / 3;

// 粒子大小（半径）缩放：原尺寸的 105%。
export const HIT_PARTICLE_SCALE = 1.05;

// 扩散距离：1.1 是原始系数，0.85 是上一版的整体缩放，1.3 是「飞得太近」的修正，
// 1.03 是在这个结果上再加 3%（只乘一次，不要重复叠）。
export const HIT_PARTICLE_REACH = 1.1 * 0.85 * 1.3 * 1.03;

/** 粒子外扩缓动：t(80.3542231806 + 6236.3848902154t + 850.3997391752t²) / (1 + 495.7977913926t + 6570.5817658876t²) */
export function particleEasing(t) {
  const time = Math.max(0, Math.min(1, Number(t) || 0));
  return time * (850.3997391752 * time * time + 6236.3848902154 * time + 80.3542231806)
    / (6570.5817658876 * time * time + 495.7977913926 * time + 1.0);
}

// 末段收缩幅度：25.3% 再增加 15%（×1.15）。
export const HIT_PARTICLE_SHRINK = 0.253 * 1.15;

/** 收缩缓动：sine in（慢起、末段收紧）。 */
export function shrinkEasing(t) {
  const time = Math.max(0, Math.min(1, Number(t) || 0));
  return 1 - Math.cos(time * Math.PI / 2);
}

export function hitParticles(age, seed, size) {
  if (age < 0 || age >= HIT_PARTICLE_SECONDS) return [];
  // progress 覆盖粒子整个寿命（2/3 秒）。
  const progress = Math.min(1, age * 1.5);
  const spread = particleEasing(progress);
  // 最后 60% 寿命连带收半径：透明度归零时尺寸也在收，
  // 不是一颗方块啪地不见。sine-in 让末段收紧，幅度 25.3% 再 +15%。
  const shrink = progress < 0.4 ? 1 : 1 - HIT_PARTICLE_SHRINK * shrinkEasing((progress - 0.4) / 0.6);
  return Array.from({ length: 4 }, (unused, index) => {
    const random = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
    const angle = (random - Math.floor(random)) * Math.PI * 2;
    return {
      x: Math.cos(angle) * size * HIT_PARTICLE_REACH * spread,
      y: Math.sin(angle) * size * HIT_PARTICLE_REACH * spread,
      radius: size * 0.0907 * spread * shrink * HIT_PARTICLE_SCALE,
      alpha: Math.max(0, 1 - progress),
    };
  });
}
