#version 100
precision highp float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform float blurRadius; // %10.0%
uniform vec2 screenSize;       // 屏幕分辨率
uniform float intensity; // %2.0%
uniform vec2 center; // %0.5, 0.5%
uniform float radius; // %0.1%

// 计算基于焦点的模糊强度
float computeBlurRadius(vec2 uv) {
    // 计算当前像素位置与焦点的距离
    float distanceToFocus = distance(uv, center);
    
    // 通过焦点半径控制模糊，距离焦点越远模糊越大
    float normalizedDistance = clamp((distanceToFocus - radius) / (1.0 - radius), 0.0, 1.0);
    
    return blurRadius * normalizedDistance;
}

// 高斯模糊核权重
float gaussian(vec2 offset, float radius) {
    return exp(-dot(offset, offset) / (2.0 * radius * radius)) / (2.0 * 3.14159265359 * radius * radius);
}

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);
vec4 getcolor(vec2 uv)
{
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(screenTexture, uv);
	else
		return vec4(0.0, 0.0, 0.0, 1.0);
}

// 模糊函数
vec4 blur(vec2 uv, float radius) {
	if (radius <= 0.5) {
        return getcolor(uv + vec2(0, 0));
    }
    vec4 color = vec4(0.0);
    float total = 0.0;

    for (float x = -radius; x <= radius; x++) {
        for (float y = -radius; y <= radius; y++) {
            vec2 offset = vec2(x, y) / screenSize;
            float weight = gaussian(vec2(x, y), radius);
            color += getcolor(uv + offset * intensity) * weight;
            total += weight;
        }
    }

    return color / total;
}


void main() {
    float adaptiveBlurRadius = computeBlurRadius(uv); // 计算自适应模糊半径
    vec4 blurredColor = blur(uv, adaptiveBlurRadius); // 使用自适应模糊
    gl_FragColor = blurredColor;
	gl_FragColor.a = 1.0;
}
