#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float factor; // %1.0% 0..1

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867); 

void main() {

	vec2 uv = v_texCoord;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
	  vec3 color = texture2D(CC_Texture0, v_texCoord).xyz;
	  vec3 lum = vec3(0.299, 0.587, 0.114);
	  vec3 gray = vec3(dot(lum, color));
	  gl_FragColor = vec4(mix(color, gray, factor), 1.0);
	}
	else{
		gl_FragColor = texture2D(CC_Texture0, uv);
	}
}
