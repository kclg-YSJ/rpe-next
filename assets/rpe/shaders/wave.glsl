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


  // 控制波浪的时间
uniform float speed; // %1%
uniform vec2 direction; // %1,0%
uniform float frequency; // %10%
uniform float amplitude; // %0.02%

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return rpenLegacySample(screenTexture, uv);
	else
		return vec4(0, 0, 0, 1);
}

void rpenLegacyMain() {

	vec2 uv = rpenLegacyUv;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 计算方向向量影响下的波动
    float wave = sin(dot(uv, direction * frequency) + time * speed) * amplitude;

    // 将波动效果应用到纹理坐标上，使其沿给定方向和速度波动
    vec2 distortedTexCoord = vec2(uv.x + wave, uv.y + wave);

    gl_FragColor = getcolor(distortedTexCoord);
	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform float time;
uniform float speed; // %5.0%
uniform vec2 direction; // %1.0, 0.0%
uniform float frequency; // %30.0%
uniform float amplitude; // %0.008%

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);
vec4 getcolor(vec2 uv)
{
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(screenTexture, uv);
	else
		return vec4(0, 0, 0, 1);
}

void main() {

    // 计算方向向量影响下的波动
    float wave = sin(dot(uv, direction * frequency) + time * speed) * amplitude;

    // 将波动效果应用到纹理坐标上，使其沿给定方向和速度波动
    vec2 distortedTexCoord = vec2(uv.x + wave, uv.y + wave);

    gl_FragColor = getcolor(distortedTexCoord);
	gl_FragColor.a = 1.0;
}

#endif
