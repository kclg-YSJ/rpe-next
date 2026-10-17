#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float sampleCount; // %3% int 1..64
uniform float power; // %0.01%

vec3 chromatic_slice(float t) {
    vec3 res = vec3(1.0 - t, 1.0 - abs(t - 1.0), t - 1.0);
    return max(res, vec3(0.0));
}

// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.033);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.703, 0.867);  // Example: top-right corner of the rectangle

void main() {

	vec2 uv = v_texCoord;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x &&
			uv.y >= rectMin.y && uv.y <= rectMax.y)
	{
	
		uv.x= uv.x / 0.7031;
		uv.y=(uv.y - 0.0333) * 1.2;
		
		vec3 sum = vec3(0.0);
		vec3 c = vec3(0.0);
		vec2 offset = (uv - vec2(0.5)) * vec2(1.0, -1.0);
		int sample_count = int(sampleCount);
		for (int i = 0; i < 64; ++i) {
			if (i >= sample_count) break;
			float t = 2.0 * float(i) / float(sample_count - 1); // range 0.0->2.0
			vec3 slice = chromatic_slice(t);
			sum += slice;
			vec2 slice_offset = (t - 1.0) * power * offset;
			
			vec2 nuv = uv + slice_offset;
			
			nuv.x = nuv.x * 0.7031;
			nuv.y = nuv.y / 1.2 + 0.0333;
			
			if (nuv.x >= rectMin.x && nuv.x <= rectMax.x && nuv.y >= rectMin.y && nuv.y <= rectMax.y) {
				c += slice * texture2DProj(CC_Texture0, vec4(nuv, 0.0, 1.0)).rgb;
			}
		}
		gl_FragColor = vec4(c / sum, 1.0);
	}
	else
	{
		gl_FragColor = texture2D(CC_Texture0, v_texCoord);
	}
}
