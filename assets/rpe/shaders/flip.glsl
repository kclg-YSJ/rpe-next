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

// 传入的方向：0 表示水平翻转，1 表示垂直翻转
uniform float direction; // %1,0%
// 翻转进度，0 表示未翻转，1 表示翻转完成
uniform float progress; // %0.2%
// 纹理

// 纹理坐标


const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

	if (direction == 0.0) {
        // 水平翻转
        // 在 progress 为 0 时保持正常, progress 为 1 时完全翻转
		float adjusted_x;

		if (progress < 0.5) {
			adjusted_x = 0.5 + (uv.x - 0.5) / (0.5 - progress);
		} else if (progress == 0.5) {
			adjusted_x = (uv.x < 0.5) ? -1.0 / 0.0 : 1.0 / 0.0;
		} else {
			adjusted_x = mix(0.5 + (uv.x - 0.5) / (0.5 - progress), 1.0 - uv.x, (progress - 0.5) * 2.0);
		}

		uv.x = mix(uv.x, adjusted_x, progress);
    } else {
        // 垂直翻转
        // 在 progress 为 0 时保持正常, progress 为 1 时完全翻转
		float adjusted_y;

		if (progress < 0.5) {
			adjusted_y = 0.5 + (uv.y - 0.5) / (0.5 - progress);
		} else if (progress == 0.5) {
			adjusted_y = (uv.y < 0.5) ? -1.0 / 0.0 : 1.0 / 0.0;
		} else {
			adjusted_y = mix(0.5 + (uv.y - 0.5) / (0.5 - progress), 1.0 - uv.y, (progress - 0.5) * 2.0);
		}

		uv.y = mix(uv.y, adjusted_y, progress);
    }


	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		// 如果在矩形内，取样纹理颜色
		vec4 color = rpenLegacySample(screenTexture, uv);
		gl_FragColor = color;
		gl_FragColor.a = 1.0;
	} else {
		// 如果在矩形外，置为黑色
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

// 传入的方向：0 表示水平翻转，1 表示垂直翻转
uniform float direction; // %0.0%
// 翻转进度，0 表示未翻转，1 表示翻转完成
uniform float progress; // %1.0%
// 纹理
uniform sampler2D screenTexture; // 替换u_texture和CC_Texture0
// 纹理坐标
varying vec2 uv; // 替换v_texCoord

void main() {
    vec2 uvCoord = uv;

	if (direction == 0.0) {
        // 水平翻转
        // 在 progress 为 0 时保持正常, progress 为 1 时完全翻转
		float adjusted_x;

		if (progress < 0.5) {
			adjusted_x = 0.5 + (uvCoord.x - 0.5) / (0.5 - progress);
		} else if (progress == 0.5) {
			adjusted_x = (uvCoord.x < 0.5) ? -1.0 / 0.0 : 1.0 / 0.0;
		} else {
			adjusted_x = mix(0.5 + (uvCoord.x - 0.5) / (0.5 - progress), 1.0 - uvCoord.x, (progress - 0.5) * 2.0);
		}

		uvCoord.x = mix(uvCoord.x, adjusted_x, progress);
    } else {
        // 垂直翻转
        // 在 progress 为 0 时保持正常, progress 为 1 时完全翻转
		float adjusted_y;

		if (progress < 0.5) {
			adjusted_y = 0.5 + (uvCoord.y - 0.5) / (0.5 - progress);
		} else if (progress == 0.5) {
			adjusted_y = (uvCoord.y < 0.5) ? -1.0 / 0.0 : 1.0 / 0.0;
		} else {
			adjusted_y = mix(0.5 + (uvCoord.y - 0.5) / (0.5 - progress), 1.0 - uvCoord.y, (progress - 0.5) * 2.0);
		}

		uvCoord.y = mix(uvCoord.y, adjusted_y, progress);
    }

	vec4 color = texture2D(screenTexture, uvCoord); // 替换CC_Texture0为screenTexture
	gl_FragColor = color;
	gl_FragColor.a = 1.0;
}

#endif
