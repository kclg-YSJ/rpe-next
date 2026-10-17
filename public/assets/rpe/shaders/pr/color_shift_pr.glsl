#version 100
precision mediump float;

uniform sampler2D screenTexture;
varying vec2 uv;

uniform float hueShift; // %0.0%
uniform float saturationShift; // %0.0%
uniform float valueShift; // %0.0%

// RGB 转 HSV
vec3 rgb2hsv(vec3 c)
{
    float cMax = max(c.r, max(c.g, c.b));
    float cMin = min(c.r, min(c.g, c.b));
    float delta = cMax - cMin;

    float h = 0.0;
    if(delta > 0.0)
    {
        if(cMax == c.r)
            h = mod((c.g - c.b) / delta, 6.0);
        else if(cMax == c.g)
            h = (c.b - c.r) / delta + 2.0;
        else
            h = (c.r - c.g) / delta + 4.0;
        h /= 6.0;
    }

    float s = (cMax > 0.0) ? (delta / cMax) : 0.0;
    float v = cMax;

    return vec3(h, s, v);
}


// HSV 转 RGB
vec3 hsv2rgb(vec3 c)
{
    float h = c.x * 6.0;
    float s = c.y;
    float v = c.z;

    float c1 = v * s;
    float x = c1 * (1.0 - abs(mod(h, 2.0) - 1.0));
    float m = v - c1;

    vec3 rgb;

    if(h >= 0.0 && h < 1.0)
        rgb = vec3(c1, x, 0.0);
    else if(h >= 1.0 && h < 2.0)
        rgb = vec3(x, c1, 0.0);
    else if(h >= 2.0 && h < 3.0)
        rgb = vec3(0.0, c1, x);
    else if(h >= 3.0 && h < 4.0)
        rgb = vec3(0.0, x, c1);
    else if(h >= 4.0 && h < 5.0)
        rgb = vec3(x, 0.0, c1);
    else
        rgb = vec3(c1, 0.0, x);

    return rgb + vec3(m);
}


void main()
{
    // 获取当前像素颜色
    vec4 color = texture2D(screenTexture, uv);
    
    // 将 RGB 转为 HSV
    vec3 hsv = rgb2hsv(color.rgb);
    
    // 调整色相
    hsv.x += hueShift;
    hsv.x = fract(hsv.x); // 保持色相在 [0, 1] 范围内
	
	hsv.y += saturationShift;
	hsv.y = clamp(hsv.y, 0.0, 1.0); // 限制在 [0, 1]

	hsv.z += valueShift;
	hsv.z = clamp(hsv.z, 0.0, 1.0); // 限制在 [0, 1]
    
    // 将 HSV 转回 RGB
    vec3 rgb = hsv2rgb(hsv);
    
    // 输出最终颜色
    gl_FragColor = vec4(rgb, 1.0);
}
