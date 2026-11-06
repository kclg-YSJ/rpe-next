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

uniform vec2 lightpos; // %0.5,0.5%
uniform float power; // %0.03%

 // 纹理坐标
 // 输入的纹理
uniform vec2 resolution; // %1350,900%

void rpenLegacyMain()
{
    vec2 uv = rpenLegacyUv;

    vec4 color = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 根据屏幕分辨率调整uv坐标的比例，保持宽高比
    vec2 norm_uv = (uv * resolution - resolution * 0.5) / resolution.y;
    vec2 norm_lightpos = (lightpos * resolution - resolution * 0.5) / resolution.y;

    // 计算当前像素与光源位置的距离
    float distance = length(norm_uv - norm_lightpos);

    // 根据距离计算炫光效果，距离越近效果越强
    float glow = power / (distance * distance);

    // 混合炫光效果和原始颜色
    vec3 finalColor = color.rgb + vec3(glow);

    // 输出最终颜色
    gl_FragColor = vec4(finalColor, 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

uniform vec2 lightpos; // %0.5, 0.5%
uniform float power; // %0.01%

varying vec2 uv; // 纹理坐标
uniform sampler2D screenTexture; // 输入的纹理
uniform vec2 screenSize; // 屏幕分辨率
uniform float time; // 时间

void main()
{
    vec2 norm_uv = (uv * screenSize - screenSize * 0.5) / screenSize.y;
    vec2 norm_lightpos = (lightpos * screenSize - screenSize * 0.5) / screenSize.y;

    // 采样屏幕纹理颜色
    vec4 color = texture2D(screenTexture, uv);

    // 计算当前像素与光源位置的距离
    float distance = length(norm_uv - norm_lightpos);

    // 根据距离计算炫光效果，距离越近效果越强
    float glow = power / (distance * distance);

    // 混合炫光效果和原始颜色
    vec3 finalColor = color.rgb + vec3(glow);

    // 输出最终颜色
    gl_FragColor = vec4(finalColor, 1.0);
}

#endif
