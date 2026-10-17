#ifdef GL_ES
precision mediump float;
#endif

// 传入的方向：0 表示水平翻转，1 表示垂直翻转
uniform float direction;
// 翻转进度，0 表示未翻转，1 表示翻转完成
uniform float progress;
// 纹理
uniform sampler2D u_texture;
// 纹理坐标
varying vec2 v_texCoord;

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

void main() {
    vec2 uv = v_texCoord;

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
		vec4 color = texture2D(CC_Texture0, uv);
		gl_FragColor = color;
		gl_FragColor.a = 1.0;
	} else {
		// 如果在矩形外，置为黑色
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}
