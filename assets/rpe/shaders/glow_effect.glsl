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
uniform float intensity; // %1%
uniform float threshold; // %0.5%

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

float calculateLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;
    vec3 color = rpenLegacySample(screenTexture, uv).rgb;

    uv.x = uv.x / 0.7031;
    uv.y = (uv.y - 0.0333) * 1.2;

    float luminance = calculateLuminance(color);

    vec3 bloom = vec3(0.0);

    if (luminance > threshold) {
        for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
                vec2 offset = vec2(float(x), float(y)) / resolution;
                vec3 sampleColor = getcolor(uv + offset).rgb;
                bloom += sampleColor;
            }
        }
        bloom /= 25.0;
        bloom *= intensity;
    }

    vec3 finalColor = color + bloom;

    gl_FragColor = vec4(finalColor, 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv; // 替换v_texCoord
uniform sampler2D screenTexture; // 替换CC_Texture0和u_texture
uniform vec2 screenSize; // 替换resolution
uniform float time; // 替换u_time

uniform float intensity; // %0.6%
uniform float threshold; // %0.3%

vec4 getcolor(vec2 uv) {
    return texture2D(screenTexture, uv);
}

float calculateLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec3 color = texture2D(screenTexture, uv).rgb; // 替换texture2D(CC_Texture0, uv)

    float luminance = calculateLuminance(color);

    vec3 bloom = vec3(0.0);

    if (luminance > threshold) {
        for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
                vec2 offset = vec2(float(x), float(y)) / screenSize; // 替换resolution为screenSize
                vec3 sampleColor = getcolor(uv + offset).rgb;
                bloom += sampleColor;
            }
        }
        bloom /= 25.0;
        bloom *= intensity;
    }

    vec3 finalColor = color + bloom;

    gl_FragColor = vec4(finalColor, 1.0);
}

#endif
