#version 100
precision mediump float;

varying vec2 uv;  // 材质 UV
uniform vec2 screenSize;  // 屏幕大小
uniform sampler2D screenTexture;  // 屏幕材质
uniform float power; // %0.5%

void main() {
    vec2 uvCoord = uv;
    // 从纹理获取图像的颜色
    vec4 textureColor = texture2D(screenTexture, uvCoord);
    
    // 获取纹理坐标的横纵比例
    float coordFactor = mod(uvCoord.x + uvCoord.y, 1.0);
    
    // 生成彩虹色光效果
    vec3 rainbowColor = vec3(sin(6.2831 * coordFactor), sin(6.2831 * (coordFactor + 0.33)), sin(6.2831 * (coordFactor + 0.66)));
    
    // 调整彩虹色的强度
    rainbowColor = 0.5 * rainbowColor + 0.5;
    
    // 通过 power 控制叠加彩虹色的强度
    vec4 finalColor = vec4(mix(textureColor.rgb, rainbowColor, power), textureColor.a);
    
    gl_FragColor = finalColor;
    gl_FragColor.a = 1.0;
}
