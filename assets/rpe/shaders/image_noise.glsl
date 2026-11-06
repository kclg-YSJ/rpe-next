#version 100
// Both branches expose the Phira GLSL 1.00 interface. The compatibility
// branch preserves old charts that explicitly selected the RPE source.
#ifdef RPEN_LEGACY_SOURCE
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



uniform float power; // %0.2%
uniform float density; // %400.0%
 // 时间变量

float rand(vec2 co) {
    return fract(sin(dot(co.xy * time * 0.05, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p);
    vec2 u = fract(p);
    u = u*u*(3.0-2.0*u);

    float res = mix(
        mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
        mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
        u.y
    );
    return res;
}

void rpenLegacyMain() {
	vec2 uv = rpenLegacyUv;
    vec4 color = rpenLegacySample(screenTexture, rpenLegacyUv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 噪点随时间变化，加入uv扰动
    float noisyFactor = noise(uv * density + time * 0.1) * 2.0 - 1.0;

    // 添加噪点
    vec4 noisyColor = color + vec4(vec3(noisyFactor) * power, 0.0);

    gl_FragColor = noisyColor;
    gl_FragColor.a = 1.0;
}
void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision highp float;

varying lowp vec2 uv;
uniform sampler2D screenTexture;
uniform float time;

uniform float power; // %0.2%
uniform float density; // %400.0%

float rand(vec2 co) {
    return fract(sin(dot(co.xy * time * 0.05, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p);
    vec2 u = fract(p);
    u = u*u*(3.0-2.0*u);

    float res = mix(
        mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
        mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
        u.y
    );
    return res;
}

void main() {
    vec4 color = texture2D(screenTexture, uv);

    // 噪点随时间变化，加入uv扰动
    float noisyFactor = noise(uv * density + time * 0.1) * 2.0 - 1.0;

    // 添加噪点
    vec4 noisyColor = color + vec4(vec3(noisyFactor) * power, 0.0);

    gl_FragColor = noisyColor;
    gl_FragColor.a = 1.0;
}
#endif
