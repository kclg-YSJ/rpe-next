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






uniform float power; // %0.03%
uniform float rate; // %0.6% 0..1
uniform float speed; // %5.0%
uniform float blockCount; // %30.5%
uniform float colorRate; // %0.01% 0..1

float my_trunc(float x) {
    return x < 0.0 ? -floor(-x) : floor(x);
}

float random(float seed) {
    return fract(543.2543 * sin(dot(vec2(seed, seed), vec2(3525.46, -54.3415))));
}


// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.0333);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);  // Example: top-right corner of the rectangle

void rpenLegacyMain() {
	vec2 uv = rpenLegacyUv;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x &&
			uv.y >= rectMin.y && uv.y <= rectMax.y)
	{

		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333) * 1.2;

		float enable_shift = float(random(my_trunc(time * speed)) < rate);

		vec2 fixed_uv = uv;
		fixed_uv.x += (random((my_trunc(uv.y * blockCount) / blockCount) + time) - 0.5) * power * enable_shift;

		fixed_uv.x = fixed_uv.x * 0.7031;
		fixed_uv.y = fixed_uv.y / 1.2 + 0.0333;

		vec4 pixel_color = rpenLegacySample(screenTexture, fixed_uv);
		pixel_color.r = mix(
			pixel_color.r,
			rpenLegacySample(screenTexture, fixed_uv + vec2(colorRate, 0.0)).r,
			enable_shift
		);
		pixel_color.b = mix(
			pixel_color.b,
			rpenLegacySample(screenTexture, fixed_uv + vec2(-colorRate, 0.0)).b,
			enable_shift
		);

		gl_FragColor = pixel_color;
		gl_FragColor.a = 1.0;
	}
	else
	{
		gl_FragColor = rpenLegacySample(screenTexture, rpenLegacyUv);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
