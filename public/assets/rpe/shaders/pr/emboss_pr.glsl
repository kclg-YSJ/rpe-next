#version 100
precision mediump float;

varying vec2 uv; // 材质 UV
uniform sampler2D screenTexture; // 屏幕材质
uniform vec2 screenSize;
uniform float strength; // %1.0%
uniform float time; // 时间，以秒为单位

vec4 getcolor(vec2 uv)
{
    return texture2D(screenTexture, uv);
}

void main()
{
    // 获取当前 UV 坐标
    vec2 uv = uv;
    vec4 originalColor = texture2D(screenTexture, uv);
    
    // 获取纹理像素的偏移量
    vec2 offset = vec2(1.0 / screenSize.x, 1.0 / screenSize.y);

    // 获取周围的像素颜色
    vec4 colorTL = getcolor(uv + vec2(-offset.x, -offset.y)); // 左上
    vec4 colorBR = getcolor(uv + vec2(offset.x, offset.y));   // 右下

    // Emboss 卷积核计算
    vec4 embossColor = colorTL - colorBR;

    // 调整对比度
    embossColor += vec4(0.5, 0.5, 0.5, 1.0);
    
    // 将颜色值限制在 [0.0, 1.0] 范围内
    embossColor = clamp(embossColor, 0.0, 1.0);
    
    // 混合原始颜色与 Emboss 效果颜色
    vec4 finalColor = mix(originalColor, embossColor, strength);
    
    // 设置最终颜色
    gl_FragColor = finalColor;
    gl_FragColor.a = 1.0;
}
