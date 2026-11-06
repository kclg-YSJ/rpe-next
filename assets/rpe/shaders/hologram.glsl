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


uniform sampler2D texture;
 // 用于时间动态效果
uniform vec4 hologramColor; // %0,1,1,1%

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

    // 颜色分离模拟 RGB 光的衍射效果
    float offset = sin(uv.y * 40.0 + time * 5.0) * 0.004;
    vec4 color;
    color.r = getcolor(uv + vec2(offset, 0.0)).r;
    color.g = getcolor(uv + vec2(0.0, 0.0)).g;
    color.b = getcolor(uv + vec2(offset, 0.0)).b;

    // 加入扫描线效果
    float scanline = sin((uv.y + time * 0.5) * 100.0) * 0.1;
    color.rgb -= scanline;

    // 应用 Hologram 颜色调制
    color *= hologramColor;

    // 模拟全息静电噪声
    float noise = fract(sin(dot(uv * time, vec2(12.9898, 78.233))) * 43758.5453);
    color.rgb += noise * 0.05;

    // 输出最终效果
    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision highp float;

varying vec2 uv; // 替换 v_texCoord
uniform sampler2D screenTexture; // 替换 u_texture 和 CC_Texture0
uniform float time; // 替换 u_time
uniform vec4 hologramColor; // %0.0, 1.0, 1.5, 1.0%
uniform vec2 screenSize; // 屏幕大小

vec4 getcolor(vec2 uv)
{
    return texture2D(screenTexture, uv); // 替换 CC_Texture0
}

void main() {
    vec2 uv = uv; // 使用新的uv变量

    // 颜色分离模拟 RGB 光的衍射效果
    float offset = sin(uv.y * 40.0 + time * 5.0) * 0.004;
    vec4 color;
    color.r = getcolor(uv + vec2(offset, 0.0)).r;
    color.g = getcolor(uv).g; // 中间通道不需要偏移
    color.b = getcolor(uv - vec2(offset, 0.0)).b;

    // 加入扫描线效果
    float scanline = sin((uv.y + time * 0.5) * 100.0) * 0.1;
    color.rgb -= scanline;

    // 应用 Hologram 颜色调制
    color *= hologramColor;

    // 模拟全息静电噪声
    float noise = fract(sin(dot(uv * time, vec2(12.9898, 78.233))) * 43758.5453);
    color.rgb += noise * 0.05;

    // 输出最终效果
    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}

#endif
