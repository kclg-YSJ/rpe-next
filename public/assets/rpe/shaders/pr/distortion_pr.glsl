#version 100
precision mediump float;

varying vec2 uv; // 替换 v_texCoord
uniform sampler2D screenTexture; // 替换 u_texture 和 CC_Texture0
uniform float progress; // %0.5%
uniform float power; // %10.0%
uniform vec2 screenSize; // 替换 resolution
uniform float time; // 替换 u_time

void main() 
{
    // 图像中心坐标
    vec2 center = vec2(0.5, 0.5);
    
    // 计算当前纹理坐标到中心的向量
    vec2 direction = uv - center;
    
    // 计算距离与方向的旋转角度
    float distance = length(direction);
    
    // 控制扭曲效果，progress 控制强度
    float angle = progress * distance * power; 
    
    // 计算旋转后的纹理坐标
    float sinAngle = sin(angle);
    float cosAngle = cos(angle);
    vec2 twistedCoord = vec2(
        direction.x * cosAngle - direction.y * sinAngle,
        direction.x * sinAngle + direction.y * cosAngle
    );
    
    // 应用扭曲后的坐标
    vec2 finalUV = center + twistedCoord;
    
    // 从屏幕材质中采样颜色
    vec4 color = texture2D(screenTexture, finalUV);
    
    // 设置输出颜色，保持透明度为 1.0
    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}
