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
precision mediump float;



uniform float radius; // %15%
uniform vec2 resolution; // %1350,900%
uniform float sampleCount; // %3%

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
    // 计算步长，基于采样次数
    float stepW = radius / (sampleCount);
    float stepH = radius / (sampleCount);

    // 存储采样颜色
    vec3 colorSum = vec3(0.0);
    vec3 maxColor = vec3(0.0);
    int maxCount = 0;

	vec2 uv = rpenLegacyUv;

	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 模拟多个方向上的采样，创造出模糊的“笔触”效果
    for (float i = -sampleCount; i <= sampleCount; i++)
    {
        for (float j = -sampleCount; j <= sampleCount; j++)
        {
            // 计算采样的偏移量
            vec2 offset = vec2(i * stepW, j * stepH);
            vec3 sampleColor = getcolor(uv + offset).rgb;

            // 累计颜色
            colorSum += sampleColor;

            // 记录出现最多的颜色
            int count = 0;
            for (float m = -1.0; m <= 1.0; m++)
            {
                for (float n = -1.0; n <= 1.0; n++)
                {
                    vec3 compareColor = getcolor(uv + vec2(m * stepW, n * stepH)).rgb;
                    if (distance(sampleColor, compareColor) < 0.1)
                    {
                        count++;
                    }
                }
            }

            if (count > maxCount)
            {
                maxCount = count;
                maxColor = sampleColor;
            }
        }
    }

    // 将最多颜色与整体颜色混合，形成油画效果
    vec3 finalColor = mix(colorSum / float((2.0 * sampleCount + 1.0) * (2.0 * sampleCount + 1.0)), maxColor, 0.6);
    gl_FragColor = vec4(finalColor, 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision mediump float;

varying vec2 uv; // 材质 UV
uniform sampler2D screenTexture; // 屏幕材质
uniform float radius; // %0.01%
uniform vec2 screenSize; // 屏幕大小
uniform float sampleCount; // %5%

vec4 getcolor(vec2 uv)
{
    return texture2D(screenTexture, uv);
}

void main()
{
    // 计算步长，基于采样次数
    float stepW = radius / sampleCount;
    float stepH = radius / sampleCount;

    // 存储采样颜色
    vec3 colorSum = vec3(0.0);
    vec3 maxColor = vec3(0.0);
    int maxCount = 0;

    // 模拟多个方向上的采样，创造出模糊的“笔触”效果
    for (float i = -sampleCount; i <= sampleCount; i++)
    {
        for (float j = -sampleCount; j <= sampleCount; j++)
        {
            // 计算采样的偏移量
            vec2 offset = vec2(i * stepW, j * stepH);
            vec3 sampleColor = getcolor(uv + offset).rgb;

            // 累计颜色
            colorSum += sampleColor;

            // 记录出现最多的颜色
            int count = 0;
            for (float m = -1.0; m <= 1.0; m++)
            {
                for (float n = -1.0; n <= 1.0; n++)
                {
                    vec3 compareColor = getcolor(uv + vec2(m * stepW, n * stepH)).rgb;
                    if (distance(sampleColor, compareColor) < 0.1)
                    {
                        count++;
                    }
                }
            }

            if (count > maxCount)
            {
                maxCount = count;
                maxColor = sampleColor;
            }
        }
    }

    // 将最多颜色与整体颜色混合，形成油画效果
    vec3 finalColor = mix(colorSum / float((2.0 * sampleCount + 1.0) * (2.0 * sampleCount + 1.0)), maxColor, 0.6);
    gl_FragColor = vec4(finalColor, 1.0);
}

#endif
