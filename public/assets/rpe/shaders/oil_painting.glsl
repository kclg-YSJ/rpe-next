precision mediump float;

varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float radius; // 采样半径，决定油画的“笔触”大小
uniform vec2 resolution; // 画布的分辨率，用于确定每个像素的大小
uniform float sampleCount; // 采样次数，影响采样的密度

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
    // 计算步长，基于采样次数
    float stepW = radius / (sampleCount);
    float stepH = radius / (sampleCount);

    // 存储采样颜色
    vec3 colorSum = vec3(0.0);
    vec3 maxColor = vec3(0.0);
    int maxCount = 0;
	
	vec2 uv = v_texCoord;
	
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
