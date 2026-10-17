#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;
uniform float u_time;  // 时间变量，用于波浪效果
uniform vec2 resolution;  // 屏幕分辨率

void main() {
    vec2 uv = v_texCoord;
	vec4 color = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
	
    float wave = sin(uv.y * 10.0 + u_time * 5.0) * 0.01;
    uv.x += wave;

    // 为水下效果添加蓝绿色调
    vec3 underwaterColor = vec3(0.0, 0.4, 0.6);
    color.rgb = mix(color.rgb, underwaterColor, 0.4);

    // 添加一些模糊来模拟水的光线散射
    float blur = sin(u_time * 1.5) * 0.005;
	uv = uv + vec2(blur, blur);
	
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;
	
    vec4 blurColor = texture2D(CC_Texture0, uv) * 0.9;
    color = mix(color, blurColor, 0.5);

    // 输出最终颜色
    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}
