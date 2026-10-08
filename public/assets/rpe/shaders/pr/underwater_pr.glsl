#version 100
precision mediump float;

varying vec2 uv; // 纹理坐标
uniform float time;  // 时间变量，用于波浪效果
uniform vec2 screenSize;  // 屏幕分辨率
uniform sampler2D screenTexture; // 输入的屏幕纹理

void main() {
    vec2 uvCoord = uv;
    vec4 color = texture2D(screenTexture, uvCoord);
    
    // 计算波浪效果
    float wave = sin(uvCoord.y * 10.0 + time * 5.0) * 0.01;
    uvCoord.x += wave;

    // 为水下效果添加蓝绿色调
    vec3 underwaterColor = vec3(0.0, 0.4, 0.6);
    color.rgb = mix(color.rgb, underwaterColor, 0.4);

    // 添加一些模糊来模拟水的光线散射
    float blur = sin(time * 1.5) * 0.005;
    uvCoord += vec2(blur, blur);
    
    vec4 blurColor = texture2D(screenTexture, uvCoord) * 0.9;
    color = mix(color, blurColor, 0.5);

    // 输出最终颜色
    gl_FragColor = color;
    gl_FragColor.a = 1.0;
}
