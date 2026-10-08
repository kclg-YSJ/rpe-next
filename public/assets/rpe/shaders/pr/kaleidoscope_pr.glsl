#version 100
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform float segments; // %6.0%
uniform vec2 center; // %0.5, 0.5%
uniform float angle; // %0.0%

void main() {
    vec2 coord = uv;
	
	// 转换坐标到中心点
    coord = coord - center;
    
	// 计算角度并加入旋转
    float theta = atan(coord.y, coord.x) + angle;
    
	// 计算半径
    float radius = length(coord);

    // 计算角度映射到分段的区域
    float segAngle = 3.1415926 * 2.0 / segments;
    theta = mod(theta, segAngle);
    theta = abs(theta - segAngle / 2.0);  // 镜像变换

    // 重新计算 UV 坐标
    vec2 newUV = vec2(cos(theta), sin(theta)) * radius + center;
	
	// 读取纹理颜色
    vec4 color = texture2D(screenTexture, newUV);
    
	// 设置最终的颜色和透明度
    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}
