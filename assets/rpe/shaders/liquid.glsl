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



uniform float frequency; // %10%
uniform float amplitude; // %0.02%




void rpenLegacyMain()
{
    vec2 uv = rpenLegacyUv;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    vec2 offset = vec2(sin(uv.y * frequency + time) * amplitude, cos(uv.x * frequency + time) * amplitude);

    vec2 distortedUV = uv + offset;

	distortedUV.x = distortedUV.x * 0.7031;
	distortedUV.y = distortedUV.y / 1.2 + 0.0333;

    vec4 color = rpenLegacySample(screenTexture, distortedUV);

    gl_FragColor = vec4(1.0) * color;
	gl_FragColor.a = 1.0;
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

uniform sampler2D screenTexture;  // 替换u_texture和CC_Texture0
uniform float time;               // 替换u_time
uniform float frequency; // %10.0%
uniform float amplitude; // %0.02%
uniform vec2 screenSize;          // 屏幕大小

varying vec2 uv;                  // 替换v_texCoord

void main()
{
    vec2 offset = vec2(sin(uv.y * frequency + time) * amplitude, cos(uv.x * frequency + time) * amplitude);

    vec2 distortedUV = uv + offset;

    vec4 color = texture2D(screenTexture, distortedUV);

    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}

#endif
