#version 100
precision mediump float;

uniform vec2 lightpos; // %0.5, 0.5%
uniform float power; // %0.01%

varying vec2 uv; // 纹理坐标
uniform sampler2D screenTexture; // 输入的纹理
uniform vec2 screenSize; // 屏幕分辨率
uniform float time; // 时间

void main()
{
    vec2 norm_uv = (uv * screenSize - screenSize * 0.5) / screenSize.y;
    vec2 norm_lightpos = (lightpos * screenSize - screenSize * 0.5) / screenSize.y;

    // 采样屏幕纹理颜色
    vec4 color = texture2D(screenTexture, uv);

    // 计算当前像素与光源位置的距离
    float distance = length(norm_uv - norm_lightpos);

    // 根据距离计算炫光效果，距离越近效果越强
    float glow = power / (distance * distance);

    // 混合炫光效果和原始颜色
    vec3 finalColor = color.rgb + vec3(glow);

    // 输出最终颜色
    gl_FragColor = vec4(finalColor, 1.0);
}
