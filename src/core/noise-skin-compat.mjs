// Exact shader/config fingerprints of the built-ins shipped before guard-band
// support. Chart resources are pinned copies: adapt only their runtime view,
// without replacing an imported or edited skin merely because its name matches.
const legacy = new Map([
  ['29552:8068e241:baf581ad', 'NoiseField'],
  ['24481:85fe9955:ea87701d', 'Ocean'],
]);
export function legacyNoiseSkin(config, sources) {
  if (config.padding !== undefined) return null;
  const text = JSON.stringify(config) + '\n' + [...sources].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name,source]) => name + '\n' + source.replace(/\r\n/g,'\n').trim()).join('\n');
  let a = 2166136261, b = 5381;
  for (let index = 0; index < text.length; index++) { const value = text.charCodeAt(index); a = Math.imul(a ^ value,16777619); b = Math.imul(b,33) ^ value; }
  const name = legacy.get(`${text.length}:${(a>>>0).toString(16)}:${(b>>>0).toString(16)}`);
  if (!name) return null;
  if (name === 'Ocean') {
    sources.set('main.glsl', sources.get('main.glsl').replace('clamp(uv+waveUV,vec2(0.0),vec2(1.0))','uv+waveUV'));
    sources.set('edgeBand.glsl', sources.get('edgeBand.glsl').replace('clamp(uv + d, vec2(0.0), vec2(1.0))','uv + d'));
  }
  return { pixels: 32, screenWidth: .071, screenHeight: .071, screen: false, geometryOnly: true };
}
