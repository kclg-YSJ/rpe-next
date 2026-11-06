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





uniform vec2 resolution; // %1350,900%
uniform float size; // %10.0%

// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.0333);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);  // Example: top-right corner of the rectangle

void rpenLegacyMain() {
	vec2 uv = rpenLegacyUv;

    if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {

		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333) * 1.2;

		vec4 c = rpenLegacySample(screenTexture, rpenLegacyUv);
		float length = dot(c, c);
		vec2 pixel_size = 1.0 / resolution;
		for (float x = -size; x < size; x++) {
			for (float y = -size; y < size; ++y) {
				if (x * x + y * y > size * size) continue;

				vec2 nuv = uv + pixel_size * vec2(x, y);

				nuv.x = nuv.x * 0.7031;
				nuv.y = nuv.y / 1.2 + 0.0333;

				vec4 new_c = rpenLegacySample(screenTexture, nuv);
				float new_length = dot(new_c, new_c);
				if (new_length > length) {
					length = new_length;
					c = new_c;
				}
			}
		}
		gl_FragColor = c;
		gl_FragColor.a = 1.0;
	}
  else
  {
	gl_FragColor = rpenLegacySample(screenTexture, rpenLegacyUv);
  }
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
