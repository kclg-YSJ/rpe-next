#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec2 resolution;  // 纹理的分辨率
uniform float strength;

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
void main()
{
    vec2 uv = v_texCoord;
	vec4 originalColor = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
	
    // 获取纹理像素的偏移量
    vec2 offset = vec2(1.0 / resolution.x, 1.0 / resolution.y);

    // 获取周围的像素颜色
    vec4 colorTL = getcolor(uv + vec2(-offset.x, -offset.y)); // 左上
    vec4 colorBR = getcolor(uv + vec2(offset.x, offset.y));   // 右下

    // Emboss 卷积核计算
    vec4 embossColor = colorTL - colorBR;

    // 调整对比度
    embossColor += vec4(0.5, 0.5, 0.5, 1.0);
	
	embossColor = clamp(embossColor, 0.0, 1.0);
	
	vec4 finalColor = mix(originalColor, embossColor, strength);
    gl_FragColor = finalColor;
	
	gl_FragColor.a = 1.0;
}
