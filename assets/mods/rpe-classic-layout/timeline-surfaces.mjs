export function installTimelineSurfaces(api,state) {
  const timeline=api.editor.timeline,surfaces=new Map();
  const create=(native,area)=>{
    const canvas=document.createElement('canvas');canvas.className='rc-timeline-surface';canvas.dataset.skinCanvas=area;canvas.setAttribute('aria-hidden','true');canvas.hidden=true;
    native.parentElement.append(canvas);const context=canvas.getContext('2d'),setTransform=context.setTransform.bind(context),getTransform=context.getTransform.bind(context),clearRect=context.clearRect.bind(context),nativeContext=native.getContext.bind(native),methods=new Map();
    const entry={native,canvas,context,padding:0,ratio:1,width:0,height:0,dirty:true,original:nativeContext('2d')};
    const drawingContext=type=>type==='2d'?context:null,bounds=()=>entry.rect;
    api.patch(context,'setTransform',()=>function(...args){
      if(args.length===6)return setTransform(args[0],args[1],args[2],args[3],args[4]+entry.padding*entry.ratio,args[5]);
      const matrix=new DOMMatrix(args[0]);matrix.e+=entry.padding*entry.ratio;
      return setTransform(matrix);
    });
    api.patch(context,'getTransform',()=>function(){const matrix=getTransform();matrix.e-=entry.padding*entry.ratio;return matrix;});
    api.patch(context,'resetTransform',()=>function(){return setTransform(1,0,0,1,entry.padding*entry.ratio,0);});
    api.patch(context,'clearRect',()=>function(x,y,width,height){if(entry.prepared&&x===0&&y===0&&width===entry.rect.width&&height===entry.rect.height){entry.prepared=false;return;}return clearRect(x,y,width,height);});
    api.patch(native,'getContext',previous=>function(...args){if(state.active&&args[0]==='2d')entry.dirty=true;return previous.apply(this,args);});
    entry.facade=new Proxy(native,{
      get(target,key){
        if(key==='width')return entry.width;
        if(key==='height')return entry.height;
        if(key==='clientWidth')return entry.clientWidth;
        if(key==='clientHeight')return entry.clientHeight;
        if(key==='getContext')return drawingContext;
        if(key==='getBoundingClientRect')return bounds;
        const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
        if(!methods.has(key))methods.set(key,value.bind(target));return methods.get(key);
      },
      set(target,key,value){if(key==='width'||key==='height'){entry[key]=value;return true;}return Reflect.set(target,key,value,target);}
    });
    entry.begin=()=>{
      const rect=native.getBoundingClientRect(),parent=native.parentElement.getBoundingClientRect(),stage=native.closest('.stage').getBoundingClientRect(),ratio=devicePixelRatio||1;
      entry.rect=rect;entry.clientWidth=native.clientWidth;entry.clientHeight=native.clientHeight;
      const left=Math.max(0,rect.left-stage.left),right=Math.max(0,stage.right-rect.right);
      const eventRect=timeline.eventsCanvas.getBoundingClientRect(),gap=timeline.notesOnly||timeline.getSession().multiLineActive?right:Math.max(0,eventRect.left-rect.right);
      const padding=left,trailing=area==='events'?right:Math.min(right,gap);
      if(area==='notes')state.noteBleed={left:padding,right:trailing};
      const width=Math.round((rect.width+padding+trailing)*ratio),height=Math.round(rect.height*ratio);
      entry.padding=padding;entry.ratio=ratio;entry.width=Math.round(rect.width*ratio);entry.height=height;
      if(native.width!==entry.width||native.height!==height){native.width=entry.width;native.height=height;entry.nativeRatio=null;entry.dirty=false;}
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      const key=[rect.left-parent.left-padding,rect.top-parent.top,rect.width+padding+trailing,rect.height].join(',');
      if(entry.key!==key){entry.key=key;canvas.style.left=(rect.left-parent.left-padding)+'px';canvas.style.top=(rect.top-parent.top)+'px';canvas.style.width=(rect.width+padding+trailing)+'px';canvas.style.height=rect.height+'px';}
      if(canvas.hidden)canvas.hidden=false;setTransform(1,0,0,1,0,0);clearRect(0,0,width,height);entry.prepared=true;
      if(entry.dirty){const original=entry.original;original.save();original.setTransform(1,0,0,1,0,0);original.clearRect(0,0,native.width,native.height);original.restore();entry.dirty=false;}
      if(entry.nativeRatio!==ratio){entry.original.setTransform(ratio,0,0,ratio,0,0);entry.nativeRatio=ratio;}
    };
    surfaces.set(area,entry);return entry;
  };
  api.patch(timeline,'syncMultiLineChrome',previous=>function(area,...args){if(surfaces.get(area)?.painting)return;return previous.call(this,area,...args);});
  for(const [area,key,method]of [['notes','notesCanvas','draw'],['events','eventsCanvas','drawEvents']]){
    const native=timeline[key],surface=create(native,area);
    api.patch(timeline,method,previous=>function(...args){
      if(!state.active||this.noteView){surface.canvas.hidden=true;return previous.apply(this,args);}
      this.syncMultiLineChrome(area,native.clientWidth);surface.begin();const previousCanvas=this[key];this[key]=surface.facade;surface.painting=true;
      try{return previous.apply(this,args);}finally{this[key]=previousCanvas;surface.painting=false;}
    });
  }
  state.surfaces={hide(){for(const entry of surfaces.values()){entry.canvas.hidden=true;entry.dirty=true;}}};
  api.dispose(()=>{for(const entry of surfaces.values())entry.canvas.remove();surfaces.clear();delete state.surfaces;});
}
