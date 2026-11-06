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





const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

uniform vec2 resolution; // %1350,900%
uniform float size; // %10.0%

void rpenLegacyMain() {

	vec2 uv = rpenLegacyUv;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;

		vec2 factor = resolution / size;
		float x = floor(uv.x * factor.x + 0.5) / factor.x;
		float y = floor(uv.y * factor.y + 0.5) / factor.y;

		x = x * 0.7031;
		y = y / 1.2 + 0.0333;

		gl_FragColor = rpenLegacySample(screenTexture, vec2(x, y));
		gl_FragColor.a = 1.0;
	}
	else{
		gl_FragColor = rpenLegacySample(screenTexture, uv);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
