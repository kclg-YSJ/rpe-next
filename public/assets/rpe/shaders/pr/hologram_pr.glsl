#version 100
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
