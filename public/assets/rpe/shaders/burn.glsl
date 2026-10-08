#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D texture;
uniform float progress; // 进度值，控制燃烧效果
uniform vec4 burnColor; // 燃烧后的颜色
uniform float u_time;     // 用于动态噪声的时间参数

// 生成伪随机数
float random(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

// 噪声函数，基于 uv 坐标生成噪声
float noise(vec2 uv) {
    vec2 p = floor(uv);
    vec2 f = fract(uv);
    // 使用双线性插值平滑噪声
    float a = random(p);
    float b = random(p + vec2(1.0, 0.0));
    float c = random(p + vec2(0.0, 1.0));
    float d = random(p + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vec2 uv = v_texCoord;
    vec4 color = texture2D(CC_Texture0, uv);
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    // 动态噪声，使用 uv 坐标和时间生成不规则噪声
    float burnNoise = noise(uv * 10.0 + vec2(u_time * 0.5, u_time * 0.5));
    
    // 控制燃烧效果的进展
    float burnFactor = progress - burnNoise;


    if (burnFactor < 0.0) {
        // 未燃烧部分，保留原始颜色
        gl_FragColor = color;
		gl_FragColor.a = 1.0;
    } else {
        // 燃烧中的区域，渐变为燃烧颜色并逐渐透明
        vec4 burnedColor = mix(color, burnColor, burnFactor);
        burnedColor.a = mix(1.0, 0.0, burnFactor);
        gl_FragColor = burnedColor;
    }
}
