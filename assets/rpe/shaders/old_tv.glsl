#version 100
// Both branches expose the Phira GLSL 1.00 interface. The compatibility
// branch preserves old charts that explicitly selected the RPE source.
#ifdef RPEN_LEGACY_SOURCE
precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;
uniform float time;
vec2 rpenLegacyUv;
vec4 rpenLegacySample(sampler2D source, vec2 point) {
 vec2 local = (point - vec2(0.0, 0.0333)) / vec2(0.7031, 1.0 / 1.2);
 if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
 return texture2D(source, local);
}
vec4 rpenLegacyProj(sampler2D source, vec4 point) { return rpenLegacySample(source, point.xy / point.w); }
vec4 rpenLegacyProj(sampler2D source, vec3 point) { return rpenLegacySample(source, point.xy / point.z); }
#ifdef GL_ES
precision mediump float;
#endif





const float noiseIntensity = 0.2;
const float stripeIntensity = 800.0;
const float sepiaIntensity = 0.5;
const mat3 sepia = mat3(
    0.393, 0.349, 0.272,
    0.769, 0.686, 0.534,
    0.189, 0.168, 0.131);

const float flickerFrequency = 0.0;  // Flicker frequency

const vec2 rectMin = vec2(0.0, 0.0333);
const vec2 rectMax = vec2(0.0, 0.0333) + vec2(0.7031, 1.0 / 1.2);
vec4 getcolor(vec2 uv)
{
	uv.x = uv.x * 0.7031;
	uv.y = uv.y / 1.2 + 0.0333;

	if (uv.x >= rectMin.x && uv.x <= rectMax.x && uv.y >= rectMin.y && uv.y <= rectMax.y)
		return rpenLegacySample(screenTexture, uv);
	else
		return vec4(0, 0, 0, 1);
}
// Generate dynamic noise for TV static
float dynamicNoise(vec2 uv, float time)
{
    return fract(sin(dot(uv + time, vec2(12.9898, 78.233))) * 43758.5453);
}

// Simulate a vignette effect (darkening near the edges)
float vignette(vec2 uv)
{
    vec2 dist = uv - vec2(0.5);
    return smoothstep(0.7, 0.1, dot(dist, dist) * 0.8);
}

// Apply chromatic aberration by slightly offsetting color channels
vec3 chromaticAberration(vec2 uv)
{
    float offset = 0.002;  // Amount of color misalignment
    float r = getcolor(uv + vec2(offset, 0.0)).r;
    float g = getcolor(uv + vec2(0,0)).g;
    float b = getcolor(uv + vec2(offset, 0.0)).b;
    return vec3(r, g, b);
}

// Screen flicker effect (modulates brightness over time)
float screenFlicker(float time)
{
    return 0.9 + 0.1 * sin(time * flickerFrequency);  // Adjust intensity here
}


void rpenLegacyMain()
{
    vec2 uv = rpenLegacyUv;
	vec4 color = rpenLegacySample(screenTexture, uv);

    uv.x = uv.x / 0.7031;
    uv.y = (uv.y - 0.0333) * 1.2;

    // Apply chromatic aberration
    vec3 colorWithCA = chromaticAberration(uv);

    // Add dynamic noise
    float n = dynamicNoise(uv, time * 10.0);
    vec3 result = mix(colorWithCA, vec3(n), noiseIntensity);

    // Apply scanline effect
    vec2 sc = vec2((sin(uv.y * stripeIntensity) + 1.0) / 2.0, (cos(uv.y * stripeIntensity) + 1.0) / 2.0);
    result += colorWithCA * sc.xyx;

    // Apply sepia tone
    mat3 sepiaDiff = mat3(1.0) + sepiaIntensity * (sepia - mat3(1.0));
    result = sepiaDiff * result;

    // Add vignette effect
    result *= vignette(uv);

    // Screen flicker effect (brightness modulation)
    result *= screenFlicker(time);


	float down = -time * 0.5;
    float up = -time * 0.5 + 0.15;
    down = mod(down, 1.0);
    up = mod(up, 1.0);

    if (up >= down && uv.y == clamp(uv.y, down, up))
        result = mix(result, vec3(0.0), 0.2);

    if (up < down && (uv.y <= up || uv.y >= down))
        result = mix(result, vec3(0.0), 0.2);

    // Apply final color
    gl_FragColor = vec4(result, 1.0);
}

void main() { rpenLegacyUv = vec2(0.0, 0.0333) + uv * vec2(0.7031, 1.0 / 1.2); rpenLegacyMain(); }

#else
precision highp float;

varying vec2 uv;
uniform sampler2D screenTexture;
uniform float time;

const float noiseIntensity = 0.2;
const float stripeIntensity = 800.0;
const float sepiaIntensity = 0.5;
const mat3 sepia = mat3(
    0.393, 0.349, 0.272,
    0.769, 0.686, 0.534,
    0.189, 0.168, 0.131);

const float flickerFrequency = 0.0;  // Flicker frequency

vec4 getcolor(vec2 uv)
{
	return texture2D(screenTexture, uv);
}
// Generate dynamic noise for TV static
float dynamicNoise(vec2 uv, float time)
{
    return fract(sin(dot(uv + time, vec2(12.9898, 78.233))) * 43758.5453);
}

// Simulate a vignette effect (darkening near the edges)
float vignette(vec2 uv)
{
    vec2 dist = uv - vec2(0.5);
    return smoothstep(0.7, 0.1, dot(dist, dist) * 0.8);
}

// Apply chromatic aberration by slightly offsetting color channels
vec3 chromaticAberration(vec2 uv)
{
    float offset = 0.002;  // Amount of color misalignment
    float r = getcolor(uv + vec2(offset, 0.0)).r;
    float g = getcolor(uv + vec2(0,0)).g;
    float b = getcolor(uv + vec2(offset, 0.0)).b;
    return vec3(r, g, b);
}

// Screen flicker effect (modulates brightness over time)
float screenFlicker(float time)
{
    return 0.9 + 0.1 * sin(time * flickerFrequency);  // Adjust intensity here
}


void main()
{
	vec4 color = texture2D(screenTexture, uv);

    // Apply chromatic aberration
    vec3 colorWithCA = chromaticAberration(uv);

    // Add dynamic noise
    float n = dynamicNoise(uv, time * 10.0);
    vec3 result = mix(colorWithCA, vec3(n), noiseIntensity);

    // Apply scanline effect
    vec2 sc = vec2((sin(uv.y * stripeIntensity) + 1.0) / 2.0, (cos(uv.y * stripeIntensity) + 1.0) / 2.0);
    result += colorWithCA * sc.xyx;

    // Apply sepia tone
    mat3 sepiaDiff = mat3(1.0) + sepiaIntensity * (sepia - mat3(1.0));
    result = sepiaDiff * result;

    // Add vignette effect
    result *= vignette(uv);

    // Screen flicker effect (brightness modulation)
    result *= screenFlicker(time);


	float down = -time * 0.5;
    float up = -time * 0.5 + 0.15;
    down = mod(down, 1.0);
    up = mod(up, 1.0);

    if (up >= down && uv.y == clamp(uv.y, down, up))
        result = mix(result, vec3(0.0), 0.2);

    if (up < down && (uv.y <= up || uv.y >= down))
        result = mix(result, vec3(0.0), 0.2);

    // Apply final color
    gl_FragColor = vec4(result, 1.0);
}

#endif
