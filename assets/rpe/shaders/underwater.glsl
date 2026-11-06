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



  // 时间变量，用于波浪效果
uniform vec2 resolution; // %1350,900%

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;
	vec4 color = rpenLegacySample(screenTexture, uv);

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    float wave = sin(uv.y * 10.0 + time * 5.0) * 0.01;
    uv.x += wave;

    // 为水下效果添加蓝绿色调
    vec3 underwaterColor = vec3(0.0, 0.4, 0.6);
    color.rgb = mix(color.rgb, underwaterColor, 0.4);

    // 添加一些模糊来模拟水的光线散射
    float blur = sin(time * 1.5) * 0.005;
	uv = uv + vec2(blur, blur);

	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

    vec4 blurColor = rpenLegacySample(screenTexture, uv) * 0.9;
    color = mix(color, blurColor, 0.5);

    // 输出最终颜色
    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv; // 纹理坐标
uniform float time;  // 时间变量，用于波浪效果
uniform vec2 screenSize;  // 屏幕分辨率
uniform sampler2D screenTexture; // 输入的屏幕纹理

void main() {
    vec2 uvCoord = uv;
    vec4 color = texture2D(screenTexture, uvCoord);

    // 计算波浪效果
    float wave = sin(uvCoord.y * 10.0 + time * 5.0) * 0.01;
    uvCoord.x += wave;

    // 为水下效果添加蓝绿色调
    vec3 underwaterColor = vec3(0.0, 0.4, 0.6);
    color.rgb = mix(color.rgb, underwaterColor, 0.4);

    // 添加一些模糊来模拟水的光线散射
    float blur = sin(time * 1.5) * 0.005;
    uvCoord += vec2(blur, blur);

    vec4 blurColor = texture2D(screenTexture, uvCoord) * 0.9;
    color = mix(color, blurColor, 0.5);

    // 输出最终颜色
    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}

#endif
