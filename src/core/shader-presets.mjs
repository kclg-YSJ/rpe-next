const header = `#version 100
precision mediump float;
varying vec2 uv;
uniform sampler2D screenTexture;
uniform vec2 screenSize;
uniform float time;
`;
const preset = (id, uniforms, body) => ({ id, source: header + uniforms + '\nvoid main() {\n vec4 image = texture2D(screenTexture, uv);\n' + body + '\n}\n' });
// Original GLSL examples; none modify the bundled effects.
export const SHADER_PRESETS = [
  preset('passthrough', '', ' gl_FragColor = image;'),
  preset('posterize', 'uniform float levels; // %5.0% 2..32', ' gl_FragColor = vec4(floor(image.rgb * levels + 0.5) / levels, image.a);'),
  preset('solarize', 'uniform float threshold; // %0.5% 0..1', ' gl_FragColor = vec4(mix(image.rgb, 1.0-image.rgb, step(vec3(threshold), image.rgb)), image.a);'),
  preset('sepia', 'uniform float amount; // %1.0% 0..1', ' vec3 c = vec3(dot(image.rgb, vec3(.393,.769,.189)),dot(image.rgb,vec3(.349,.686,.168)),dot(image.rgb,vec3(.272,.534,.131)));\n gl_FragColor=vec4(mix(image.rgb,c,amount),image.a);'),
  preset('halftone', 'uniform float size; // %7.0% 2..40', ' vec2 p=uv*screenSize/size; float shade=dot(texture2D(screenTexture,(floor(p)+.5)*size/screenSize).rgb,vec3(.299,.587,.114));\n float ink=smoothstep(.02,-.02,length(fract(p)-.5)-.65*sqrt(max(0.0,1.0-shade))); gl_FragColor=vec4(vec3(1.0-ink),image.a);'),
  preset('dither', 'uniform float levels; // %3.0% 2..16', ' vec2 p=floor(uv*screenSize); float d=fract(dot(mod(p,4.0),vec2(.25,.625)))-.5; gl_FragColor=vec4(floor(image.rgb*levels+d+.5)/levels,image.a);'),
  preset('crossProcess', 'uniform float amount; // %0.8% 0..1', ' vec3 c=vec3(smoothstep(0.0,1.0,image.r),pow(image.g,.8),mix(.12,.9,image.b)); gl_FragColor=vec4(mix(image.rgb,c,amount),image.a);'),
  preset('hatching', 'uniform float density; // %70.0% 10..200', ' float light=dot(image.rgb,vec3(.299,.587,.114));float a=step(.3,fract((uv.x+uv.y)*density));float b=step(.3,fract((uv.x-uv.y)*density));gl_FragColor=vec4(vec3(mix(a,a*b,step(light,.4))*smoothstep(0.0,.8,light)),image.a);'),
  preset('radialReveal', 'uniform float progress; // %0.6% 0..1\nuniform float softness; // %0.04% 0.001..0.2', ' float a=atan(uv.y-.5,uv.x-.5)/6.2831853+.5;float mask=1.0-smoothstep(progress-softness,progress+softness,a);gl_FragColor=vec4(image.rgb*mask,image.a);'),
  preset('shutters', 'uniform float progress; // %0.7% 0..1\nuniform float count; // %12.0% 1..40', ' float mask=1.0-smoothstep(progress-.02,progress+.02,fract((uv.x+uv.y*.3)*count));gl_FragColor=vec4(image.rgb*mask,image.a);'),
  preset('inkReveal', 'uniform float progress; // %0.65% 0..1\nuniform float scale; // %18.0% 1..80', ' vec2 p=floor(uv*scale);float hash=fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);float mask=smoothstep(hash-.08,hash+.08,progress);gl_FragColor=vec4(image.rgb*mask,image.a);'),
  preset('polka', 'uniform float size; // %18.0% 2..80\nuniform float radius; // %0.42% 0.01..0.7', ' vec2 p=fract(uv*screenSize/size)-.5;float mask=1.0-smoothstep(radius-.03,radius+.03,length(p));gl_FragColor=vec4(image.rgb*mask,image.a);'),
  preset('chromaKey', 'uniform vec4 keyColor; // %0.0,1.0,0.0,1.0%\nuniform float threshold; // %0.3% 0..1', ' float mask=smoothstep(threshold,threshold+.05,distance(image.rgb,keyColor.rgb));gl_FragColor=vec4(image.rgb,image.a*mask);'),
  preset('channelMixer', 'uniform vec4 weights; // %0.2,0.8,0.0,1.0%', ' gl_FragColor=vec4(image.rgb*weights.x+image.gbr*weights.y+image.brg*weights.z,image.a);'),
  preset('splitMirror', 'uniform float split; // %0.5% 0..1', ' vec2 p=uv;p.x=uv.x<split?uv.x:2.0*split-uv.x;gl_FragColor=texture2D(screenTexture,p);'),
  preset('prismTiles', 'uniform float count; // %6.0% 1..24\nuniform float drift; // %0.1% 0..1', ' vec2 p=uv;float row=floor(p.y*count);p.x=fract(p.x+sin(row*2.4+time)*drift);gl_FragColor=texture2D(screenTexture,p);'),
  preset('gradientMap', 'uniform vec4 shadow; // %0.06,0.02,0.18,1.0%\nuniform vec4 midtone; // %0.9,0.2,0.4,1.0%\nuniform vec4 light; // %1.0,0.9,0.6,1.0%', ' float l=dot(image.rgb,vec3(.299,.587,.114));vec3 c=l<.5?mix(shadow.rgb,midtone.rgb,l*2.0):mix(midtone.rgb,light.rgb,l*2.0-1.0);gl_FragColor=vec4(c,image.a);'),
  preset('checkerTransition', 'uniform float progress; // %0.6% 0..1\nuniform float count; // %10.0% 2..40', ' vec2 p=floor(uv*count);float order=fract(p.x*.618+p.y*.382);float mask=smoothstep(order-.05,order+.05,progress);gl_FragColor=vec4(image.rgb*mask,image.a);'),
];
