#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);

uniform float segments;  // 控制分段数
uniform vec2 center;     // 中心点
uniform float angle;     // 旋转角度

void main() {
    vec2 uv = v_texCoord;
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
	
	uv = uv - center;  // 转换坐标到中心点
    float theta = atan(uv.y, uv.x) + angle;  // 计算角度并加入旋转
    float radius = length(uv);  // 计算半径

    // 计算角度映射到分段的区域
    float segAngle = 3.1415926 * 2.0 / segments;
    theta = mod(theta, segAngle);
    theta = abs(theta - segAngle / 2.0);  // 镜像变换

    // 重新计算 UV 坐标
    vec2 newUV = vec2(cos(theta), sin(theta)) * radius + center;
	
	newUV.x = newUV.x * 0.7031;
	newUV.y = newUV.y / 1.2 + 0.0333;
	
	if (newUV.x >= rectMin.x && newUV.x <= rectMax.x && newUV.y >= rectMin.y && newUV.y <= rectMax.y) {
		vec4 color = texture2D(CC_Texture0, newUV);
		gl_FragColor = color;
		gl_FragColor.a = 1.0;
	} else {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}
