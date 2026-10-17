#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float u_time;
uniform float power; // %0.03%
uniform float rate; // %0.6% 0..1
uniform float speed; // %5.0%
uniform float blockCount; // %30.5%
uniform float colorRate; // %0.01% 0..1

float my_trunc(float x) {
    return x < 0.0 ? -floor(-x) : floor(x);
}

float random(float seed) {
    return fract(543.2543 * sin(dot(vec2(seed, seed), vec2(3525.46, -54.3415))));
}


// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.033);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.703, 0.867);  // Example: top-right corner of the rectangle

void main() {
	vec2 uv = v_texCoord;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x &&
			uv.y >= rectMin.y && uv.y <= rectMax.y)
	{

		uv.x = uv.x / 0.7031;
		uv.y =(uv.y - 0.0333) * 1.2;
		
		float enable_shift = float(random(my_trunc(u_time * speed)) < rate);

		vec2 fixed_uv = uv;
		fixed_uv.x += (random((my_trunc(uv.y * blockCount) / blockCount) + u_time) - 0.5) * power * enable_shift;
		
		fixed_uv.x = fixed_uv.x * 0.7031;
		fixed_uv.y = fixed_uv.y / 1.2 + 0.0333;

		vec4 pixel_color = texture2D(CC_Texture0, fixed_uv);
		pixel_color.r = mix(
			pixel_color.r,
			texture2D(CC_Texture0, fixed_uv + vec2(colorRate, 0.0)).r,
			enable_shift
		);
		pixel_color.b = mix(
			pixel_color.b,
			texture2D(CC_Texture0, fixed_uv + vec2(-colorRate, 0.0)).b,
			enable_shift
		);

		gl_FragColor = pixel_color;
		gl_FragColor.a = 1.0;
	}
	else
	{
		gl_FragColor = texture2D(CC_Texture0, v_texCoord);
	}
}
