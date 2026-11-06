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






uniform float power; // %0.03%

// 生成随机噪声
float random(vec2 uv) {
    return fract(sin(dot(uv.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;
	vec4 color = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 将颜色转换为灰度
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));

    // 添加绿色滤镜
    vec3 nightVisionColor = vec3(0.1, 1.0, 0.1) * gray;

    // 添加随机噪点
    float noise = random(uv + time * 0.1);
    nightVisionColor += noise * 0.1;

    // 使用传入的 power 变量来增强亮度
    nightVisionColor = clamp(nightVisionColor * power, 0.0, 1.0);

    // 计算当前像素到屏幕中心的距离
    vec2 center = vec2(0.5, 0.5);
    float dist = distance(uv, center);

    // 控制 vignette 渐晕效果的强度和大小
    float vignette = smoothstep(0.4, 0.8, dist);

    // 将 vignette 效果应用到颜色上，边缘颜色变暗
    nightVisionColor *= (1.0 - vignette * 0.8);

    // 输出最终的颜色
    gl_FragColor = vec4(nightVisionColor, 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision highp float;

varying vec2 uv;

uniform sampler2D screenTexture;
uniform vec2 screenSize;
uniform float time;
uniform float power; // %1.5%

// 生成随机噪声
float random(vec2 uv) {
    return fract(sin(dot(uv.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
    vec2 uv = uv;
    vec4 color = texture2D(screenTexture, uv);

    // 将颜色转换为灰度
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));

    // 添加绿色滤镜
    vec3 nightVisionColor = vec3(0.1, 1.0, 0.1) * gray;

    // 添加随机噪点
    float noise = random(uv + time * 0.1);
    nightVisionColor += noise * 0.1;

    // 使用传入的 power 变量来增强亮度
    nightVisionColor = clamp(nightVisionColor * power, 0.0, 1.0);

    // 计算当前像素到屏幕中心的距离
    vec2 center = vec2(0.5, 0.5);
    float dist = distance(uv, center);

    // 控制 vignette 渐晕效果的强度和大小
    float vignette = smoothstep(0.4, 0.8, dist);

    // 将 vignette 效果应用到颜色上，边缘颜色变暗
    nightVisionColor *= (1.0 - vignette * 0.8);

    // 输出最终的颜色
    gl_FragColor = vec4(nightVisionColor, 1.0);
}

#endif
