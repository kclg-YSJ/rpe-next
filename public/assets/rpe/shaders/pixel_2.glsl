#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

uniform vec2 resolution;
uniform float size; // %10.0%

void main() {

	vec2 uv = v_texCoord;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;
		
		vec2 factor = resolution / size;
		float x = floor(uv.x * factor.x + 0.5) / factor.x;
		float y = floor(uv.y * factor.y + 0.5) / factor.y;
		
		x = x * 0.7031;
		y = y / 1.2 + 0.0333;
		
		gl_FragColor = texture2D(CC_Texture0, vec2(x, y));
		gl_FragColor.a = 1.0;
	}
	else{
		gl_FragColor = texture2D(CC_Texture0, uv);
	}
}
