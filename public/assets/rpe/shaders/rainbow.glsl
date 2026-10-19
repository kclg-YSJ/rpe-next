#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
varying vec4 v_fragmentColor;

uniform sampler2D u_texture;
uniform float power;  // 彩虹光叠加强度

void main()
{
    vec2 uv = v_texCoord;
    // 从纹理获取图像的颜色
    vec4 textureColor = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 获取纹理坐标的横纵比例
    float coordFactor = mod(uv.x + uv.y, 1.0);
    
    // 生成彩虹色光效果
    vec3 rainbowColor = vec3(sin(6.2831 * coordFactor), sin(6.2831 * (coordFactor + 0.33)), sin(6.2831 * (coordFactor + 0.66)));
    
    // 调整彩虹色的强度
    rainbowColor = 0.5 * rainbowColor + 0.5;

    // 通过 power 控制叠加彩虹色的强度
    vec4 finalColor = vec4(mix(textureColor.rgb, rainbowColor, power), textureColor.a);
    
    gl_FragColor = finalColor * v_fragmentColor;
	gl_FragColor.a = 1.0;
}
