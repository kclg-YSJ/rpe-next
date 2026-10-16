#version 100
precision mediump float;

varying vec2 uv; // 材质 UV
uniform sampler2D screenTexture; // 屏幕材质
uniform vec2 screenSize; // 屏幕大小
uniform float strength; // %1.0%
uniform float time; // 时间，以秒为单位

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
        vec4 color = getcolor(uv + texOffset[i]);
        float intensity = dot(color.rgb, vec3(0.299, 0.587, 0.114));  // 转为灰度
        sumX += intensity * kernelX[i];
        sumY += intensity * kernelY[i];
    }

    float sobelValue = sqrt(sumX * sumX + sumY * sumY);

    vec3 finalColor = mix(originalColor, vec3(sobelValue), strength);

    gl_FragColor = vec4(finalColor, 1.0);
}
