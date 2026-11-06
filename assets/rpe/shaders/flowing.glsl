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


     // 时间参数
uniform float speed; // %1%
uniform float power; // %0.03%
uniform float width; // %0.1%
uniform vec4 color; // %0,0,0,0%
uniform vec2 direction; // %1,0%



void rpenLegacyMain() {
	vec3 lightColor = color.rgb;

    vec2 uv = rpenLegacyUv;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    float lightPos = mod(time * speed, 1.0);
    float halfWidth = width / 2.0;

    float dist = abs(dot(uv - vec2(lightPos, lightPos), direction));

    float intensity = smoothstep(halfWidth, 0.0, dist) * power;

	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

    vec4 color = rpenLegacySample(screenTexture, uv);

    vec3 resultColor = color.rgb + lightColor * intensity;

    gl_FragColor = vec4(clamp(resultColor, 0.0, 1.0), 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

uniform sampler2D screenTexture;
uniform float time;
uniform vec2 screenSize;

varying vec2 uv;

uniform float speed; // %1.0%
uniform float power; // %1.0%
uniform float width; // %0.2%
uniform vec4 color; // %1.0, 1.0, 0.5, 1.0%
uniform vec2 direction; // %1.0, 1.0%

void main() {
    vec3 lightColor = color.rgb;
    float lightPos = mod(time * speed, 1.0);
    float halfWidth = width / 2.0;

    float dist = abs(dot(uv - vec2(lightPos, lightPos), direction));

    float intensity = smoothstep(halfWidth, 0.0, dist) * power;

    vec4 texColor = texture2D(screenTexture, uv);

    vec3 resultColor = texColor.rgb + lightColor * intensity;

    gl_FragColor = vec4(clamp(resultColor, 0.0, 1.0), 1.0);
}

#endif
