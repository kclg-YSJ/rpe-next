#version 100
precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;
uniform float time;
vec2 rpenLegacyUv;
vec4 rpenLegacySample(sampler2D source, vec2 point) {
 vec2 local = (point - vec2(0.0, 0.0333)) / vec2(0.7031, 1.0 / 1.2);
 if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
 return texture2D(source, local);
}
vec4 rpenLegacyProj(sampler2D source, vec4 point) { return rpenLegacySample(source, point.xy / point.w); }
vec4 rpenLegacyProj(sampler2D source, vec3 point) { return rpenLegacySample(source, point.xy / point.z); }
#ifdef GL_ES
precision mediump float;
#endif





uniform float factor; // %1.0% 0..1

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

void rpenLegacyMain() {

	vec2 uv = rpenLegacyUv;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
	  vec3 color = rpenLegacySample(screenTexture, rpenLegacyUv).xyz;
	  vec3 lum = vec3(0.299, 0.587, 0.114);
	  vec3 gray = vec3(dot(lum, color));
	  gl_FragColor = vec4(mix(color, gray, factor), 1.0);
	}
	else{
		gl_FragColor = rpenLegacySample(screenTexture, uv);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
