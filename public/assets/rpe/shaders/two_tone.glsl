#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec4 color1;  // 第一种颜色 (包含 alpha)
uniform vec4 color2;  // 第二种颜色 (包含 alpha)
uniform float threshold;  // 亮度阈值

void main() {
    vec4 texColor = texture2D(CC_Texture0, v_texCoord);  // 获取纹理颜色
    float brightness = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));  // 计算亮度

    vec4 finalColor = brightness < threshold ? color1 : color2;  // 根据亮度应用不同颜色
    // 使用纹理的透明度来调整最终的 alpha
    gl_FragColor = vec4(finalColor.rgb, 1.0);
}
