#version 100
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform float time;
uniform float speed; // %5.0%
uniform vec2 direction; // %1.0, 0.0%
uniform float frequency; // %30.0%
uniform float amplitude; // %0.008%

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);
vec4 getcolor(vec2 uv)
{
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(screenTexture, uv);
	else
		return vec4(0, 0, 0, 1);
}

void main() {

    // 计算方向向量影响下的波动
    float wave = sin(dot(uv, direction * frequency) + time * speed) * amplitude;

    // 将波动效果应用到纹理坐标上，使其沿给定方向和速度波动
    vec2 distortedTexCoord = vec2(uv.x + wave, uv.y + wave);

    gl_FragColor = getcolor(distortedTexCoord);
	gl_FragColor.a = 1.0;
}
