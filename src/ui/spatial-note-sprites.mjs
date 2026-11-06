import { SpriteProjection, UnsupportedDrawing } from '../../assets/mods/spatial-camera/sprites.mjs';
import { clipSpatialSprite } from '../core/spatial-sprite.mjs';
import { t } from '../i18n.mjs';
const spatialVertex=`attribute vec2 world,uv,center;attribute vec4 tint;attribute float slot,sampleBeat;
uniform vec2 extent,origin,visible;uniform vec4 camera;uniform float currentBeat,spacing,worldScale,fade,progress,perspective;
varying vec2 texturePoint;varying vec4 color;varying float imageSlot;
vec3 project(vec2 point,float delta){float z=delta*spacing,y=point.y*worldScale,d=max(1.0,camera.x+z*camera.w-y*camera.z);return vec3(origin.x+point.x*worldScale*camera.y/d,origin.y-(y*camera.w+z*camera.z)*camera.y/d,d);}
void main(){float delta=sampleBeat-currentBeat;vec3 p=project(world,delta);
if(perspective<0.5){p.xy=project(center,delta).xy+project(world,0.0).xy-project(center,0.0).xy;p.z=1.0;}
gl_Position=vec4((p.x/extent.x*2.0-1.0)*p.z,(1.0-p.y/extent.y*2.0)*p.z,0.0,p.z);
float span=delta<0.0?visible.x:visible.y,edge=min(span,max(0.25,span*0.2));float boundary=span>0.0?smoothstep(0.0,edge,span-abs(delta)):0.0;
color=vec4(tint.rgb,tint.a*exp(-abs(delta)*fade)*boundary*progress);texturePoint=uv;imageSlot=slot;}`;

// Cache the ordinary note painter's quads per time sample. Only projection changes
// with the playhead; textures and two GPU surfaces are shared across all samples.
export class SpatialNoteSprites extends SpriteProjection {
  constructor(gl,canvas){
    super(gl,canvas,{vertexSource:spatialVertex});this.vertices=new Float32Array(72*2048);
    for(const key of ['center','sampleBeat'])this.attributes[key]=gl.getAttribLocation(this.program,key);
    for(const key of ['origin','visible','camera','currentBeat','spacing','worldScale','fade','progress','perspective'])this.uniforms[key]=gl.getUniformLocation(this.program,key);
  }
  capture(draw, frame) {
    this.commands = []; this.frame = frame;
    this.context.reset({ width: frame.width, height: frame.height, center: { x: 0, y: 0 } });
    try { draw(this.context); return this.commands; }
    finally { this.commands = null; }
  }
  quad(image, x, y, width, height, u0 = 0, v0 = 1, u1 = 1, v1 = 0, color = [1, 1, 1]) {
    const state = this.context.state;
    if (!state.alpha || !width || !height) return;
    if (state.composite !== 'source-over' || state.filter !== 'none') throw new UnsupportedDrawing(t('spatial.notesSkin'));
    const m = state.matrix, scale = this.frame.scale;
    const points = [[x,y,u0,v0],[x+width,y,u1,v0],[x+width,y+height,u1,v1],[x,y+height,u0,v1]].map(([x,y,u,v]) => ({x:(m[0]*x+m[2]*y+m[4])/scale,y:(m[1]*x+m[3]*y+m[5])/scale,u,v}));
    const f=this.frame,v=f.viewport;
    const clipped=clipSpatialSprite(points,{left:(v.left-f.width/2)/scale,right:(v.left+v.width-f.width/2)/scale,bottom:(f.height/2-v.top-v.height)/scale,top:(f.height/2-v.top)/scale});
    if(clipped.length>=3)this.commands.push({image,points:clipped,color:[color[0],color[1],color[2],state.alpha*(color[3]??1)]});
  }
  start(camera,current,scale,options,progress,density) {
    const{width,height}=camera,neutral = { position: [0, 0, 1], basis: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] }, near: .1, far: 10, focal: 1 };
    // Dense transparent trails are fill-rate bound. Bound their offscreen raster;
    // all samples, timing, size and the full-resolution current plane are retained.
    this.pixelRatio=Math.min(devicePixelRatio||1,density>6000?.5:density>3000?.75:1);
    this.begin(neutral, { width, height, center: { x: 0, y: 0 } }, { scale: 1, viewport: { width, height } });
    const gl=this.gl,u=this.uniforms;for(const[key,size,offset]of[['world',2,0],['uv',2,8],['tint',4,16],['slot',1,32],['sampleBeat',1,36],['center',2,40]]){gl.enableVertexAttribArray(this.attributes[key]);gl.vertexAttribPointer(this.attributes[key],size,gl.FLOAT,false,48,offset);}
    gl.uniform2f(u.extent,width,height);gl.uniform2f(u.origin,camera.cx,camera.cy);gl.uniform2f(u.visible,options.past,options.future);gl.uniform4f(u.camera,camera.distance,camera.focal,camera.s,camera.c);
    for(const[key,value]of Object.entries({currentBeat:current,spacing:camera.depth,worldScale:scale,fade:options.fade,progress,perspective:options.perspective?1:0}))gl.uniform1f(u[key],value);
  }
  replay(sample) {
    for (const c of sample.commands) {
      const points=c.points;
      const texture = this.texture(c.image);
      const count=(points.length-2)*36;
      if ((!this.slots.has(texture) && this.slots.size === 8) || this.count + count > this.vertices.length) this.flush();
      if (!this.slots.has(texture)) { this.slots.set(texture, this.batchTextures.length); this.batchTextures.push(texture); }
      const slot = this.slots.get(texture), data = this.vertices,cx=points.reduce((v,p)=>v+p.x,0)/points.length,cy=points.reduce((v,p)=>v+p.y,0)/points.length; let at = this.count;
      for(let triangle=1;triangle<points.length-1;triangle++)for (const corner of [0,triangle,triangle+1]) {
        const p = points[corner]; data[at++] = p.x; data[at++] = p.y;
        data[at++] = c.points[corner].u; data[at++] = c.points[corner].v;
        data[at++] = c.color[0]; data[at++] = c.color[1]; data[at++] = c.color[2]; data[at++] = c.color[3] * Math.min(.85,sample.weight*2.5); data[at++] = slot;
        data[at++]=sample.beat;data[at++]=cx;data[at++]=cy;
      }
      this.count = at;
    }
  }
  flush(){
    if(!this.count)return;const gl=this.gl;for(let i=0;i<8;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,(this.batchTextures[i]??this.batchTextures[0]).texture);}gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices.subarray(0,this.count));gl.drawArrays(gl.TRIANGLES,0,this.count/12);this.count=0;this.drawCalls++;this.batchTextures=[];this.slots.clear();
  }
}
