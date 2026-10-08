#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec4 color; // %0.0, 0.0, 0.0, 1.0%
uniform float extend; // %0.25% 0..1
uniform float radius; // %15.0%

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

void main() {
	vec2 uv = v_texCoord;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		
		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;
		
		vec2 new_uv = uv * (1.0 - uv.yx);
		float vig = new_uv.x * new_uv.y * radius;
		vig = pow(vig, extend);
		
		uv.x = uv.x * 0.7031;
		uv.y = uv.y / 1.2 + 0.0333;
		
		gl_FragColor = mix(color, texture2D(CC_Texture0, uv), vig);
		gl_FragColor.a = 1.0;
	}
	else{
		gl_FragColor = texture2D(CC_Texture0, uv);
	}
}
