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




uniform vec4 fogColor; // %0.5,0.5,0.5,1%
uniform float fogStart; // %0%
uniform float fogEnd; // %1%
         // 用于动态变化的时间变量

void rpenLegacyMain() {
    // 读取纹理颜色
	vec2 uv = rpenLegacyUv;
    vec4 color = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 使用Y坐标计算雾的基础浓度
    float fogFactor = clamp((fogEnd - uv.y) / (fogEnd - fogStart), 0.0, 1.0);


    // 将雾的颜色与原始颜色混合
    vec4 finalColor = mix(fogColor, color, fogFactor);

    gl_FragColor = vec4(finalColor.rgb, 1.0); // 最终颜色，使用原始透明度
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform vec4 fogColor; // %0.8, 0.8, 0.8, 1.0%
uniform float fogStart; // %0.8%
uniform float fogEnd; // %-0.2%
uniform float time;

void main() {
    // 读取纹理颜色
    vec4 color = texture2D(screenTexture, uv);

    // 使用Y坐标计算雾的基础浓度
    float fogFactor = clamp((fogEnd - uv.y) / (fogEnd - fogStart), 0.0, 1.0);

    // 将雾的颜色与原始颜色混合
    vec4 finalColor = mix(fogColor, color, fogFactor);

    gl_FragColor = vec4(finalColor.rgb, 1.0); // 最终颜色，使用原始透明度
}

#endif
