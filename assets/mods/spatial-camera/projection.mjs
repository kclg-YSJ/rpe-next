import { PlaneCamera } from './camera.mjs';
import { SpriteProjection, UnsupportedDrawing } from './sprites.mjs';

const vertex=`
attribute vec2 world;
attribute vec2 uv;
uniform vec3 eye;
uniform vec3 right;
uniform vec3 up;
uniform vec3 forward;
uniform vec2 extent;
uniform float focal;
uniform vec2 planes;
varying vec2 texturePoint;
void main(){
  vec3 delta=vec3(world,0.0)-eye;
  float depth=dot(delta,forward);
  float z=(planes.y+planes.x)/(planes.y-planes.x)*depth-2.0*planes.y*planes.x/(planes.y-planes.x);
  gl_Position=vec4(dot(delta,right)*focal/extent.x,dot(delta,up)*focal/extent.y,z,depth);
  texturePoint=uv;
}`;
const fragment=`precision highp float;
uniform sampler2D image;
varying vec2 texturePoint;
void main(){gl_FragColor=texture2D(image,texturePoint);}`;

/** Perspective-correct projection shared by the host's independently ordered drawing passes. */
export class CameraProjection {
  constructor(invalidate){
    this.invalidate=invalidate;this.source=document.createElement('canvas');this.canvas=document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;});
    this.canvas.addEventListener('webglcontextrestored',()=>{this.gl=null;this.sprites=null;this.lost=false;this.failed=false;this.invalidate();});
  }
  ensure(){
    if(this.lost)return false;if(this.gl)return true;
    const gl=this.canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false});if(!gl)throw Error('此设备未能创建三维摄像机的 WebGL 画布');
    this.gl=gl;
    const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error('摄像机投影着色器：'+message);}return shader;};
    const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('摄像机投影程序：'+gl.getProgramInfoLog(program));
    this.program=program;this.attributes=Object.fromEntries(['world','uv'].map(name=>[name,gl.getAttribLocation(program,name)]));this.uniforms=Object.fromEntries(['eye','right','up','forward','extent','focal','planes','image'].map(name=>[name,gl.getUniformLocation(program,name)]));
    this.buffer=gl.createBuffer();this.texture=gl.createTexture();this.textureWidth=this.textureHeight=0;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.maximum=Math.min(4096,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));return true;
  }
  render(context,renderer,chart,tempo,seconds,selectedLine,frame,pose,quality,draw,{mapHits=true,forceCapture=false,cacheKey=null}={}){
    const camera=this.camera=new PlaneCamera(pose,frame),bounds=camera.bounds();
    if(!bounds){if(mapHits){renderer.noteHitAreas=[];renderer.guides=[];}return true;}
    const directFrame={...frame,width:bounds.width,height:bounds.height,scale:1,divisor:Math.max(bounds.width/1350,bounds.height/900,1),center:bounds.center,viewport:{left:0,top:0,width:bounds.width,height:bounds.height,scale:1},cullNotes:true};
    const affine=camera.affine(directFrame);
    if(affine){context.save();try{context.transform(...affine);draw(context,chart,tempo,seconds,selectedLine,directFrame);}finally{context.restore();}if(mapHits)this.mapHits(renderer,camera,directFrame,frame);this.rawFrame=directFrame;this.lastPath='affine';return true;}
    if(!this.ensure())return false;
    const cache=cacheKey!==null?this.captureCache:null;
    if(cache&&cache.key===cacheKey&&cache.width===frame.width&&cache.height===frame.height&&cache.scale===frame.scale&&cache.viewportWidth===frame.viewport.width&&cache.viewportHeight===frame.viewport.height&&cache.ratio===(devicePixelRatio||1)&&cache.quality===quality&&Object.keys(pose).every(key=>pose[key]===cache.pose[key])){const v=frame.viewport;context.drawImage(cache.canvas,v.left,v.top,v.width,v.height);this.lastPath='cached';return true;}
    // Capture is reserved for drawing features the bounded sprite adapter cannot reproduce.
    if(!forceCapture){
      this.sprites??=new SpriteProjection(this.gl,this.canvas);
      try{
        this.sprites.begin(camera,directFrame,frame);draw(this.sprites.context,chart,tempo,seconds,selectedLine,directFrame);this.sprites.finish();
        if(mapHits)this.mapHits(renderer,camera,directFrame,frame);const v=frame.viewport;context.drawImage(this.canvas,v.left,v.top,v.width,v.height);this.rawFrame=directFrame;this.lastPath='sprites';return true;
      }catch(error){if(!(error instanceof UnsupportedDrawing))throw error;this.lastFallback=error.message;}
    }
    const ratio=globalThis.devicePixelRatio||1,qualityScale={economy:.7,balanced:1,sharp:1.4}[quality]??1;
    const pixelScale=Math.min(frame.scale*ratio*qualityScale,this.maximum/bounds.width,this.maximum/bounds.height,Math.sqrt(6e6/(bounds.width*bounds.height)));
    const width=Math.max(2,Math.min(this.maximum,Math.ceil(bounds.width*pixelScale/32)*32)),height=Math.max(2,Math.min(this.maximum,Math.ceil(bounds.height*pixelScale/32)*32));
    if(this.source.width!==width||this.source.height!==height){this.source.width=width;this.source.height=height;}
    const source=this.source.getContext('2d');source.setTransform(1,0,0,1,0,0);source.clearRect(0,0,width,height);
    // Keep the exact world window even when the pixel dimensions have been rounded.
    const rawScale=Math.min(width/bounds.width,height/bounds.height),rawWidth=width/rawScale,rawHeight=height/rawScale;
    source.setTransform(rawScale,0,0,rawScale,0,0);
    const rawFrame={...frame,width:rawWidth,height:rawHeight,scale:1,divisor:Math.max(rawWidth/1350,rawHeight/900,1),center:bounds.center,viewport:{left:0,top:0,width:rawWidth,height:rawHeight,scale:1},cullNotes:true};
    this.rawFrame=rawFrame;
    draw(source,chart,tempo,seconds,selectedLine,rawFrame);
    if(mapHits)this.mapHits(renderer,camera,rawFrame,frame);
    const gl=this.gl,v=frame.viewport,outWidth=Math.max(1,Math.round(v.width*ratio)),outHeight=Math.max(1,Math.round(v.height*ratio));
    if(this.canvas.width!==outWidth||this.canvas.height!==outHeight){this.canvas.width=outWidth;this.canvas.height=outHeight;}
    gl.viewport(0,0,outWidth,outHeight);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.useProgram(this.program);
    const left=bounds.center.x-rawWidth/2,right=bounds.center.x+rawWidth/2,bottom=bounds.center.y-rawHeight/2,top=bounds.center.y+rawHeight/2;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([left,bottom,0,0,right,bottom,1,0,left,top,0,1,right,top,1,1]),gl.DYNAMIC_DRAW);
    for(const [name,offset]of [['world',0],['uv',8]]){const at=this.attributes[name];gl.enableVertexAttribArray(at);gl.vertexAttribPointer(at,2,gl.FLOAT,false,16,offset);}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    if(this.textureWidth!==width||this.textureHeight!==height){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.textureWidth=width;this.textureHeight=height;}
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,this.source);
    gl.uniform1i(this.uniforms.image,0);gl.uniform3fv(this.uniforms.eye,camera.position);for(const key of ['right','up','forward'])gl.uniform3fv(this.uniforms[key],camera.basis[key]);gl.uniform2f(this.uniforms.extent,v.width/frame.scale/2,v.height/frame.scale/2);gl.uniform1f(this.uniforms.focal,camera.focal);gl.uniform2f(this.uniforms.planes,camera.near,camera.far);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);context.drawImage(this.canvas,v.left,v.top,v.width,v.height);this.lastPath='capture';
    if(cacheKey!==null){const canvas=this.captureCache?.canvas??document.createElement('canvas');canvas.width=this.canvas.width;canvas.height=this.canvas.height;canvas.getContext('2d').drawImage(this.canvas,0,0);this.captureCache={canvas,key:cacheKey,width:frame.width,height:frame.height,viewportWidth:v.width,viewportHeight:v.height,ratio,scale:frame.scale,quality,pose:{...pose}};}
    return true;
  }
  mapHits(renderer,camera,raw,frame){
    const world=point=>({x:point.x-raw.width/2+raw.center.x,y:raw.height/2-point.y+raw.center.y});
    renderer.guides=(renderer.guides??[]).flatMap(guide=>{
      const angle=guide.rotation*Math.PI/180,point=world(guide),a={x:point.x-Math.cos(angle)*guide.halfWidth,y:point.y+Math.sin(angle)*guide.halfWidth},b={x:point.x+Math.cos(angle)*guide.halfWidth,y:point.y-Math.sin(angle)*guide.halfWidth};
      const ends=camera.clip([a,b]);if(ends.length<2)return[];const left=camera.project(ends[0]),right=camera.project(ends[1]);if(!left||!right)return[];
      const anchor=camera.project(point)??{x:(left.x+right.x)/2,y:(left.y+right.y)/2};
      return[{...guide,x:anchor.x,y:anchor.y,segment:[left,right],halfWidth:Math.hypot(right.x-left.x,right.y-left.y)/2,rotation:Math.atan2(right.y-left.y,right.x-left.x)*180/Math.PI}];
    });
    const areas=renderer.noteHitAreas??[];let count=0;
    for(const area of areas){
      let start=world({x:area.x1,y:area.y1}),end=world({x:area.x2,y:area.y2}),a=camera.project(start),b=camera.project(end);
      if(!a||!b){const segment=camera.clip([start,end]);if(segment.length<2)continue;[start,end]=segment;a=camera.project(start);b=camera.project(end);if(!a||!b)continue;}
      const side=camera.project({x:start.x+area.radius,y:start.y}),up=camera.project({x:start.x,y:start.y+area.radius});
      const radius=Math.max(4,side?Math.hypot(side.x-a.x,side.y-a.y):4,up?Math.hypot(up.x-a.x,up.y-a.y):4),v=frame.viewport;
      if(Math.max(a.x,b.x)+radius<v.left||Math.min(a.x,b.x)-radius>v.left+v.width||Math.max(a.y,b.y)+radius<v.top||Math.min(a.y,b.y)-radius>v.top+v.height)continue;
      if(area.polygon)area.polygon=camera.clip(area.polygon.map(world)).map(point=>camera.project(point)).filter(Boolean);
      if(area.collisionWidth!==undefined){area.collisionWidth=radius*2;area.collisionHeight=area.collisionHeight*frame.scale*camera.focal/a.depth;area.rotation=Math.atan2(b.y-a.y,b.x-a.x)+Math.PI/2;}
      // The affine sprite bounds belong to the source plane. Retain this
      // camera's projected hit shape after mapping into screen coordinates.
      area.pickWidth=undefined;
      area.x1=a.x;area.y1=a.y;area.x2=b.x;area.y2=b.y;area.radius=radius;areas[count++]=area;
    }
    areas.length=count;renderer.noteHitAreas=areas;
  }
  noise(entry,frame){
    const camera=this.camera;if(!camera)return entry;
    const points=camera.clip(entry.points);if(points.length<3)return null;
    const projected=points.map(point=>camera.project(point));if(projected.some(point=>!point))return null;
    const toWorld=point=>({x:(point.x-frame.width/2)/frame.scale,y:(frame.height/2-point.y)/frame.scale});
    const center=camera.project(entry.center)??projected.reduce((result,point)=>({x:result.x+point.x/projected.length,y:result.y+point.y/projected.length}),{x:0,y:0});
    const axis=camera.project({x:entry.center.x+Math.cos(entry.rotation)*10,y:entry.center.y-Math.sin(entry.rotation)*10});
    return{...entry,points:projected.map(toWorld),center:toWorld(center),rotation:axis?Math.atan2(axis.y-center.y,axis.x-center.x):entry.rotation};
  }
  dispose(){if(this.gl){const gl=this.gl;this.sprites?.dispose();this.sprites=null;gl.deleteTexture(this.texture);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;}if(this.captureCache){this.captureCache.canvas.width=this.captureCache.canvas.height=1;this.captureCache=null;}this.textureWidth=this.textureHeight=0;this.camera=null;this.source.width=this.source.height=1;this.canvas.width=this.canvas.height=1;}
}
