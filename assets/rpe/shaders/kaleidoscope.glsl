#version 100
// Both branches expose the Phira GLSL 1.00 interface. The compatibility
// branch preserves old charts that explicitly selected the RPE source.
#ifdef RPEN_LEGACY_SOURCE
precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;
uniform float time;
vec2 rpenLegacyUv;
vec4 rpenLegacySample(sampler2D source, vec2 point) {
 vec2 local = (point - vec2(0.0, 0.0333)) / vec2(0.7031, 1.0 / 1.2);
 if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
 return texture2D(source, local);
}
vec4 rpenLegacyProj(sampler2D source, vec4 point) { return rpenLegacySample(source, point.xy / point.w); }
vec4 rpenLegacyProj(sampler2D source, vec3 point) { return rpenLegacySample(source, point.xy / point.z); }
#ifdef GL_ES
precision mediump float;
#endif




const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

uniform float segments; // %8%
uniform vec2 center; // %0.5,0.5%
uniform float angle; // %0%

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

	uv = uv - center;  // 转换坐标到中心点
    float theta = atan(uv.y, uv.x) + angle;  // 计算角度并加入旋转
    float radius = length(uv);  // 计算半径

    // 计算角度映射到分段的区域
    float segAngle = 3.1415926 * 2.0 / segments;
    theta = mod(theta, segAngle);
    theta = abs(theta - segAngle / 2.0);  // 镜像变换

    // 重新计算 UV 坐标
    vec2 newUV = vec2(cos(theta), sin(theta)) * radius + center;

	newUV.x = newUV.x * 0.7031;
	newUV.y = newUV.y / 1.2 + 0.0333;

	if (newUV.x >= rectMin.x && newUV.x <= rectMax.x && newUV.y >= rectMin.y && newUV.y <= rectMax.y) {
		vec4 color = rpenLegacySample(screenTexture, newUV);
		gl_FragColor = color;
		gl_FragColor.a = 1.0;
	} else {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
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

#endif
