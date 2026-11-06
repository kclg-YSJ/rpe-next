#version 100
precision highp float;
varying highp vec2 uv;

// Only this file declares editor defaults/ranges. The renderer shares these
// uniforms with any other pass that declares an identically named uniform.
uniform vec4 outlineColor;       // %0.42,0.83,0.97,1.0% 0.0..1.0
uniform float waterOpacity;      // %0.29% 0.0..1.0
uniform float waterBrightness;   // %1.0% 0.3..2.0
uniform float refractionPixels;  // %22.0% 0.0..65.0
uniform float turbulence;        // %1.15% 0.0..3.0
uniform float flowSpeed;         // %0.80% 0.0..4.0
uniform float causticIntensity;  // %0.56% 0.0..2.0
uniform float causticScale;      // %1.0% 0.2..4.0
uniform float causticSpeed;      // %0.85% 0.0..4.0
uniform float edgeWavePixels;    // %42.0% 0.0..65.0
uniform float edgeWaveSpeed;     // %1.35% 0.0..4.0
uniform float edgeHighlight;     // %1.35% 0.0..3.0
uniform float edgeFade;          // %0.55% 0.0..1.0
uniform float disabledOpacity;   // %0.22% 0.0..1.0
uniform float readyPulse;        // %0.18% 0.0..1.0
uniform float readySpeed;        // %37.9% 0.0..100.0
uniform float touchRipplePixels; // %11.0% 0.0..50.0
uniform float touchReleaseDuration; // %0.1% 0.0..1.0
uniform float touchRadius;       // %0.25% 0.02..0.40
uniform float touchHighlight;    // %0.95% 0.0..2.5
uniform vec4 touchWarningColor;  // %0.60,0.91,1.0,1.0% 0.0..1.0
uniform float touchHaloRadius;    // %0.52% 0.25..0.85
uniform float touchHaloIntensity; // %0.72% 0.0..1.5

uniform sampler2D screenTexture;
uniform sampler2D composeRT;
uniform sampler2D edgeBandRT;
uniform sampler2D touchHoverRT;
uniform sampler2D waterFlow;
// @texture tex/Flow.png wrap=repeat filter=linear colorspace=linear alphaMode=straight
uniform sampler2D waterCaustics;
// @texture tex/Caustics.png wrap=repeat filter=linear colorspace=linear alphaMode=straight
uniform sampler2D waterFoam;
// @texture tex/Foam.png wrap=repeat filter=linear colorspace=linear alphaMode=straight
uniform vec2 screenSize;
uniform float time;
uniform int touchCount;
uniform vec4 touchPoints[32];

// Coordinates for waves and caustics use SCREEN HEIGHT as the physical unit:
// patterns retain the same size under ultrawide or tall viewports.
vec2 physicalUV(vec2 p) {
    return p * screenSize / max(screenSize.y,1.0);
}

// A "pixel" parameter means a pixel at 1080p, not a fixed physical pixel.
// This maintains identical proportions at 720p/1080p/2160p while preserving
// the previous look at 1080p and any given screen aspect ratio.
vec2 referencePixelOffset(vec2 p, float pixelsAt1080) {
    return p * (pixelsAt1080 / 1080.0)
             * vec2(screenSize.y / max(screenSize.x, 1.0), 1.0);
}

// All flow images are raw UNORM with 0.5-centered R/G displacement.
vec2 movingFlow(vec2 p, float t) {
    vec2 f1=texture2D(waterFlow,p*0.78+vec2( .055,-.042)*t).rg*2.0-1.0;
    vec2 f2=texture2D(waterFlow,p*1.81+vec2(-.084, .064)*t).rg*2.0-1.0;
    vec2 f3=texture2D(waterFlow,p*3.25+vec2( .095, .088)*t).rg*2.0-1.0;
    return f1*.48+f2*.34+f3*.18;
}

// Ocean's shoreline movement is fundamentally a geometric effect. The wave
// field changes WHERE the compose mask is sampled, not just its texture color.
vec2 shoreWarp(vec2 p, vec2 f, float t) {
    vec2 v;
    v.x = sin(38.0*p.y+ 7.5*p.x+2.35*t)*.58
        + sin(61.0*p.y-13.0*p.x-3.1*t)*.24
        + f.x*.78;
    v.y = sin(33.0*p.x- 5.0*p.y-1.95*t)*.55
        + sin(54.0*p.x+16.0*p.y+2.72*t)*.22
        + f.y*.78;
    return v;
}

// Convert touch stage seconds to the hover scale used by this effect.
// The original contact footprint and brightness both use this same value.
float touchHoverFromStage(vec4 touchPoint) {
    if (touchPoint.w > 0.5)
        return clamp(touchPoint.z / 0.10, 0.0, 1.0);
    if (touchReleaseDuration <= 0.0) return 0.0;
    return clamp(1.0 - touchPoint.z / touchReleaseDuration, 0.0, 1.0);
}

vec2 touchRipple(vec2 p,float t) {
    vec2 d=vec2(0.0);
    for(int i=0;i<32;++i) {
        if(i>=touchCount)break;
        vec4 tp=touchPoints[i];
        tp.z=touchHoverFromStage(tp);
        if(tp.z<=0.0)continue;
        vec2 origin=physicalUV(tp.xy);
        vec2 delta=p-origin;
        float r=length(delta);
        float ring=sin(65.0*r-11.0*t);
        float envelope=exp(-r*10.0)*(1.0-smoothstep(.04,.45,r));
        d+=delta/max(r,0.0001)*ring*envelope*tp.z;
    }
    return d;
}

// Compensate for a slight edge/caustic color shift when outlineColor changes.
vec3 lightTint(vec3 base) {
    return mix(base,vec3(1.0),.74);
}

void main() {
    vec4 bg=texture2D(screenTexture,uv);
    vec2 p=physicalUV(uv);
    float t=time*flowSpeed;
    vec2 f=movingFlow(p,t);

    // Compare against NoiseField's ACTUAL compose displacement field, not
    // its Edge/Glow thickness: NoiseField moves the source Mask by a 0.1-UV
    // 2D noise vector. At 1920x1080 the sampled RMS is about 24.8px X and
    // 14.7px Y. Ocean's original 17-pixel waves were about 8.5px X / 8.1px
    // Y RMS. With 42px and axis calibration below, Ocean is about
    // 24.8px X / 14.6px Y RMS at the same reference aspect ratio.
    // Keep spatial wavelengths based on SCREEN HEIGHT, preserving round
    // water patterns and the earlier resolution-independent motion.
    vec2 w=shoreWarp(p,f,time*edgeWaveSpeed);
    float aspectCorrection=(screenSize.x/max(screenSize.y,1.0))/(1920.0/1080.0);
    vec2 waveUV=referencePixelOffset(w*vec2(1.18*aspectCorrection,0.73),edgeWavePixels);
    vec2 shapeUV=uv+waveUV;
    float m=texture2D(composeRT,shapeUV).r;
    vec2 bands=texture2D(edgeBandRT,shapeUV).rg;
    // Touch belongs to its own camera/target. It is deliberately NOT
    // sampled at shapeUV and never multiplied by the Active compose mask.
    // Therefore a press can cross the block edge and survive Hidden.
    float touchHover=texture2D(touchHoverRT,uv).r;

    // Separate wide-area touch illumination from the small touchHover core.
    // The core remains exactly as in Ocean v3. The broad light is evaluated
    // from accepted touch positions, so it can extend across an Active edge
    // and continue after the geometry disappears, like the independent
    // original TouchPos shine in NoiseField.
    float touchAura=0.0;
    for(int i=0;i<32;++i) {
        if(i>=touchCount) break;
        vec4 tp=touchPoints[i];
        tp.z=touchHoverFromStage(tp);
        if(tp.z<=0.0001) continue;
        float radius=max(0.001,touchHaloRadius*tp.z);
        vec2 delta=p-physicalUV(tp.xy);
        // Flow distorts only the silhouette of the diffused light slightly;
        // there are no hard concentric ring boundaries or added opaque tint.
        float rho=length(delta+f*0.018)/radius;
        float diffuse=exp(-2.7*rho*rho)*(1.0-smoothstep(0.64,1.0,rho));
        float val=clamp(diffuse*tp.z,0.0,1.0);
        // Union independent contacts smoothly instead of over-brightening
        // multi-touch regions with an unbounded additive sum.
        touchAura=1.0-(1.0-touchAura)*(1.0-val);
    }
    if(m + bands.r + bands.g + touchHover + touchAura < 0.0001) {
        gl_FragColor=bg;
        return;
    }
    // Wavy high-frequency centerline plus a soft inside/outside margin.
    float edgeLine=pow(max(0.0,1.0-abs(m-.5)*2.0),2.25);
    float shoreInside=bands.g;
    float shoreOutside=bands.r;
    float fill=smoothstep(0.025,0.96,m);

    // Use full-resolution screenTexture. No 1/4 pixelated scene copy.
    vec2 flow=(f+shoreWarp(p,f,t*.7)*.18)*turbulence;
    vec2 ripple=touchRipple(p,time);
    vec2 refrUV=clamp(uv + referencePixelOffset(flow,refractionPixels)
                      + referencePixelOffset(ripple,touchRipplePixels),0.0,1.0);
    vec3 refracted=texture2D(screenTexture,refrUV).rgb;

    // Two independent advected caustics fields. They change relative phase and
    // shape via flow warping, rather than sliding a static dark image over water.
    vec2 aUV = p*(causticScale*.85)+f*.21+vec2( .085,-.058)*time*causticSpeed;
    vec2 bUV = p*(causticScale*1.27)-f*.17+vec2(-.071, .102)*time*causticSpeed;
    float ca=texture2D(waterCaustics,aUV).r;
    float cb=texture2D(waterCaustics,bUV).r;
    float shimmer=clamp(ca*.82+cb*.49,0.0,1.0);
    shimmer=pow(shimmer,1.12);

    float foamSample=texture2D(waterFoam,p*1.35+vec2(.060,-.035)*time*edgeWaveSpeed+f*.2).r;
    float foamStrand=clamp(edgeLine*.75+shoreInside*.40+shoreOutside*.14,0.0,1.0);
    foamStrand *= mix(.48,1.20,foamSample);
    foamStrand *= .70+.30*sin(34.0*p.x+26.0*p.y-4.7*time*edgeWaveSpeed+f.x*5.0);
    foamStrand=max(0.0,foamStrand);

    // Transparent water: distorted original scene remains the dominant signal.
    // Color is introduced mainly as a small, luminous scattering component.
    vec3 aqua=mix(refracted,outlineColor.rgb,.34);
    float bodyAlpha=clamp(fill*(1.0-edgeFade*(shoreInside*.35+shoreOutside*.25))*outlineColor.a,0.0,1.0);
    vec3 water=mix(refracted,aqua,waterOpacity);
    vec3 result=mix(bg.rgb,water,bodyAlpha);

    // Caustics are a light contribution, not an opaque black/blue overlay.
    float causticMask=clamp(fill + shoreInside*.10,0.0,1.0);
    vec3 causticColor=mix(lightTint(outlineColor.rgb),vec3(1.0),.30);
    result += causticColor*shimmer*causticIntensity*.36*causticMask*outlineColor.a*waterBrightness;

    // Bright moving shoreline remains visible even on light scene backgrounds.
    // A small soft fringe extends OUTSIDE the original binary mask.
    float wetEdge=edgeHighlight*(edgeLine*.45+shoreInside*.29+shoreOutside*.17);
    vec3 edgeColor=lightTint(outlineColor.rgb);
    result += edgeColor*wetEdge*.32*outlineColor.a*waterBrightness;
    result += vec3(1.0)*wetEdge*foamStrand*.24*outlineColor.a;

    // LARGE, SOFT WATER-SURFACE ILLUMINATION around each accepted touch.
    // This is intentionally different from the sharp local caustic core below:
    // it makes a miss conspicuous on dark and cluttered backgrounds while
    // preserving Ocean's pale aqua/white palette and transparent scenery.
    // It is a low-frequency glow, not a filled colored disc or a red warning.
    if(touchAura>0.0001) {
        float glimmer=clamp(0.72+0.20*shimmer
                            +0.08*sin(time*2.6+p.x*8.0-p.y*5.0+f.x*2.0),
                            0.55,1.0);
        float strength=clamp(touchAura*touchHaloIntensity
                             *touchWarningColor.a*outlineColor.a*glimmer,
                             0.0,0.90);
        vec3 haloColor=mix(lightTint(outlineColor.rgb),
                           vec3(1.0),0.58);
        // Screen-like brightening preserves existing detail; no opaque fill.
        result += (vec3(1.0)-clamp(result,0.0,1.0))
                  *haloColor*strength;
    }

    // Touch is an independent camera effect, NOT clipped to Active. The
    // touchRadius = 0.25 screen-height footprint is intentionally identical
    // to the user-calibrated NoiseField contact MASK; it is NOT the diameter
    // of a fully opaque visible disk. NoiseField's SDF/FD_Noise modulation
    // makes its bright core considerably smaller than its input footprint.
    // Ocean also concentrates its visible highlights near the center.
    float touchAlpha=clamp(touchHover*outlineColor.a,0.0,1.0);
    if (touchAlpha > 0.0001) {
        vec2 touchUV=clamp(uv + referencePixelOffset(ripple,touchRipplePixels),
                           vec2(0.0),vec2(1.0));
        vec3 touchRefracted=texture2D(screenTexture,touchUV).rgb;
        // The displaced scene remains the dominant component: no opaque disk.
        result+=(touchRefracted-bg.rgb)*touchAlpha*(1.0-fill)*0.88;

        float innerSupport=0.0;
        float waterRing=0.0;
        float pulseLight=0.0;
        for(int i=0;i<32;++i) {
            if(i>=touchCount)break;
            vec4 tp=touchPoints[i];
        tp.z=touchHoverFromStage(tp);
            if(tp.z<=0.0001)continue;
            float radius=max(0.001,touchRadius*tp.z);
            float rho=length(p-physicalUV(tp.xy))/radius;
            if(rho>0.78)continue;
            float theta=atan(p.y-physicalUV(tp.xy).y,
                             p.x-physicalUV(tp.xy).x);
            // Very slight time-dependent waviness in the narrow surface ring.
            float ringPos=.33+.035*sin(3.6*time+float(i)*1.7)
                              +.021*sin(5.0*theta+time*2.0);
            float ring=exp(-pow((rho-ringPos)/.047,2.0));
            float fade=1.0-smoothstep(.48,.71,rho);
            float core=1.0-smoothstep(.20,.64,rho);
            waterRing=max(waterRing,ring*fade*tp.z);
            innerSupport=max(innerSupport,core*tp.z);
            pulseLight=max(pulseLight,fade*(.82+.18*sin(time*7.0))*tp.z);
        }

        // Periodic flowing caustics create broken brighter and dimmer patches,
        // analogous to NoiseField's nonuniform SDF contact texture.
        float textureLight=smoothstep(.20,.82,shimmer*.83+foamSample*.28);
        float gain=touchHighlight*touchWarningColor.a*outlineColor.a;
        float contact=clamp(touchAlpha*innerSupport,0.0,1.0);
        vec3 seaTint=mix(lightTint(outlineColor.rgb),touchWarningColor.rgb,.42);
        vec3 whiteTint=mix(seaTint,vec3(1.0),.75);

        // A restrained darker cyan trough makes the signal legible over
        // white backgrounds without changing the entire touch to coral/red.
        float trough=clamp(contact*(1.0-textureLight)*gain*.26,0.0,.24);
        result=mix(result, mix(result*.66,outlineColor.rgb*.38,.47),trough);

        // Bright but transparent caustic highlights, with natural dark gaps.
        float glint=clamp(contact*gain*(.16+.60*textureLight)*(.78+.22*pulseLight),0.0,.65);
        result=mix(result,seaTint,glint*.66);
        float rim=clamp(waterRing*gain*(.33+.20*textureLight),0.0,.51);
        result=mix(result,whiteTint,rim);
        float sparkle=clamp(contact*gain*pow(max(textureLight,0.0),3.0)*.17,0.0,.20);
        result=mix(result,vec3(1.0),sparkle);
    }

    gl_FragColor=vec4(clamp(result,0.0,1.0),bg.a);
}
