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
uniform float threshold; // %0.5%
uniform vec4 color; // %0,0,0,0%

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
    // Sobel 核
    float kernelX[9];
    float kernelY[9];

    kernelX[0] = -1.0; kernelX[1] = 0.0; kernelX[2] = 1.0;
    kernelX[3] = -2.0; kernelX[4] = 0.0; kernelX[5] = 2.0;
    kernelX[6] = -1.0; kernelX[7] = 0.0; kernelX[8] = 1.0;

    kernelY[0] = -1.0; kernelY[1] = -2.0; kernelY[2] = -1.0;
    kernelY[3] = 0.0;  kernelY[4] = 0.0;  kernelY[5] = 0.0;
    kernelY[6] = 1.0;  kernelY[7] = 2.0;  kernelY[8] = 1.0;

    vec2 texOffset[9];
    texOffset[0] = vec2(-1.0, -1.0) / resolution;
    texOffset[1] = vec2( 0.0, -1.0) / resolution;
    texOffset[2] = vec2( 1.0, -1.0) / resolution;
    texOffset[3] = vec2(-1.0,  0.0) / resolution;
    texOffset[4] = vec2( 0.0,  0.0) / resolution;
    texOffset[5] = vec2( 1.0,  0.0) / resolution;
    texOffset[6] = vec2(-1.0,  1.0) / resolution;
    texOffset[7] = vec2( 0.0,  1.0) / resolution;
    texOffset[8] = vec2( 1.0,  1.0) / resolution;

    float sumX = 0.0;
    float sumY = 0.0;

	vec2 uv = rpenLegacyUv;
	vec3 originalColor = rpenLegacySample(screenTexture, uv).rgb;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    for (int i = 0; i < 9; i++) {
        vec4 _color = getcolor(uv + texOffset[i]);
        float intensity = dot(_color.rgb, vec3(0.299, 0.587, 0.114));  // 转为灰度
        sumX += intensity * kernelX[i];
        sumY += intensity * kernelY[i];
    }

    float sobelValue = sqrt(sumX * sumX + sumY * sumY);

	if (sobelValue > threshold){
		gl_FragColor = color;
	}
	else{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;

uniform float threshold; // %0.9%
uniform vec4 color; // %0.0, 1.0, 1.0, 1.0%

vec4 getcolor(vec2 uv)
{
	return texture2D(screenTexture, uv);
}

void main()
{
    // Sobel 核
    float kernelX[9];
    float kernelY[9];

    kernelX[0] = -1.0; kernelX[1] = 0.0; kernelX[2] = 1.0;
    kernelX[3] = -2.0; kernelX[4] = 0.0; kernelX[5] = 2.0;
    kernelX[6] = -1.0; kernelX[7] = 0.0; kernelX[8] = 1.0;

    kernelY[0] = -1.0; kernelY[1] = -2.0; kernelY[2] = -1.0;
    kernelY[3] = 0.0;  kernelY[4] = 0.0;  kernelY[5] = 0.0;
    kernelY[6] = 1.0;  kernelY[7] = 2.0;  kernelY[8] = 1.0;

    vec2 texOffset[9];
    texOffset[0] = vec2(-1.0, -1.0) / screenSize;
    texOffset[1] = vec2( 0.0, -1.0) / screenSize;
    texOffset[2] = vec2( 1.0, -1.0) / screenSize;
    texOffset[3] = vec2(-1.0,  0.0) / screenSize;
    texOffset[4] = vec2( 0.0,  0.0) / screenSize;
    texOffset[5] = vec2( 1.0,  0.0) / screenSize;
    texOffset[6] = vec2(-1.0,  1.0) / screenSize;
    texOffset[7] = vec2( 0.0,  1.0) / screenSize;
    texOffset[8] = vec2( 1.0,  1.0) / screenSize;

    float sumX = 0.0;
    float sumY = 0.0;

	vec3 originalColor = texture2D(screenTexture, uv).rgb;

    for (int i = 0; i < 9; i++) {
        vec4 _color = getcolor(uv + texOffset[i]);
        float intensity = dot(_color.rgb, vec3(0.299, 0.587, 0.114));  // 转为灰度
        sumX += intensity * kernelX[i];
        sumY += intensity * kernelY[i];
    }

    float sobelValue = sqrt(sumX * sumX + sumY * sumY);

	if (sobelValue > threshold){
		gl_FragColor = color;
	}
	else{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

#endif
