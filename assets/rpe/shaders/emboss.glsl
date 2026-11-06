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




uniform vec2 resolution; // %1350,900%
uniform float strength; // %1%

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return rpenLegacySample(screenTexture, uv);
	else
		return vec4(0, 0, 0, 1);
}
void rpenLegacyMain()
{
    vec2 uv = rpenLegacyUv;
	vec4 originalColor = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 获取纹理像素的偏移量
    vec2 offset = vec2(1.0 / resolution.x, 1.0 / resolution.y);

    // 获取周围的像素颜色
    vec4 colorTL = getcolor(uv + vec2(-offset.x, -offset.y)); // 左上
    vec4 colorBR = getcolor(uv + vec2(offset.x, offset.y));   // 右下

    // Emboss 卷积核计算
    vec4 embossColor = colorTL - colorBR;

    // 调整对比度
    embossColor += vec4(0.5, 0.5, 0.5, 1.0);

	embossColor = clamp(embossColor, 0.0, 1.0);

	vec4 finalColor = mix(originalColor, embossColor, strength);
    gl_FragColor = finalColor;

	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
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

#endif
