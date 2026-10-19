#version 100
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
