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




uniform vec4 color1; // %0,0,0,1%
uniform vec4 color2; // %1,1,1,1%
uniform float threshold; // %0.5%

void rpenLegacyMain() {
    vec4 texColor = rpenLegacySample(screenTexture, rpenLegacyUv);  // 获取纹理颜色
    float brightness = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));  // 计算亮度

    vec4 finalColor = brightness < threshold ? color1 : color2;  // 根据亮度应用不同颜色
    // 使用纹理的透明度来调整最终的 alpha
    gl_FragColor = vec4(finalColor.rgb, 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;

uniform vec4 color1; // %0.0, 0.0, 0.0, 1.0%
uniform vec4 color2; // %0.6, 0.6, 1.0, 1.0%
uniform float threshold; // %0.5%

void main() {
    vec4 texColor = texture2D(screenTexture, uv);  // 获取纹理颜色
    float brightness = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));  // 计算亮度

    vec4 finalColor = brightness < threshold ? color1 : color2;  // 根据亮度应用不同颜色
    // 使用纹理的透明度来调整最终的 alpha
    gl_FragColor = vec4(finalColor.rgb, 1.0);
}

#endif
