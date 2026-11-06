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






// 控制变量：缩放倍率、中心偏移、旋转角度
uniform float zoom; // %1%
uniform vec2 offset; // %0%
uniform float rotation; // %0%
uniform vec2 resolution; // %1350,900%

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

void rpenLegacyMain()
{
	vec2 uv = rpenLegacyUv;
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    vec2 centeredCoord = uv - vec2(0.5, 0.5);
	float scale = resolution.y / resolution.x;
	centeredCoord.x = centeredCoord.x / scale;

    centeredCoord /= zoom;

    float sinAngle = sin(rotation * 3.1415926 / 180.0);
    float cosAngle = cos(rotation * 3.1415926 / 180.0);
    vec2 rotatedCoord = vec2(
        cosAngle * centeredCoord.x - sinAngle * centeredCoord.y,
        sinAngle * centeredCoord.x + cosAngle * centeredCoord.y
    );

	rotatedCoord.x = rotatedCoord.x * scale;

    rotatedCoord -= offset;

    uv = rotatedCoord + vec2(0.5, 0.5);

	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
	{
		gl_FragColor = rpenLegacySample(screenTexture, uv);
		gl_FragColor.a = 1.0;
	}
	else
	{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv; // 材质 UV，替换v_texCoord
uniform vec2 screenSize; // 屏幕大小resolution
uniform sampler2D screenTexture; // 屏幕材质，替换u_texture和CC_Texture0
uniform float time; // 时间，以秒为单位，替换u_time

// 控制变量：缩放倍率、中心偏移、旋转角度
uniform float zoom; // %1.0%
uniform vec2 offset; // %0.0, 0.0%
uniform float rotation; // %0.0%

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);

void main()
{
    vec2 centeredCoord = uv - vec2(0.5, 0.5);
    float scale = screenSize.y / screenSize.x;
    centeredCoord.x = centeredCoord.x / scale;

    centeredCoord /= zoom;

    float sinAngle = sin(rotation * 3.1415926 / 180.0);
    float cosAngle = cos(rotation * 3.1415926 / 180.0);
    vec2 rotatedCoord = vec2(
        cosAngle * centeredCoord.x - sinAngle * centeredCoord.y,
        sinAngle * centeredCoord.x + cosAngle * centeredCoord.y
    );

    rotatedCoord.x = rotatedCoord.x * scale;

    rotatedCoord = rotatedCoord - offset + vec2(0.5, 0.5);

	if (rotatedCoord.x >= rectMin.x && rotatedCoord.x <= rectMax.x && rotatedCoord.y >= rectMin.y && rotatedCoord.y <= rectMax.y)
	{
		gl_FragColor = texture2D(screenTexture, rotatedCoord);
		gl_FragColor.a = 1.0;
	}
	else
	{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

#endif
