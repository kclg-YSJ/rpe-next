#version 100
precision highp float;

varying vec2 uv;

uniform float time;
uniform sampler2D screenTexture;

uniform float numBolts; // %10.0%
uniform float width; // %0.003%
uniform float flashDuration; // %1.0%
uniform float amplitude; // %0.3%
uniform float frequency; // %2.0%

float rand(vec2 co)
{
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

float noise(float x, float seed)
{
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    float a = rand(vec2(i, seed));
    float b = rand(vec2(i + 1.0, seed));
    return mix(a, b, u);
}

float randomPath(float y, float seed)
{
    float x = 0.0;
    float _amplitude = amplitude; // 总的偏移幅度
    float _frequency = frequency;  // 初始频率

    // 叠加多层噪声
    for(int i = 0; i < 10; i++)
    {
        float n = noise(y * _frequency, seed + float(i) * 10.0);
        x += (n - 0.5) * _amplitude;

        // 递增频率，递减幅度
        _frequency *= 2.0;
        _amplitude *= 0.5;
    }

    // 将 x 限制在 [0,1] 范围内
    x = clamp(x + rand(vec2(seed, seed)), 0.0, 1.0);

    return x;
}

void main()
{
    vec4 color = texture2D(screenTexture, uv);

    float totalTime = time;
    float seedTime = floor(totalTime / flashDuration);
    float seed = seedTime;
    float flashTime = fract(totalTime / flashDuration) * flashDuration;
    float fade = 1.0 - (flashTime / flashDuration);
    fade = pow(fade, 2.0);

    float lightning = 0.0;

    for(float i = 0.0; i < numBolts; i++)
    {
        float boltSeed = seed + i * 100.0;

        // 调用新的 randomPath 函数
        float x = randomPath(uv.y, boltSeed);

        float dist = abs(uv.x - x);

        lightning += smoothstep(width, 0.0, dist);
    }

    lightning = clamp(lightning, 0.0, 1.0);
    lightning *= fade;

    vec4 lightningColor = vec4(1.0, 1.0, 1.0, lightning);
    gl_FragColor = mix(color, lightningColor, lightning);
	gl_FragColor.a = 1.0;
}