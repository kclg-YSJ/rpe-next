// GodRays.frag
precision mediump float;

varying vec2 v_texCoord;

uniform sampler2D u_texture; // 场景纹理
uniform vec2 lightpos; // 光源在屏幕上的坐标
uniform float exposure; // 曝光强度
uniform float decay; // 衰减率
uniform float density; // 光束密度
uniform float weight; // 每次采样的权重

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(CC_Texture0, uv);
	else
		return vec4(0.0, 0.0, 0.0, 1.0);
}


void main()
{
    // 从纹理中获取当前像素的颜色
    vec4 color = texture2D(CC_Texture0, v_texCoord);
	
	vec2 uv = v_texCoord;
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 光源到当前像素的方向
    vec2 deltaTexCoord = uv - lightpos;

    // 迭代次数决定光束的长度
    float illuminationDecay = 1.0;
    vec4 godRays = vec4(0.0);

    // 采样次数，可以根据需要调整
    const int samples = 100;

    for (int i = 0; i < samples; i++)
    {
        // 沿光束方向逐渐采样
        uv -= deltaTexCoord * density;
        vec4 sampleColor = getcolor(uv);

        // 逐步衰减
        sampleColor *= illuminationDecay * weight;

        // 累加结果
        godRays += sampleColor;

        // 计算衰减
        illuminationDecay *= decay;
    }

    // 将 God Rays 叠加到原始颜色上
    color += godRays * exposure;

    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}
