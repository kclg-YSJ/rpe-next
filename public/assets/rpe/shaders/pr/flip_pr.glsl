#version 100
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
