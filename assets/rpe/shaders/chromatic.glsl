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





uniform float sampleCount; // %3% int 1..64
uniform float power; // %0.01%

vec3 chromatic_slice(float t) {
    vec3 res = vec3(1.0 - t, 1.0 - abs(t - 1.0), t - 1.0);
    return max(res, vec3(0.0));
}

// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.0333);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);  // Example: top-right corner of the rectangle

void rpenLegacyMain() {

	vec2 uv = rpenLegacyUv;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x &&
			uv.y >= rectMin.y && uv.y <= rectMax.y)
	{

		uv.x= uv.x / 0.7031;
		uv.y=(uv.y - 0.0333) * 1.2;

		vec3 sum = vec3(0.0);
		vec3 c = vec3(0.0);
		vec2 offset = (uv - vec2(0.5)) * vec2(1.0, -1.0);
		int sample_count = int(sampleCount);
		for (int i = 0; i < 64; ++i) {
			if (i >= sample_count) break;
			float t = 2.0 * float(i) / float(sample_count - 1); // range 0.0->2.0
			vec3 slice = chromatic_slice(t);
			sum += slice;
			vec2 slice_offset = (t - 1.0) * power * offset;

			vec2 nuv = uv + slice_offset;

			nuv.x = nuv.x * 0.7031;
			nuv.y = nuv.y / 1.2 + 0.0333;

			if (nuv.x >= rectMin.x && nuv.x <= rectMax.x && nuv.y >= rectMin.y && nuv.y <= rectMax.y) {
				c += slice * rpenLegacyProj(screenTexture, vec4(nuv, 0.0, 1.0)).rgb;
			}
		}
		gl_FragColor = vec4(c / sum, 1.0);
	}
	else
	{
		gl_FragColor = rpenLegacySample(screenTexture, rpenLegacyUv);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
