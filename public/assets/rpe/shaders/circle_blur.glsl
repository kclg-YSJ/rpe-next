#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec2 resolution;
uniform float size; // %10.0%

// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.033);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.703, 0.867);  // Example: top-right corner of the rectangle

void main() {
	vec2 uv = v_texCoord;

    if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
	
		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333) * 1.2;
	
		vec4 c = texture2D(CC_Texture0, v_texCoord);
		float length = dot(c, c);
		vec2 pixel_size = 1.0 / resolution;
		for (float x = -size; x < size; x++) {
			for (float y = -size; y < size; ++y) {
				if (x * x + y * y > size * size) continue;
				
				vec2 nuv = uv + pixel_size * vec2(x, y);
				
				nuv.x = nuv.x * 0.7031;
				nuv.y = nuv.y / 1.2 + 0.0333;
				
				vec4 new_c = texture2D(CC_Texture0, nuv);
				float new_length = dot(new_c, new_c);
				if (new_length > length) {
					length = new_length;
					c = new_c;
				}
			}
		}
		gl_FragColor = c;
		gl_FragColor.a = 1.0;
	}
  else
  {
	gl_FragColor = texture2D(CC_Texture0, v_texCoord);
  }
}
