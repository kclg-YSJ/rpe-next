#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform float progress; // 扭曲强度 [0, 1]
uniform float power;

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

void main()
{
    // 图像中心坐标
    vec2 center = vec2(0.5, 0.5);
	
	vec2 uv = v_texCoord;
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
    
    // 计算当前纹理坐标到中心的向量
    vec2 direction = uv - center;
    
    // 计算距离与方向的旋转角度
    float distance = length(direction);
    
    // 控制扭曲效果，progress 控制强度
    float angle = progress * distance * power; // 调整 10.0 来控制最大扭曲
    
    // 计算旋转后的纹理坐标
    float sinAngle = sin(angle);
    float cosAngle = cos(angle);
    vec2 twistedCoord = vec2(
        direction.x * cosAngle - direction.y * sinAngle,
        direction.x * sinAngle + direction.y * cosAngle
    );
    
    // 应用扭曲后的坐标
    uv = center + twistedCoord;
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y) {
		vec4 color = texture2D(CC_Texture0, uv);
		gl_FragColor = color;
		gl_FragColor.a = 1.0;
	} else {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}
