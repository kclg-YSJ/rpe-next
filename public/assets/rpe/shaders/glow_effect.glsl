#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec2 resolution;
uniform float intensity;   // Bloom 强度
uniform float threshold;   // 亮度阈值

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(CC_Texture0, uv);
	else
		return vec4(0, 0, 0, 1);
}

float calculateLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec2 uv = v_texCoord;
    vec3 color = texture2D(CC_Texture0, uv).rgb;
	
    uv.x = uv.x / 0.7031;
    uv.y = (uv.y - 0.0333) * 1.2;

    float luminance = calculateLuminance(color);
  
    vec3 bloom = vec3(0.0);
    
    if (luminance > threshold) {
        for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
                vec2 offset = vec2(float(x), float(y)) / resolution;
                vec3 sampleColor = getcolor(uv + offset).rgb;
                bloom += sampleColor;
            }
        }
        bloom /= 25.0;
        bloom *= intensity;
    }
	
    vec3 finalColor = color + bloom;
    
    gl_FragColor = vec4(finalColor, 1.0);
}
