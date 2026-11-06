/** A bounded Canvas drawing adapter: static sprite textures are uploaded once, not every frame. */
const vertex=`attribute vec2 world;attribute vec2 uv;attribute vec4 tint;attribute float slot;
uniform vec3 eye,right,up,forward;uniform vec2 extent,planes;uniform float focal;
varying vec2 texturePoint;varying vec4 color;varying float imageSlot;
void main(){vec3 delta=vec3(world,0.)-eye;float d=dot(delta,forward);
float z=(planes.y+planes.x)/(planes.y-planes.x)*d-2.*planes.y*planes.x/(planes.y-planes.x);
gl_Position=vec4(dot(delta,right)*focal/extent.x,dot(delta,up)*focal/extent.y,z,d);texturePoint=uv;color=tint;imageSlot=slot;}`;
const fragment=`precision highp float;${Array.from({length:8},(_,i)=>'uniform sampler2D image'+i+';').join('')}varying vec2 texturePoint;varying vec4 color;varying float imageSlot;
void main(){vec4 pixel;${Array.from({length:8},(_,i)=>(i===0?'if':i===7?'else ':'else if')+(i===7?'':'(imageSlot<'+(i+.5).toFixed(1)+')')+'pixel=texture2D(image'+i+',texturePoint);').join('')}gl_FragColor=vec4(pixel.rgb*color.rgb*color.a,pixel.a*color.a);}`;

export class UnsupportedDrawing extends Error {}
const defaults=()=>({matrix:[1,0,0,1,0,0],alpha:1,fill:'#000000',font:'10px sans-serif',align:'start',baseline:'alphabetic',composite:'source-over',filter:'none',smoothing:true});
const multiply=(m,a,b,c,d,e,f)=>[m[0]*a+m[2]*b,m[1]*a+m[3]*b,m[0]*c+m[2]*d,m[1]*c+m[3]*d,m[0]*e+m[2]*f+m[4],m[1]*e+m[3]*f+m[5]];
const dimension=image=>[image.naturalWidth??image.videoWidth??image.width,image.naturalHeight??image.videoHeight??image.height];

export class SpriteProjection {
  constructor(gl,canvas,{vertexSource=vertex}={}){
    this.gl=gl;this.canvas=canvas;this.textures=new Map();this.text=new Map();this.colors=new Map();this.bytes=0;this.tick=0;this.uploads=0;this.drawCalls=0;
    const compile=(kind,source)=>{const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
    const vs=compile(gl.VERTEX_SHADER,vertexSource),fs=compile(gl.FRAGMENT_SHADER,fragment);this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
    this.uniforms=Object.fromEntries(['eye','right','up','forward','extent','planes','focal',...Array.from({length:8},(_,i)=>'image'+i)].map(key=>[key,gl.getUniformLocation(this.program,key)]));this.attributes=Object.fromEntries(['world','uv','tint','slot'].map(key=>[key,gl.getAttribLocation(this.program,key)]));
    this.buffer=gl.createBuffer();this.vertices=new Float32Array(54*2048);this.white=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1):document.createElement('canvas');this.white.width=this.white.height=1;this.white.getContext('2d').fillStyle='#fff';this.white.getContext('2d').fillRect(0,0,1,1);
    this.context=new SpriteContext(this);this.maximum=gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }
  begin(camera,raw,frame){
    const gl=this.gl,v=frame.viewport,ratio=this.pixelRatio??(devicePixelRatio||1),width=Math.max(1,Math.round(v.width*ratio)),height=Math.max(1,Math.round(v.height*ratio));if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    this.camera=camera;this.frame=frame;this.count=0;this.batchTextures=[];this.slots=new Map();this.tick++;this.drawCalls=0;this.uploads=0;this.context.reset(raw);
    gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);
    for(const [key,size,offset]of [['world',2,0],['uv',2,8],['tint',4,16],['slot',1,32]]){const at=this.attributes[key];gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,size,gl.FLOAT,false,36,offset);}
    gl.uniform3fv(this.uniforms.eye,camera.position);for(const key of ['right','up','forward'])gl.uniform3fv(this.uniforms[key],camera.basis[key]);gl.uniform2f(this.uniforms.extent,v.width/frame.scale/2,v.height/frame.scale/2);gl.uniform2f(this.uniforms.planes,camera.near,camera.far);gl.uniform1f(this.uniforms.focal,camera.focal);for(let i=0;i<8;i++)gl.uniform1i(this.uniforms['image'+i],i);
    gl.activeTexture(gl.TEXTURE0);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  }
  texture(image){
    const gl=this.gl,[width,height]=dimension(image);if(!width||!height||width>this.maximum||height>this.maximum)throw new UnsupportedDrawing('素材需要画布捕获');
    let value=this.textures.get(image);if(!value){value={texture:gl.createTexture(),width,height,bytes:width*height*4};this.textures.set(image,value);this.bytes+=value.bytes;gl.bindTexture(gl.TEXTURE_2D,value.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);this.uploads++;}
    else if(value.width!==width||value.height!==height){this.bytes-=value.bytes;value.width=width;value.height=height;value.bytes=width*height*4;this.bytes+=value.bytes;gl.bindTexture(gl.TEXTURE_2D,value.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);this.uploads++;}
    value.last=this.tick;return value;
  }
  flush(){
    if(!this.count)return;const gl=this.gl;for(let i=0;i<8;i++){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,(this.batchTextures[i]??this.batchTextures[0]).texture);}gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices.subarray(0,this.count));gl.drawArrays(gl.TRIANGLES,0,this.count/9);this.count=0;this.drawCalls++;this.batchTextures=[];this.slots.clear();
  }
  quad(image,x,y,width,height,u0=0,v0=1,u1=1,v1=0,color=[1,1,1]){
    const state=this.context.state;if(state.alpha<=0||!width||!height)return;if(state.composite!=='source-over'||state.filter!=='none')throw new UnsupportedDrawing('需要原生画布合成或滤镜');
    const texture=this.texture(image);if(!this.slots.has(texture)&&this.slots.size===8||this.count+54>this.vertices.length)this.flush();if(!this.slots.has(texture)){this.slots.set(texture,this.batchTextures.length);this.batchTextures.push(texture);}const slot=this.slots.get(texture);
    const m=state.matrix,data=this.vertices,alpha=state.alpha*(color[3]??1);let at=this.count;
    const x0=m[0]*x+m[2]*y+m[4],y0=m[1]*x+m[3]*y+m[5],ax=m[0]*width,ay=m[1]*width,bx=m[2]*height,by=m[3]*height;
    for(let i=0;i<6;i++){const right=i===1||i===2||i===4,bottom=i===2||i===4||i===5;data[at++]=x0+(right?ax:0)+(bottom?bx:0);data[at++]=y0+(right?ay:0)+(bottom?by:0);data[at++]=right?u1:u0;data[at++]=bottom?v1:v0;data[at++]=color[0];data[at++]=color[1];data[at++]=color[2];data[at++]=alpha;data[at++]=slot;}this.count=at;
  }
  finish(){
    this.flush();if(this.bytes>96*1024*1024||this.textures.size>384){const entries=[...this.textures].sort((a,b)=>a[1].last-b[1].last);for(const [image,value]of entries){if(value.last===this.tick)continue;this.gl.deleteTexture(value.texture);this.textures.delete(image);this.bytes-=value.bytes;if(this.bytes<=64*1024*1024&&this.textures.size<=256)break;}}
  }
  color(value){
    if(typeof value!=='string')throw new UnsupportedDrawing('渐变或重复图案使用原生画布');if(this.colors.has(value))return this.colors.get(value);
    let color;if(/^#[\da-f]{3,8}$/i.test(value)){let hex=value.slice(1);if(hex.length===3||hex.length===4)hex=[...hex].map(c=>c+c).join('');if(hex.length===6||hex.length===8)color=[0,2,4].map(at=>parseInt(hex.slice(at,at+2),16)/255).concat(hex.length===8?parseInt(hex.slice(6),16)/255:1);}
    else{const match=value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);if(match)color=match.slice(1,4).map(v=>Math.max(0,Math.min(255,Number(v)))/255).concat(match[4]===undefined?1:Number(match[4]));}
    if(!color)throw new UnsupportedDrawing('颜色需要原生画布解析');if(this.colors.size>256)this.colors.clear();this.colors.set(value,color);return color;
  }
  textImage(text,state){
    const resolution=Math.max(1,Math.min(3,this.frame.scale*(devicePixelRatio||1)*1.4)),key=[text,state.font,state.fill,state.align,state.baseline,resolution].join('|');if(this.text.has(key))return this.text.get(key);
    const canvas=document.createElement('canvas'),c=canvas.getContext('2d');c.font=state.font;c.textAlign=state.align;c.textBaseline=state.baseline;const m=c.measureText(text),left=Math.ceil(m.actualBoundingBoxLeft),right=Math.ceil(m.actualBoundingBoxRight),top=Math.ceil(m.actualBoundingBoxAscent),bottom=Math.ceil(m.actualBoundingBoxDescent),width=Math.max(1,left+right+4),height=Math.max(1,top+bottom+4);if(width*resolution>this.maximum||height*resolution>this.maximum)throw new UnsupportedDrawing('文字尺寸需要画布捕获');
    canvas.width=Math.ceil(width*resolution);canvas.height=Math.ceil(height*resolution);c.setTransform(resolution,0,0,resolution,0,0);c.font=state.font;c.textAlign=state.align;c.textBaseline=state.baseline;c.fillStyle=state.fill;c.fillText(text,left+2,top+2);const result={canvas,width,height,left:left+2,top:top+2};if(this.text.size>=128)this.text.delete(this.text.keys().next().value);this.text.set(key,result);return result;
  }
  dispose(){const gl=this.gl;for(const value of this.textures.values())gl.deleteTexture(value.texture);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);this.textures.clear();this.text.clear();this.colors.clear();}
}

class SpriteContext {
  constructor(renderer){this.renderer=renderer;this.canvas=renderer.canvas;}
  reset(raw){this.state=defaults();this.state.matrix=[1,0,0,-1,raw.center.x-raw.width/2,raw.center.y+raw.height/2];this.stack=[];}
  save(){this.stack.push({...this.state,matrix:[...this.state.matrix]});}
  restore(){if(this.stack.length)this.state=this.stack.pop();}
  transform(...args){this.state.matrix=multiply(this.state.matrix,...args);}
  translate(x,y){this.transform(1,0,0,1,x,y);}
  scale(x,y){this.transform(x,0,0,y,0,0);}
  rotate(angle){const c=Math.cos(angle),s=Math.sin(angle);this.transform(c,s,-s,c,0,0);}
  getTransform(){const m=this.state.matrix;return{a:m[0],b:m[1],c:m[2],d:m[3],e:m[4],f:m[5]};}
  get globalAlpha(){return this.state.alpha;}set globalAlpha(value){if(Number.isFinite(value)&&value>=0&&value<=1)this.state.alpha=value;}
  get fillStyle(){return this.state.fill;}set fillStyle(value){this.state.fill=value;}
  get font(){return this.state.font;}set font(value){this.state.font=value;}
  get textAlign(){return this.state.align;}set textAlign(value){this.state.align=value;}
  get textBaseline(){return this.state.baseline;}set textBaseline(value){this.state.baseline=value;}
  get globalCompositeOperation(){return this.state.composite;}set globalCompositeOperation(value){this.state.composite=value;}
  get filter(){return this.state.filter;}set filter(value){this.state.filter=value;}
  set shadowBlur(value){if(value)throw new UnsupportedDrawing('阴影需要原生画布');}get shadowBlur(){return 0;}
  set shadowOffsetX(value){if(value)throw new UnsupportedDrawing('阴影需要原生画布');}get shadowOffsetX(){return 0;}
  set shadowOffsetY(value){if(value)throw new UnsupportedDrawing('阴影需要原生画布');}get shadowOffsetY(){return 0;}
  get imageSmoothingEnabled(){return this.state.smoothing;}set imageSmoothingEnabled(value){if(!value)throw new UnsupportedDrawing('像素采样需要原生画布');this.state.smoothing=value;}
  drawImage(image,...args){
    const [w,h]=dimension(image);let sx=0,sy=0,sw=w,sh=h,x,y,width,height;
    if(args.length===2){[x,y]=args;width=w;height=h;}else if(args.length===4)[x,y,width,height]=args;else if(args.length===8)[sx,sy,sw,sh,x,y,width,height]=args;else throw new UnsupportedDrawing('drawImage 参数');
    if(sw<0){sx+=sw;sw=-sw;}if(sh<0){sy+=sh;sh=-sh;}if(width<0){x+=width;width=-width;}if(height<0){y+=height;height=-height;}
    this.renderer.quad(image,x,y,width,height,sx/w,1-sy/h,(sx+sw)/w,1-(sy+sh)/h);
  }
  fillRect(x,y,width,height){this.renderer.quad(this.renderer.white,x,y,width,height,0,1,1,0,this.renderer.color(this.state.fill));}
  fillText(text,x,y,maxWidth){const image=this.renderer.textImage(String(text),this.state),factor=maxWidth===undefined?1:Math.min(1,maxWidth/image.width);this.renderer.quad(image.canvas,x-image.left*factor,y-image.top,image.width*factor,image.height);}
  createPattern(){throw new UnsupportedDrawing('重复图案需要原生画布');}
}
// Unsupported native operations deliberately return to the original Canvas path.
for(const [key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(globalThis.CanvasRenderingContext2D?.prototype??{}))){
  if(key==='constructor'||key in SpriteContext.prototype||key==='canvas')continue;
  if(typeof descriptor.value==='function')SpriteContext.prototype[key]=function(){throw new UnsupportedDrawing('需要原生画布操作：'+key);};
  else if(descriptor.set)Object.defineProperty(SpriteContext.prototype,key,{get(){return undefined;},set(){throw new UnsupportedDrawing('需要原生画布属性：'+key);}});
}
