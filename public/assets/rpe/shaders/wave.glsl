#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform float u_time;  // 控制波浪的时间
uniform float speed; // 控制波浪的速度
uniform vec2 direction; // 控制波浪的方向
uniform float frequency; // 波动频率
uniform float amplitude; // 波动幅度

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
	
    // 计算方向向量影响下的波动
    float wave = sin(dot(uv, direction * frequency) + u_time * speed) * amplitude;

    // 将波动效果应用到纹理坐标上，使其沿给定方向和速度波动
    vec2 distortedTexCoord = vec2(uv.x + wave, uv.y + wave);

    gl_FragColor = getcolor(distortedTexCoord);
	gl_FragColor.a = 1.0;
}
