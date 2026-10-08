#ifdef GL_ES
precision mediump float;
#endif

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;

uniform sampler2D u_texture;
uniform float power; // 扫描线的强度，0-1之间
uniform float u_time; // 用于动态效果的时间变量

void main()
{
    vec2 uv = v_texCoord;
    // 读取当前像素的颜色
    vec4 color = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
    
    // 获取当前像素的y坐标（范围是0到1）
    float scanline = sin((uv.y * 800.0 + u_time * 5.0) * 3.14159 * 2.0); // 模拟扫描线
    float intensity = 1.0 - power * (scanline * 0.5 + 0.5);
    
    // 将扫描线的效果应用到颜色上
    color.rgb *= intensity;
    
    gl_FragColor = color;
	gl_FragColor.a = 1.0;
}
