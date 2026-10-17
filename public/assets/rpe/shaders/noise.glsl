#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float seed; // %81.0%
uniform float power; // %0.03% 0..1

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

vec2 random(vec2 pos) {
  return fract(sin(vec2(dot(pos, vec2(12.9898,78.233)), dot(pos, vec2(-148.998,-65.233)))) * 43758.5453);
}

void main() {
	vec2 uv = v_texCoord;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
	
		vec2 new_uv = uv + (random(uv + vec2(seed, 0.0)) - vec2(0.5, 0.5)) * power;
		gl_FragColor = texture2D(CC_Texture0, new_uv);
		gl_FragColor.a = 1.0;
	}
	else{
		gl_FragColor = texture2D(CC_Texture0, uv);
	}
}
