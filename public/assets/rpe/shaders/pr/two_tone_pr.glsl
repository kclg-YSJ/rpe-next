#version 100
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform vec4 color1; // %0.0, 0.0, 0.0, 1.0%
uniform vec4 color2; // %0.6, 0.6, 1.0, 1.0%
uniform float threshold; // %0.5%

void main() {
    vec4 texColor = texture2D(screenTexture, uv);  // 获取纹理颜色
    float brightness = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));  // 计算亮度

    vec4 finalColor = brightness < threshold ? color1 : color2;  // 根据亮度应用不同颜色
    // 使用纹理的透明度来调整最终的 alpha
    gl_FragColor = vec4(finalColor.rgb, 1.0);
}
