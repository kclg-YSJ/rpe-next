#ifdef GL_ES
precision mediump float;
#endif

uniform vec2 lightpos; // 镜头炫光光源的位置
uniform float power;   // 镜头炫光的强度

varying vec2 v_texCoord; // 纹理坐标
uniform sampler2D u_texture; // 输入的纹理
uniform vec2 resolution;

void main()
{
    vec2 uv = v_texCoord;

    vec4 color = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
    
    // 根据屏幕分辨率调整uv坐标的比例，保持宽高比
    vec2 norm_uv = (uv * resolution - resolution * 0.5) / resolution.y;
    vec2 norm_lightpos = (lightpos * resolution - resolution * 0.5) / resolution.y;

    // 计算当前像素与光源位置的距离
    float distance = length(norm_uv - norm_lightpos);

    // 根据距离计算炫光效果，距离越近效果越强
    float glow = power / (distance * distance);

    // 混合炫光效果和原始颜色
    vec3 finalColor = color.rgb + vec3(glow);

    // 输出最终颜色
    gl_FragColor = vec4(finalColor, 1.0);
}
