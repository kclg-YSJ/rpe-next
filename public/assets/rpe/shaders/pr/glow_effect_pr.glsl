#version 100
precision mediump float;

varying vec2 uv; // 替换v_texCoord
uniform sampler2D screenTexture; // 替换CC_Texture0和u_texture
uniform vec2 screenSize; // 替换resolution
uniform float time; // 替换u_time

uniform float intensity; // %0.6%
uniform float threshold; // %0.3%

vec4 getcolor(vec2 uv) {
    return texture2D(screenTexture, uv);
}

float calculateLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
    vec3 color = texture2D(screenTexture, uv).rgb; // 替换texture2D(CC_Texture0, uv)

    float luminance = calculateLuminance(color);

    vec3 bloom = vec3(0.0);
    
    if (luminance > threshold) {
        for (int x = -2; x <= 2; x++) {
            for (int y = -2; y <= 2; y++) {
                vec2 offset = vec2(float(x), float(y)) / screenSize; // 替换resolution为screenSize
                vec3 sampleColor = getcolor(uv + offset).rgb;
                bloom += sampleColor;
            }
        }
        bloom /= 25.0;
        bloom *= intensity;
    }
    
    vec3 finalColor = color + bloom;
    
    gl_FragColor = vec4(finalColor, 1.0);
}
