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
uniform float progress; // %0.2%
uniform vec4 burnColor; // %1,0.2,0,1%
     // 用于动态噪声的时间参数

// 生成伪随机数
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// 噪声函数，基于 uv 坐标生成噪声
float noise(vec2 uv) {
    vec2 p = floor(uv);
    vec2 f = fract(uv);
    // 使用双线性插值平滑噪声
    float a = random(p);
    float b = random(p + vec2(1.0, 0.0));
    float c = random(p + vec2(0.0, 1.0));
    float d = random(p + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;
    vec4 color = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 动态噪声，使用 uv 坐标和时间生成不规则噪声
    float burnNoise = noise(uv * 10.0 + vec2(time * 0.5, time * 0.5));

    // 控制燃烧效果的进展
    float burnFactor = progress - burnNoise;


    if (burnFactor < 0.0) {
        // 未燃烧部分，保留原始颜色
        gl_FragColor = color;
		gl_FragColor.a = 1.0;
    } else {
        // 燃烧中的区域，渐变为燃烧颜色并逐渐透明
        vec4 burnedColor = mix(color, burnColor, burnFactor);
        burnedColor.a = mix(1.0, 0.0, burnFactor);
        gl_FragColor = burnedColor;
    }
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision highp float;

varying vec2 uv; // 替换 v_texCoord
uniform sampler2D screenTexture; // 替换 u_texture 和 CC_Texture0
uniform float progress; // %0.5%
uniform vec4 burnColor; // %0.5, 0.5, 0.5, 1.0%
uniform float time; // 替换 u_time
uniform vec2 screenSize; // 屏幕大小

// 生成伪随机数
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// 噪声函数，基于 uv 坐标生成噪声
float noise(vec2 uv) {
    vec2 p = floor(uv);
    vec2 f = fract(uv);
    // 使用双线性插值平滑噪声
    float a = random(p);
    float b = random(p + vec2(1.0, 0.0));
    float c = random(p + vec2(0.0, 1.0));
    float d = random(p + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vec2 uv = uv; // 使用新的 uv 变量
    vec4 color = texture2D(screenTexture, uv); // 替换 CC_Texture0 为 screenTexture

    // 动态噪声，使用 uv 坐标和时间生成不规则噪声
    float burnNoise = noise(uv * 10.0 + vec2(time * 0.5, time * 0.5));

    // 控制燃烧效果的进展
    float burnFactor = progress - burnNoise;

    if (burnFactor < 0.0) {
        // 未燃烧部分，保留原始颜色
        gl_FragColor = color;
        gl_FragColor.a = 1.0;
    } else {
        // 燃烧中的区域，渐变为燃烧颜色并逐渐透明
        vec4 burnedColor = mix(color, burnColor, burnFactor);
        burnedColor.a = mix(1.0, 0.0, burnFactor);
        gl_FragColor = burnedColor;
    }
}

#endif
