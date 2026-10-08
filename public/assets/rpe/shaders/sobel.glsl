#ifdef GL_ES
precision mediump float;
#endif

varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 resolution;
uniform float strength;

const vec2 rectMin = vec2(0.0, 0.033);
const vec2 rectMax = vec2(0.703, 0.867);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;
	
	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return texture2D(CC_Texture0, uv);
	else
		return vec4(0, 0, 0, 1);
}

void main()
{
    // Sobel 核
    float kernelX[9];
    float kernelY[9];

    kernelX[0] = -1.0; kernelX[1] = 0.0; kernelX[2] = 1.0;
    kernelX[3] = -2.0; kernelX[4] = 0.0; kernelX[5] = 2.0;
    kernelX[6] = -1.0; kernelX[7] = 0.0; kernelX[8] = 1.0;

    kernelY[0] = -1.0; kernelY[1] = -2.0; kernelY[2] = -1.0;
    kernelY[3] = 0.0;  kernelY[4] = 0.0;  kernelY[5] = 0.0;
    kernelY[6] = 1.0;  kernelY[7] = 2.0;  kernelY[8] = 1.0;

    vec2 texOffset[9];
    texOffset[0] = vec2(-1.0, -1.0) / resolution;
    texOffset[1] = vec2( 0.0, -1.0) / resolution;
    texOffset[2] = vec2( 1.0, -1.0) / resolution;
    texOffset[3] = vec2(-1.0,  0.0) / resolution;
    texOffset[4] = vec2( 0.0,  0.0) / resolution;
    texOffset[5] = vec2( 1.0,  0.0) / resolution;
    texOffset[6] = vec2(-1.0,  1.0) / resolution;
    texOffset[7] = vec2( 0.0,  1.0) / resolution;
    texOffset[8] = vec2( 1.0,  1.0) / resolution;

    float sumX = 0.0;
    float sumY = 0.0;
	
	vec2 uv = v_texCoord;
	vec3 originalColor = texture2D(CC_Texture0, uv).rgb;
	
	uv.x = uv.x / 0.7031;
	uv.y =(uv.y - 0.0333) * 1.2;
    
    for (int i = 0; i < 9; i++) {
        vec4 color = getcolor(uv + texOffset[i]);
        float intensity = dot(color.rgb, vec3(0.299, 0.587, 0.114));  // 转为灰度
        sumX += intensity * kernelX[i];
        sumY += intensity * kernelY[i];
    }

    float sobelValue = sqrt(sumX * sumX + sumY * sumY);
	
	vec3 finalColor = mix(originalColor, vec3(sobelValue), strength);
	
    gl_FragColor = vec4(finalColor, 1.0);
}
