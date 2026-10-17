#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D texture;
uniform float u_time; // 用于时间动态效果
uniform vec4 hologramColor; // Hologram 的颜色

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

void main() {
    vec2 uv = v_texCoord;
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
    
    // 颜色分离模拟 RGB 光的衍射效果
    float offset = sin(uv.y * 40.0 + u_time * 5.0) * 0.004;
    vec4 color;
    color.r = getcolor(uv + vec2(offset, 0.0)).r;
    color.g = getcolor(uv + vec2(0.0, 0.0)).g;
    color.b = getcolor(uv + vec2(offset, 0.0)).b;
    
    // 加入扫描线效果
    float scanline = sin((uv.y + u_time * 0.5) * 100.0) * 0.1;
    color.rgb -= scanline;
    
    // 应用 Hologram 颜色调制
    color *= hologramColor;

    // 模拟全息静电噪声
    float noise = fract(sin(dot(uv * u_time, vec2(12.9898, 78.233))) * 43758.5453);
    color.rgb += noise * 0.05;
    
    // 输出最终效果
    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}
