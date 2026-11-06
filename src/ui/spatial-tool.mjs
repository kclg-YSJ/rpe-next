import { t } from '../i18n.mjs';
// No geometry, scene evaluator, pointer listener or animation exists before opening this tool.
export class SpatialTool {
  constructor(host,getContext,actions){this.host=host;this.getContext=getContext;this.actions=actions;}
  get enabled(){return Boolean(this.panel?.visible);}
  get animating(){return Boolean(this.panel?.animating);}
  async open(){try{const{SpatialPreview}=await import('./spatial-preview.mjs');this.panel??=new SpatialPreview(this.host,this.getContext,this.actions);this.panel.open();}catch(error){this.actions.notify(error.message,'error');}}
  before(renderer){try{this.panel?.before(renderer);}catch(error){this.fail(error);}}
  draw(renderer,chart,tempo,seconds){try{this.panel?.draw(renderer,chart,tempo,seconds);}catch(error){this.fail(error);}}
  fail(error){this.panel?.disable(true);this.actions.notify(t('spatial.failed',{reason:error.message}),'error');}
  action(action,event){return this.panel?.action(action,event)??false;}
  reset(){this.panel?.disable(true);}
}
