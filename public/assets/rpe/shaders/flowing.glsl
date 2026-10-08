#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform float u_time;     // 时间参数
uniform float speed;      // 流光速度
uniform float power;      // 流光强度
uniform float width;      // 流光宽度
uniform vec4 color;
uniform vec2 direction;

varying vec2 v_texCoord;

void main() {
	vec3 lightColor = color.rgb;

    vec2 uv = v_texCoord;
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;

    float lightPos = mod(u_time * speed, 1.0);
    float halfWidth = width / 2.0;

    float dist = abs(dot(uv - vec2(lightPos, lightPos), direction));

    float intensity = smoothstep(halfWidth, 0.0, dist) * power;
	
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

    vec4 color = texture2D(CC_Texture0, uv);

    vec3 resultColor = color.rgb + lightColor * intensity;

    gl_FragColor = vec4(clamp(resultColor, 0.0, 1.0), 1.0);
}
