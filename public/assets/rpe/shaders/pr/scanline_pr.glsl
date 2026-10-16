#version 100
precision highp float;

varying vec2 uv;

uniform sampler2D screenTexture; // 屏幕材质
uniform vec2 screenSize; // 屏幕大小
uniform float time; // 时间
uniform float power; // %0.5%

void main()
{
    // 读取当前像素的颜色
    vec4 color = texture2D(screenTexture, uv);
    
    // 获取当前像素的y坐标（范围是0到1）
    float scanline = sin((uv.y * 800.0 + time * 5.0) * 3.14159 * 2.0); // 模拟扫描线
    float intensity = 1.0 - power * (scanline * 0.5 + 0.5);
    
    // 将扫描线的效果应用到颜色上
    color.rgb *= intensity;
    
    // 设置透明度
    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}
