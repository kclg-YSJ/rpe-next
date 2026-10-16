#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float power; // %0.2%
uniform float density; // %400.0%
uniform float u_time; // 时间变量

float rand(vec2 co) {
    return fract(sin(dot(co.xy * u_time * 0.05, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p);
    vec2 u = fract(p);
    u = u*u*(3.0-2.0*u);
    
    float res = mix(
        mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
        mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
        u.y
    );
    return res;
}

void main() {
	vec2 uv = v_texCoord;
    vec4 color = texture2D(CC_Texture0, v_texCoord);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
    
    // 噪点随时间变化，加入uv扰动
    float noisyFactor = noise(uv * density + u_time * 0.1) * 2.0 - 1.0;
    
    // 添加噪点
    vec4 noisyColor = color + vec4(vec3(noisyFactor) * power, 0.0);
    
    gl_FragColor = noisyColor;
    gl_FragColor.a = 1.0;
}