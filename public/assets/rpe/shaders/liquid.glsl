#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform float u_time;
uniform float frequency;  // 频率
uniform float amplitude;  // 振幅

varying vec4 v_fragmentColor;
varying vec2 v_texCoord;

void main()
{
    vec2 uv = v_texCoord;
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    vec2 offset = vec2(sin(uv.y * frequency + u_time) * amplitude, cos(uv.x * frequency + u_time) * amplitude);

    vec2 distortedUV = uv + offset;
	
	distortedUV.x = distortedUV.x * 0.7031;
	distortedUV.y = distortedUV.y / 1.2 + 0.0333;

    vec4 color = texture2D(CC_Texture0, distortedUV);

    gl_FragColor = v_fragmentColor * color;
	gl_FragColor.a = 1.0;
}
