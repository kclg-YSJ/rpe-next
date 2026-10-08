#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float centerX; // %0.5% 0..1
uniform float centerY; // %0.5% 0..1
uniform float power; // %0.01% 0..1
uniform float sampleCount; // %6% int 1..64

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

void main() {
	vec2 uv = v_texCoord;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
	
		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;
		
		vec2 direction = uv - vec2(centerX, centerY);
		vec3 c = vec3(0.0);
		float f = 1.0 / sampleCount;
		vec2 screen_uv = uv / 2.0 + vec2(0.5, 0.5);
		for (float i = 0.0; i < 64.0; ++i) {
			if (i >= sampleCount) break;
			vec2 tuv = uv - power * direction * i;
			
			tuv.x = tuv.x * 0.7031;
			tuv.y = tuv.y / 1.2 + 0.0333;
		
			c += texture2D(CC_Texture0, tuv).rgb * f;
		}
		gl_FragColor = vec4(c,1.0);
	}
	else{
		gl_FragColor = texture2D(CC_Texture0, uv);
	}
}
