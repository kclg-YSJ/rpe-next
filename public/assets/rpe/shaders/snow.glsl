#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_time;             // 用于控制时间
uniform vec2 resolution;        // 屏幕分辨率
uniform float speedx;  // 横向速度
uniform float speedy;    // 纵向速度
uniform float snowCount;        // 雪花数量
uniform float size;
uniform vec4 color;

// 随机函数，用于生成雪花随机位置
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// 模拟雪花飘落
void main() {
    vec2 uv = v_texCoord;

    // 获取背景颜色
    vec4 bgColor = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 初始化颜色
    vec4 snowColor = color; // 白色雪花，透明度为0表示未覆盖
	bool cover = false;

    // 遍历雪花
    for (float i = 0.0; i < snowCount; i++) {
        // 基于时间和索引生成随机雪花位置
        float xRandom = random(vec2(i, i)) * resolution.x;
        float yRandom = random(vec2(i, i)) * resolution.y;

        // 雪花的初始位置
		vec2 snowPos = vec2(
			mod(xRandom + sin(u_time + i) * speedx * (1.0 + random(vec2(i, i)) / 5.0), resolution.x), // 基于传入的横向速度
			mod(resolution.y - mod(u_time * speedy + yRandom + i * 30.0, resolution.y), resolution.y) * (1.0 + random(vec2(i + 1.0, i + 1.0)) / 5.0) // 基于传入的纵向速度
		);

		float baseSize = size; // 基础大小
        float sizeVariation = 0.004; // 大小变化幅度
        float size = baseSize + sizeVariation * sin(u_time + i);

        // 计算当前像素与雪花位置的距离
        float dist = distance(uv * resolution, snowPos);

        // 如果像素位于雪花内，则设置雪花颜色
        if (dist < size * resolution.x) {
            float alpha = smoothstep(size * resolution.x, 0.0, dist);
            snowColor = mix(snowColor, vec4(1.0, 1.0, 1.0, alpha), alpha);
			cover = true;
        }
    }

	if(cover == true)
	{
		// 将雪花叠加到背景图片上
		gl_FragColor = mix(bgColor, snowColor, snowColor.a);
		gl_FragColor.a = 1.0;
	}
	else
	{
		gl_FragColor = bgColor;
		gl_FragColor.a = 1.0;
	}
}
