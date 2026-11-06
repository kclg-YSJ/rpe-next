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





uniform float power; // %0.03%
 // 用于动态效果的时间变量

void rpenLegacyMain()
{
    vec2 uv = rpenLegacyUv;
    // 读取当前像素的颜色
    vec4 color = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 获取当前像素的y坐标（范围是0到1）
    float scanline = sin((uv.y * 800.0 + time * 5.0) * 3.14159 * 2.0); // 模拟扫描线
    float intensity = 1.0 - power * (scanline * 0.5 + 0.5);

    // 将扫描线的效果应用到颜色上
    color.rgb *= intensity;

    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
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

#endif
