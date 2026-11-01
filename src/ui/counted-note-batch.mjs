import { NoteSpriteBatch } from './note-sprite-batch.mjs';
import { RpeSkin } from './skin.mjs';
import { ResourceNoteSkin } from './resource-note-skin.mjs';

// drawImage already carries a white vertex tint; its otherwise unused red
// channel can carry multiplicity without adding vertices or GL attributes.
const FRAGMENT=`#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray pictures;
uniform vec2 extents[128];
in vec3 uv;
in vec4 tint;
out vec4 outputColor;
void main(){
  vec4 pixel=vec4(1.0);
  if(uv.z>=0.0){
    int layer=int(mod(uv.z,128.0));
    vec2 halfPixel=0.5/vec2(textureSize(pictures,0).xy);
    vec2 point=uv.z>=128.0?mod(uv.xy,extents[layer]):uv.xy;
    pixel=texture(pictures,vec3(clamp(point,halfPixel,extents[layer]-halfPixel),float(layer)));
  }
  float count=uv.z>=0.0?max(1.0,tint.r):1.0;
  float alpha=1.0-pow(max(0.0,1.0-pixel.a*tint.a),count);
  vec3 color=uv.z>=0.0?vec3(1.0,tint.g,tint.b):tint.rgb;
  outputColor=vec4(pixel.rgb*color*(alpha/max(pixel.a,0.000001)),alpha);
}`;
export class CountedNoteBatch extends NoteSpriteBatch {
  constructor(){super({fragment:FRAGMENT});this.repetitions=1;}
  static compatible(skin){const pack=skin?.resourcePack;return skin?.head===RpeSkin.prototype.head&&skin.hold===RpeSkin.prototype.hold&&(!pack||pack.head===ResourceNoteSkin.prototype.head&&pack.hold===ResourceNoteSkin.prototype.hold);}
  quad(left,top,width,height,image,color,crop){return super.quad(left,top,width,height,image,image?[this.repetitions,color[1],color[2]]:color,crop);}
  createPattern(image,repetition){return repetition==='repeat'?{largePattern:image}:null;}
  fillRect(left,top,width,height){
    if(this.fillStyle?.largePattern){const image=this.image(this.fillStyle.largePattern);return this.quad(left,top,width,height,{...image,layer:image.layer+128},[1,1,1],[0,0,width,height]);}
    return super.fillRect(left,top,width,height);
  }
  dispose(){if(this.gl){this.resetTexture();this.gl.getExtension('WEBGL_lose_context')?.loseContext();}this.failed=true;}
}
