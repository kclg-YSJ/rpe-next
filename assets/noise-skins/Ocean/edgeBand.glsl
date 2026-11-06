#version 100
precision highp float;
varying highp vec2 uv;

uniform sampler2D composeRT;
uniform vec2 composeRTSize;

// Original active geometry is still the engine's Screen/8 packed mask.
// This half-resolution pass constructs inside and outside vicinity bands.
// main.glsl displaces their sampling coordinates TOGETHER with the core mask,
// therefore highlights follow the moving shoreline rather than standing still.
void main() {
    vec2 t = 1.0 / max(composeRTSize, vec2(1.0));
    float core = texture2D(composeRT, uv).r;
    float hi = core;
    float lo = core;
    for (int y = -2; y <= 2; ++y) {
        for (int x = -2; x <= 2; ++x) {
            vec2 d = vec2(float(x), float(y)) * t * 1.05;
            float s = texture2D(composeRT, uv + d).r;
            hi = max(hi, s);
            lo = min(lo, s);
        }
    }
    // R=outside spray region, G=inside bright surf band.
    gl_FragColor = vec4(clamp(hi - core, 0.0, 1.0),
                        clamp(core - lo, 0.0, 1.0), 0.0, 1.0);
}
