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





uniform float progress; // %0.2%
uniform float power; // %0.03%

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

void rpenLegacyMain()
{
    // 图像中心坐标
    vec2 center = vec2(0.5, 0.5);

	vec2 uv = rpenLegacyUv;
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 计算当前纹理坐标到中心的向量
    vec2 direction = uv - center;

    // 计算距离与方向的旋转角度
    float distance = length(direction);

    // 控制扭曲效果，progress 控制强度
    float angle = progress * distance * power; // 调整 10.0 来控制最大扭曲

    // 计算旋转后的纹理坐标
    float sinAngle = sin(angle);
    float cosAngle = cos(angle);
    vec2 twistedCoord = vec2(
        direction.x * cosAngle - direction.y * sinAngle,
        direction.x * sinAngle + direction.y * cosAngle
    );

    // 应用扭曲后的坐标
    uv = center + twistedCoord;
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		vec4 color = rpenLegacySample(screenTexture, uv);
		gl_FragColor = color;
		gl_FragColor.a = 1.0;
	} else {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
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

#endif
