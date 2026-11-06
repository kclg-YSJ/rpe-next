import { AXES, neutralPose, round, PlaneCamera } from './camera.mjs';
import { CameraTracks } from './events.mjs';
import { CameraProjection } from './projection.mjs';
import { CameraControls } from './inspector.mjs';
import { cameraFollowsChart } from './settings.mjs';
import { registerRenderExtension } from '@rpen/ui/render-extensions.mjs';

export function activate(api){
  const editor=api.editor,tracks=new CameraTracks(),controls=new CameraControls(api,tracks);
  api.style(api.package.text('style.css'));
  for(const [type,name]of [['position','摄像机位置'],['rotation','摄像机旋转'],['lens','摄像机镜头']])api.globalEvents.register({
    id:type,name:`${name} · ${api.manifest.name}（${api.manifest.author}）`,
    description:'三维摄像机的 '+name+'，以谱面中心为世界原点。',
    columns:AXES.filter(axis=>axis.type===type).map(axis=>({id:axis.id,name:axis.name,timelineLabel:axis.name,valueType:'number',defaultValue:axis.fallback,min:axis.min,max:axis.max,step:axis.step,cameraType:type,
      formatValue:value=>round(value)+axis.unit,inspector:controls.inspector(axis)})),
  });
  const suspended=()=>Boolean(editor.noiseEditor.sampleMode||editor.eventSampler.mode);
  const attachRenderer=renderer=>{
    const projection=new CameraProjection(()=>editor.invalidate());
    const previousMapping=renderer.spatialMapping,mappingCameras=new Map();let mappingChart,mappingTempo,mappingOverride;
    const mappingCamera=(seconds,frame,chart,tempo)=>{
      const override=renderer.spatialCameraOverride??controls.poseOverride;
      if(mappingChart!==chart.globalEvents||mappingTempo!==tempo||mappingOverride!==override){mappingCameras.clear();mappingChart=chart.globalEvents;mappingTempo=tempo;mappingOverride=override;}
      const key=`${seconds}:${frame.width}:${frame.height}:${frame.scale}`;
      if(mappingCameras.has(key))return mappingCameras.get(key);
      const pose=override??tracks.sample(chart,tempo,seconds),camera=suspended()||neutralPose(pose)||projection.failed||!controls.visualActive&&!tracks.hasEvents?null:new PlaneCamera(pose,frame);
      if(mappingCameras.size>=512)mappingCameras.delete(mappingCameras.keys().next().value);mappingCameras.set(key,camera);return camera;
    };
    renderer.spatialMapping={
      project(point,seconds,frame,chart,tempo){const camera=mappingCamera(seconds,frame,chart,tempo);if(!camera)return point;const p=camera.project(point);return p?{x:(p.x-frame.width/2)/frame.scale,y:(frame.height/2-p.y)/frame.scale}:null;},
      unproject(point,seconds,frame,chart,tempo){const camera=mappingCamera(seconds,frame,chart,tempo);return camera?camera.planeAt(frame.width/2+point.x*frame.scale,frame.height/2-point.y*frame.scale):point;},
    };
    const releases=[];let sceneChart,sceneImages,imageGeneration,animatedScene=false;
    for(const method of ['drawBackground','drawScene','drawUi',...(renderer.drawRenderHits?['drawRenderHits']:[])])releases.push(api.patch(renderer,method,previous=>function(context,chart,tempo,seconds,selectedLine,frame){
      if(method==='drawBackground'&&this.spatialForeground)return;
      const world=method==='drawScene'||method==='drawRenderHits';
      if(!world&&!cameraFollowsChart(chart))return previous.call(this,context,chart,tempo,seconds,selectedLine,frame);
      const pose=this.spatialCameraOverride??controls.poseOverride??tracks.sample(chart,tempo,seconds);
      if(world)this.spatialCameraState={...pose};
      if(suspended()||neutralPose(pose)||projection.failed||!controls.visualActive&&!tracks.hasEvents){projection.camera=null;return previous.call(this,context,chart,tempo,seconds,selectedLine,frame);}
      const draw=(target,chart,tempo,seconds,selectedLine,capture)=>{
        if(method==='drawUi'){
          const width=frame.viewport.width/frame.viewport.scale,height=frame.viewport.height/frame.viewport.scale;
          const x=capture.width/2-capture.center.x,y=capture.height/2+capture.center.y;
          capture={...capture,viewport:{left:x-width/2,top:y-height/2,width,height,scale:1}};
        }
        return previous.call(this,target,chart,tempo,seconds,selectedLine,capture);
      };
      if(world&&(sceneChart!==chart||sceneImages!==this.images||imageGeneration!==this.images?.generation)){sceneChart=chart;sceneImages=this.images;imageGeneration=this.images?.generation;animatedScene=chart.judgeLineList.some(line=>this.images?.describe?.(line.Texture)?.animated);}
      const background=method==='drawBackground',cacheKey=background&&!this.images?.backgroundAnimated&&this.images?.background?`${this.images.backgroundName??''}|${this.backgroundAlpha}|${this.backgroundBlur}`:null;
      if(background&&projection.backgroundImage!==this.images?.background){projection.backgroundImage=this.images?.background;projection.captureCache=null;}
      try{const drawn=projection.render(context,this,chart,tempo,seconds,selectedLine,frame,pose,api.settings.get('quality'),draw,{mapHits:method==='drawScene',forceCapture:world&&animatedScene||background&&Boolean(this.images?.backgroundAnimated),cacheKey});if(drawn)return;}
      catch(error){projection.failed=true;api.notify('摄像机透视暂不可用，已恢复平面预览：'+error.message,'error');}
      projection.camera=null;return previous.call(this,context,chart,tempo,seconds,selectedLine,frame);
    }));
    releases.push(api.patch(renderer.noisePreview,'transformGeometry',previous=>function(entry,frame){const result=previous?previous.call(this,entry,frame):entry;return result&&projection.camera?projection.noise(result,frame):result;}));
    releases.push(api.patch(renderer,'draw',previous=>function(...args){const opacity=this.opacity;if(controls.visualActive)this.opacity=1;try{return previous.apply(this,args);}finally{this.opacity=opacity;}}));
    releases.push(api.dispose(()=>{projection.dispose();mappingCameras.clear();if(previousMapping)renderer.spatialMapping=previousMapping;else delete renderer.spatialMapping;delete renderer.spatialCameraState;}));
    return()=>releases.reverse().forEach(release=>release());
  };
  controls.attachRenderer=attachRenderer;
  for(const renderer of [editor.preview,editor.realtimePreview])attachRenderer(renderer);
  api.dispose(registerRenderExtension(renderer => attachRenderer(renderer)));
  api.commands.register({id:'assistant',title:'摄像机姿态过渡助手',setting:'assistant-key',run:()=>controls.openAssistant()});
  api.commands.register({id:'global-events',title:'打开摄像机全局事件',run:()=>api.globalEvents.open()});
  api.dispose(()=>{document.querySelector('#spatial-camera-overview')?.remove();editor.globalEvents.render();});
  api.patch(editor.globalEvents,'renderOverview',previous=>function(...args){const result=previous.apply(this,args);this.host.insertBefore(controls.overviewControls(),this.host.children[1]??null);return result;});
  editor.globalEvents.render();
  api.on('editor:chart',()=>editor.invalidate());
  api.settings.onChange(()=>editor.invalidate());
  // Managed patches and registry entries are removed by the mod scope; no chart data is removed.
}
