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

void rpenLegacyMain()
{
    vec2 uv = rpenLegacyUv;
    // 从纹理获取图像的颜色
    vec4 textureColor = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 获取纹理坐标的横纵比例
    float coordFactor = mod(uv.x + uv.y, 1.0);

    // 生成彩虹色光效果
    vec3 rainbowColor = vec3(sin(6.2831 * coordFactor), sin(6.2831 * (coordFactor + 0.33)), sin(6.2831 * (coordFactor + 0.66)));

    // 调整彩虹色的强度
    rainbowColor = 0.5 * rainbowColor + 0.5;

    // 通过 power 控制叠加彩虹色的强度
    vec4 finalColor = vec4(mix(textureColor.rgb, rainbowColor, power), textureColor.a);

    gl_FragColor = finalColor * vec4(1.0);
	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv;  // 材质 UV
uniform vec2 screenSize;  // 屏幕大小
uniform sampler2D screenTexture;  // 屏幕材质
uniform float power; // %0.5%

void main() {
    vec2 uvCoord = uv;
    // 从纹理获取图像的颜色
    vec4 textureColor = texture2D(screenTexture, uvCoord);

    // 获取纹理坐标的横纵比例
    float coordFactor = mod(uvCoord.x + uvCoord.y, 1.0);

    // 生成彩虹色光效果
    vec3 rainbowColor = vec3(sin(6.2831 * coordFactor), sin(6.2831 * (coordFactor + 0.33)), sin(6.2831 * (coordFactor + 0.66)));

    // 调整彩虹色的强度
    rainbowColor = 0.5 * rainbowColor + 0.5;

    // 通过 power 控制叠加彩虹色的强度
    vec4 finalColor = vec4(mix(textureColor.rgb, rainbowColor, power), textureColor.a);

    gl_FragColor = finalColor;
    gl_FragColor.a = 1.0;
}

#endif
