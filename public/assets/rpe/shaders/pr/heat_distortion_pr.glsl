#version 100
precision highp float;

varying vec2 uv;
uniform sampler2D screenTexture;       // 背景纹理
uniform float time;                // 用于动画的时间参数
uniform float strength; // %0.03%
uniform float frequency; // %1.0%

// 生成噪声函数（类似于简单的Perlin噪声）
float rand(vec2 co)
{
    return fract(sin(dot(co.xy ,vec2(12.9898, 78.233))) * 43758.5453);
}

// 生成二维噪声
float noise(vec2 pos)
{
    vec2 i = floor(pos);
    vec2 f = fract(pos);
    
    // 使用不同的随机种子生成不同的噪声值
    float a = rand(i);
    float b = rand(i + vec2(1.0, 0.0));
    float c = rand(i + vec2(0.0, 1.0));
    float d = rand(i + vec2(1.0, 1.0));
    
    // 进行插值来平滑噪声
    vec2 u = f*f*(3.0-2.0*f);
    
    return (mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y) * 2.0 - 1.0;
}

const vec2 rectMin = vec2(0.0, 0.0);
const vec2 rectMax = vec2(1.0, 1.0);

void main()
{
	vec4 oriColor = texture2D(screenTexture, uv);
	
	
    // 使用时间和纹理坐标生成动态噪声
    vec2 noiseCoord = uv * 5.0 + vec2(time * frequency, time * frequency);  // 缩放噪声纹理
    float noiseValue = noise(noiseCoord);
    
    // 使用噪声值生成扰动
    vec2 newuv = uv + vec2(noiseValue) * strength;

	if (newuv.x >= rectMin.x && newuv.x <= rectMax.x && newuv.y >= rectMin.y && newuv.y <= rectMax.y) 
	{
		gl_FragColor = texture2D(screenTexture, newuv);
	}
	else
	{
		gl_FragColor = vec4(0, 0, 0, 1);
	}
	gl_FragColor.a = 1.0;
}
