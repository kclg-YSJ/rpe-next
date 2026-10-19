#version 100
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
