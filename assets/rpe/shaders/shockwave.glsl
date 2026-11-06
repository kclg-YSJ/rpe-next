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

uniform float progress; // %0.2% 0..1
uniform float centerX; // %0.5% 0..1
uniform float centerY; // %0.5% 0..1
uniform float width; // %0.1%
uniform float distortion; // %0.8%
uniform float expand; // %10.0%

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

void rpenLegacyMain() {
	vec2 uv = rpenLegacyUv;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		float aspect = resolution.y / resolution.x;

		vec2 center = vec2(centerX, centerY);
		center.y = (center.y - 0.5) * aspect + 0.5;

		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;

		vec2 tex_coord = uv;

		tex_coord.y = (tex_coord.y - 0.5) * aspect + 0.5;
		float dist = distance(tex_coord, center);

		if (progress - width <= dist && dist <= progress + width) {
			float diff = dist - progress;
			float scale_diff = 1.0 - pow(abs(diff * expand), distortion);
			float dt = diff * scale_diff;

			vec2 dir = normalize(tex_coord - center);

			tex_coord += ((dir * dt) / (progress * dist * 40.0));

			float x = tex_coord.x * 0.7031;
			float y = ((tex_coord.y - 0.5) / aspect + 0.5) / 1.2 + 0.0333;

			gl_FragColor = rpenLegacySample(screenTexture, vec2(x,y));

			gl_FragColor += (gl_FragColor * scale_diff) / (progress * dist * 40.0);
		}
		else {

			float x = tex_coord.x * 0.7031;
			float y = ((tex_coord.y - 0.5) / aspect + 0.5) / 1.2 + 0.0333;
			gl_FragColor = rpenLegacySample(screenTexture, vec2(x, y));
		}
		gl_FragColor.a = 1.0;
	}
	else{
		gl_FragColor = rpenLegacySample(screenTexture, uv);
	}
}
void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
