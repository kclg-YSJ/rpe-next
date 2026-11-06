#version 100
// Both branches expose the Phira GLSL 1.00 interface. The compatibility
// branch preserves old charts that explicitly selected the RPE source.
#ifdef RPEN_LEGACY_SOURCE
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
// GodRays.frag
precision mediump float;



 // 场景纹理
uniform vec2 lightpos; // %0.5,0.5%
uniform float exposure; // %1%
uniform float decay; // %1%
uniform float density; // %1%
uniform float weight; // %0.5%

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return rpenLegacySample(screenTexture, uv);
	else
		return vec4(0.0, 0.0, 0.0, 1.0);
}


void rpenLegacyMain()
{
    // 从纹理中获取当前像素的颜色
    vec4 color = rpenLegacySample(screenTexture, rpenLegacyUv);

	vec2 uv = rpenLegacyUv;

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

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
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

#endif
