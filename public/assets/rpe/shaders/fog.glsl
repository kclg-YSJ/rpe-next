#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;

uniform vec4 fogColor;      // 雾的颜色，vec4 表示RGBA
uniform float fogStart;     // 雾的开始Y坐标
uniform float fogEnd;       // 雾的结束Y坐标
uniform float u_time;         // 用于动态变化的时间变量

void main() {
    // 读取纹理颜色
	vec2 uv = v_texCoord;
    vec4 color = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 使用Y坐标计算雾的基础浓度
    float fogFactor = clamp((fogEnd - uv.y) / (fogEnd - fogStart), 0.0, 1.0);


    // 将雾的颜色与原始颜色混合
    vec4 finalColor = mix(fogColor, color, fogFactor);

    gl_FragColor = vec4(finalColor.rgb, 1.0); // 最终颜色，使用原始透明度
}
