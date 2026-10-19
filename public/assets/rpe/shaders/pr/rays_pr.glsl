#version 100
precision mediump float;

varying vec2 uv;

uniform sampler2D screenTexture; // 场景纹理

uniform vec2 lightpos; // %0.5, 0.5%
uniform float exposure; // %0.5%
uniform float decay; // %0.95%
uniform float density; // %0.5%
uniform float weight; // %0.3%

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);
vec4 getcolor(vec2 uv)
{
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(screenTexture, uv);
	else
		return vec4(0.0, 0.0, 0.0, 1.0);
}


void main()
{
    // 从纹理中获取当前像素的颜色
    vec4 color = texture2D(screenTexture, uv);

    // 光源到当前像素的方向
    vec2 deltaTexCoord = uv - lightpos;

    // 迭代次数决定光束的长度
    float illuminationDecay = 1.0;
    vec4 godRays = vec4(0.0);

    // 采样次数，可以根据需要调整
    const int samples = 100;
	
	vec2 _uv = uv;

    for (int i = 0; i < samples; i++)
    {
        // 沿光束方向逐渐采样
        _uv -= deltaTexCoord * density;
        vec4 sampleColor = getcolor(_uv);

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
