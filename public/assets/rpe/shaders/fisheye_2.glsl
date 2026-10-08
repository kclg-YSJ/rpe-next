#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec2 resolution;
uniform float power; // %-0.1%

// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.033);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.703, 0.867);  // Example: top-right corner of the rectangle

void main() {
    vec2 uv = v_texCoord;

    // Check if the current pixel is inside the rectangle
    if (uv.x >= rectMin.x && uv.x <= rectMax.x &&
        uv.y >= rectMin.y && uv.y <= rectMax.y) {

		uv.x = uv.x / 0.7031;
		uv.y = (uv.y - 0.0333) * 1.2;

        // Perform the effect only inside the rectangle
        vec2 p = vec2(uv.x, uv.y * resolution.y / resolution.x);
        float aspect = resolution.x / resolution.y;
        vec2 m = vec2(0.5, 0.5 / aspect);
        vec2 d = p - m;
        float r = sqrt(dot(d, d));

        float new_power = (2.0 * 3.141592 / (2.0 * sqrt(dot(m, m)))) * power;
        float bind = new_power > 0.0 ? sqrt(dot(m, m)) : (aspect < 1.0 ? m.x : m.y);

        vec2 nuv;
        if (new_power > 0.0)
            nuv = m + normalize(d) * tan(r * new_power) * bind / tan(bind * new_power);
        else
            nuv = m + normalize(d) * atan(r * -new_power * 10.0) * bind / atan(-new_power * bind * 10.0);
			
		nuv.x = nuv.x * 0.7031;
		nuv.y =(nuv.y * aspect / 1.2 + 0.0333);
		
		if (nuv.x >= rectMin.x && nuv.x <= rectMax.x && nuv.y >= rectMin.y && nuv.y <= rectMax.y) {
			gl_FragColor = texture2D(CC_Texture0, vec2(nuv.x, nuv.y));
			gl_FragColor.a = 1.0;
		}
		else
		{
			gl_FragColor = texture2D(CC_Texture0, v_texCoord);
			gl_FragColor.a = 1.0;
		}
    } else {
        // Pixels outside the rectangle are not affected
        gl_FragColor = texture2D(CC_Texture0, v_texCoord);
		gl_FragColor.a = 1.0;
    }
}