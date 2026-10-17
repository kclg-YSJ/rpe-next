#version 100
precision highp float;

// 输入变量
varying vec2 uv;                  // 纹理UV坐标 (从顶点着色器传入)
uniform vec2 screenSize;          // 屏幕分辨率
uniform sampler2D screenTexture;  // 背景纹理采样器
uniform float time;               // 时间，以秒为单位
uniform float density; // %30.0%
uniform float width; // %0.0005%
uniform vec4 rainColor; // %0.7, 0.8, 0.9, 0.6%
uniform float height; // %0.02%
uniform float speed; // %1.0%

/**
 * @brief 随机数生成函数
 * @param st 输入的二维向量
 * @return float 返回一个在[0, 1)范围内的伪随机数
 */
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// 主程序
void main() {
    // 获取背景颜色
    vec4 bgColor = texture2D(screenTexture, uv);
	
    // 初始化总的雨水亮度
    float total_rain_intensity = 0.0;
    // 获取当前片元的屏幕坐标
    vec2 fragCoord = gl_FragCoord.xy;

    // 循环生成雨滴，density 控制雨的密度
    for (float i = 0.0; i < density; i += 1.0) {
        // --- 1. 为每个雨滴增加随机属性 ---
        float seed = random(vec2(i, i));
        float rand_speed = 0.7 + seed * 0.8;
        float rand_width = 0.5 + random(vec2(i, seed)) * 0.8;
        float rand_height = 0.8 + random(vec2(seed, i)) * 1.2;
        float rand_brightness = 0.8 + seed * 0.7;

        // --- 2. 计算雨滴的位置 ---
        float drop_x = random(vec2(i, 0.0)) * screenSize.x;
        float drop_y_start = random(vec2(i, 1.0)) * screenSize.y * 1.5;
        // 在这里使用 speed 变量来调节基础下落速度
        float drop_y = mod(drop_y_start - time * 2000.0 * speed * rand_speed, screenSize.y * 1.5);
        vec2 dropPos = vec2(drop_x, drop_y);

        // --- 3. 计算雨滴的最终尺寸 ---
        // 这里的乘数用于匹配传入 width/height 的量级
        float dropWidth = width * 1000.0 * rand_width;
        float dropHeight = height * 1000.0 * rand_height; 

        // --- 4. 优化雨滴形状和渲染 ---
        float dist_y = fragCoord.y - dropPos.y;
        float dist_x = abs(fragCoord.x - dropPos.x);

        if (dist_y > 0.0 && dist_y < dropHeight && dist_x < dropWidth) {
            float normalized_dist_y = dist_y / dropHeight;
            float normalized_dist_x = dist_x / dropWidth;
            float intensity = 1.0 - normalized_dist_y;
            intensity *= smoothstep(1.0, 0.1, normalized_dist_x);
            total_rain_intensity += intensity * rand_brightness;
        }
    }

    // --- 5. 混合颜色 ---
    float final_intensity = clamp(total_rain_intensity, 0.0, 1.0);
    vec4 final_rain_color = vec4(rainColor.rgb, rainColor.a);
    gl_FragColor = mix(bgColor, final_rain_color, final_intensity * final_rain_color.a);
    gl_FragColor.a = 1.0;
}