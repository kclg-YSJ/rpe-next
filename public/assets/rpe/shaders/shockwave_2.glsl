#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec2 resolution;

uniform float progress; // %0.2% 0..1
uniform float centerX; // %0.5% 0..1
uniform float centerY; // %0.5% 0..1
uniform float width; // %0.1%
uniform float distortion; // %0.8%
uniform float expand; // %10.0%

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

void main() {
	vec2 uv = v_texCoord;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		float aspect = resolution.y / resolution.x;
		
		vec2 center = vec2(centerX, centerY);
		center.y = (center.y - 0.5) * aspect + 0.5;
		
		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333 ) * 1.2;
		
		vec2 tex_coord = uv;
		
		tex_coord.y = (tex_coord.y - 0.5) * aspect + 0.5;
		float dist = distance(tex_coord, center);

		if (progress - width <= dist && dist <= progress + width) {
			float diff = dist - progress;
			float scale_diff = 1.0 - pow(abs(diff * expand), distortion);
			float dt = diff * scale_diff;

			vec2 dir = normalize(tex_coord - center);

			tex_coord += ((dir * dt) / (progress * dist * 40.0));
			
			float x = tex_coord.x * 0.7031;
			float y = ((tex_coord.y - 0.5) / aspect + 0.5) / 1.2 + 0.0333;
			
			gl_FragColor = texture2D(CC_Texture0, vec2(x,y));

			gl_FragColor += (gl_FragColor * scale_diff) / (progress * dist * 40.0);
		} 
		else {
		
			float x = tex_coord.x * 0.7031;
			float y = ((tex_coord.y - 0.5) / aspect + 0.5) / 1.2 + 0.0333;
			gl_FragColor = texture2D(CC_Texture0, vec2(x, y));
		}
		gl_FragColor.a = 1.0;
	}
	else{
		gl_FragColor = texture2D(CC_Texture0, uv);
	}
}