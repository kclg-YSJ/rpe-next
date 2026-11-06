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





uniform float centerX; // %0.5% 0..1
uniform float centerY; // %0.5% 0..1
uniform float power; // %0.01% 0..1
uniform float sampleCount; // %6% int 1..64

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

void rpenLegacyMain() {
	vec2 uv = rpenLegacyUv;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {

		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;

		vec2 direction = uv - vec2(centerX, centerY);
		vec3 c = vec3(0.0);
		float f = 1.0 / sampleCount;
		vec2 screen_uv = uv / 2.0 + vec2(0.5, 0.5);
		for (float i = 0.0; i < 64.0; ++i) {
			if (i >= sampleCount) break;
			vec2 tuv = uv - power * direction * i;

			tuv.x = tuv.x * 0.7031;
			tuv.y = tuv.y / 1.2 + 0.0333;

			c += rpenLegacySample(screenTexture, tuv).rgb * f;
		}
		gl_FragColor = vec4(c,1.0);
	}
	else{
		gl_FragColor = rpenLegacySample(screenTexture, uv);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
