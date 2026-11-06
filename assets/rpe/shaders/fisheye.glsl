#version 100
precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;
uniform float time;
vec2 rpenLegacyUv;
vec4 rpenLegacySample(sampler2D source, vec2 point) {
 vec2 local = (point - vec2(0.0, 0.0333)) / vec2(0.7031, 1.0 / 1.2);
 if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
 return texture2D(source, local);
}
vec4 rpenLegacyProj(sampler2D source, vec4 point) { return rpenLegacySample(source, point.xy / point.w); }
vec4 rpenLegacyProj(sampler2D source, vec3 point) { return rpenLegacySample(source, point.xy / point.z); }
#ifdef GL_ES
precision mediump float;
#endif





uniform vec2 resolution; // %1350,900%
uniform float power; // %-0.1%

// Define the rectangle bounds (normalized coordinates)
const vec2 rectMin = vec2(0.0, 0.0333);  // Example: bottom-left corner of the rectangle
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);  // Example: top-right corner of the rectangle

void rpenLegacyMain() {
    vec2 uv = rpenLegacyUv;

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
			gl_FragColor = rpenLegacySample(screenTexture, vec2(nuv.x, nuv.y));
			gl_FragColor.a = 1.0;
		}
		else
		{
			gl_FragColor = rpenLegacySample(screenTexture, rpenLegacyUv);
			gl_FragColor.a = 1.0;
		}
    } else {
        // Pixels outside the rectangle are not affected
        gl_FragColor = rpenLegacySample(screenTexture, rpenLegacyUv);
		gl_FragColor.a = 1.0;
    }
}
void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }
