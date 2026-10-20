#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;

// 传入的统一变量 (Uniforms)
uniform float u_time;     // 控制雨滴随时间下落的速度
uniform float density;    // 控制雨滴的密度 (循环次数)
uniform vec2 resolution;  // 屏幕的分辨率
uniform float width;      // 用作控制雨滴的基础宽度
uniform vec4 rainColor;   // 雨滴的颜色
uniform float height;     // 用作控制雨滴的基础高度
uniform float speed;      // 新增：雨丝下落速度乘数，默认为 1.0

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
    // 获取纹理坐标和背景颜色
    vec2 uv = v_texCoord;
	vec4 bgColor = texture2D(CC_Texture0, uv);
	
	// --- 保留的坐标转换逻辑 ---
	uv.x = uv.x / 0.7031;
	uv.y = (uv.y - 0.0333) * 1.2;

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
        float drop_x = random(vec2(i, 0.0)) * resolution.x;
        float drop_y_start = random(vec2(i, 1.0)) * resolution.y * 1.5;
        // 在这里使用 speed 变量来调节基础下落速度
        float drop_y = mod(drop_y_start - u_time * 2000.0 * speed * rand_speed, resolution.y * 1.5);
        vec2 dropPos = vec2(drop_x, drop_y);

        // --- 3. 计算雨滴的最终尺寸 ---
        float dropWidth = width * 5.0 * rand_width;
        float dropHeight = height * 50.0 * rand_height;

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