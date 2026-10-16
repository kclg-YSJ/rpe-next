#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
varying vec4 v_fragmentColor;

uniform sampler2D u_texture;

// 控制变量：缩放倍率、中心偏移、旋转角度
uniform float zoom;      // 缩放倍率
uniform vec2 offset;     // 中心偏移
uniform float rotation;  // 旋转角度（弧度）
uniform vec2 resolution;

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

void main()
{
	vec2 uv = v_texCoord;
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    vec2 centeredCoord = uv - vec2(0.5, 0.5);
	float scale = resolution.y / resolution.x;
	centeredCoord.x = centeredCoord.x / scale;

    centeredCoord /= zoom;

    float sinAngle = sin(rotation * 3.1415926 / 180.0);
    float cosAngle = cos(rotation * 3.1415926 / 180.0);
    vec2 rotatedCoord = vec2(
        cosAngle * centeredCoord.x - sinAngle * centeredCoord.y,
        sinAngle * centeredCoord.x + cosAngle * centeredCoord.y
    );
	
	rotatedCoord.x = rotatedCoord.x * scale;

    rotatedCoord -= offset;

    uv = rotatedCoord + vec2(0.5, 0.5);
	
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) 
	{
		gl_FragColor = texture2D(CC_Texture0, uv);
		gl_FragColor.a = 1.0;
	} 
	else 
	{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}
