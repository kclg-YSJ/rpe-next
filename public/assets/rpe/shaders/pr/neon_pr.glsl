#version 100
precision mediump float;

varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;

uniform float threshold; // %0.9%
uniform vec4 color; // %0.0, 1.0, 1.0, 1.0%

vec4 getcolor(vec2 uv)
{
	return texture2D(screenTexture, uv);
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
    texOffset[0] = vec2(-1.0, -1.0) / screenSize;
    texOffset[1] = vec2( 0.0, -1.0) / screenSize;
    texOffset[2] = vec2( 1.0, -1.0) / screenSize;
    texOffset[3] = vec2(-1.0,  0.0) / screenSize;
    texOffset[4] = vec2( 0.0,  0.0) / screenSize;
    texOffset[5] = vec2( 1.0,  0.0) / screenSize;
    texOffset[6] = vec2(-1.0,  1.0) / screenSize;
    texOffset[7] = vec2( 0.0,  1.0) / screenSize;
    texOffset[8] = vec2( 1.0,  1.0) / screenSize;

    float sumX = 0.0;
    float sumY = 0.0;
	
	vec3 originalColor = texture2D(screenTexture, uv).rgb;

    for (int i = 0; i < 9; i++) {
        vec4 _color = getcolor(uv + texOffset[i]);
        float intensity = dot(_color.rgb, vec3(0.299, 0.587, 0.114));  // 转为灰度
        sumX += intensity * kernelX[i];
        sumY += intensity * kernelY[i];
    }

    float sobelValue = sqrt(sumX * sumX + sumY * sumY);
	
	if (sobelValue > threshold){
		gl_FragColor = color;
	}
	else{
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
	}
}
