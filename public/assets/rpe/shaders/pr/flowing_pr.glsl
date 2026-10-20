#version 100
precision mediump float;

uniform sampler2D screenTexture;
uniform float time;
uniform vec2 screenSize;

varying vec2 uv;

uniform float speed; // %1.0%
uniform float power; // %1.0%
uniform float width; // %0.2%
uniform vec4 color; // %1.0, 1.0, 0.5, 1.0%
uniform vec2 direction; // %1.0, 1.0%

void main() {
    vec3 lightColor = color.rgb;
    float lightPos = mod(time * speed, 1.0);
    float halfWidth = width / 2.0;

    float dist = abs(dot(uv - vec2(lightPos, lightPos), direction));

    float intensity = smoothstep(halfWidth, 0.0, dist) * power;

    vec4 texColor = texture2D(screenTexture, uv);

    vec3 resultColor = texColor.rgb + lightColor * intensity;

    gl_FragColor = vec4(clamp(resultColor, 0.0, 1.0), 1.0);
}
