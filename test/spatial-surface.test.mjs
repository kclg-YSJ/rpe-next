import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialShaderSurface } from '../src/ui/spatial-surface.mjs';

function fixture() {
  const parent={};
  const canvas={style:{visibility:'visible',width:'100%',transform:'none'},width:1200,height:800,
    cloneNode(){return{...this,style:{...this.style}};},replaceWith(next){parent.child=next;}};
  parent.child=canvas;
  const errors=[],renderer={shaderCanvas:canvas,shaderPipeline:{ordinary:true},shaderRuntime:{report:message=>errors.push(message)},invalidate(){this.invalidated=true;}};
  return{renderer,canvas,parent,errors};
}

test('空间模式单独使用预乘着色器画布，原预览画布和程序完整保留',()=>{
  const{renderer,canvas,parent,errors}=fixture(),ordinary=renderer.shaderPipeline;
  const surface=new SpatialShaderSurface(renderer);
  assert.equal(renderer.shaderPipeline.premultipliedAlpha,true);
  assert.equal(renderer.shaderPipeline.gl,null);assert.equal(renderer.shaderCanvas.width,1200);
  assert.equal(renderer.shaderCanvas.style.width,'100%');assert.equal(renderer.shaderCanvas.style.visibility,'hidden');
  assert.equal(canvas.style.visibility,'visible');assert.equal(parent.child,surface.canvas);
  surface.pipeline.report('sample');assert.deepEqual(errors,['sample']);
  surface.pipeline.invalidate();assert.equal(renderer.invalidated,true);
  let lost=0;surface.pipeline.gl={getExtension:()=>({loseContext(){lost++;}})};
  surface.pipeline.canvas=surface.canvas;
  surface.restore();surface.restore();
  assert.equal(lost,1);assert.equal(renderer.shaderCanvas,canvas);assert.equal(parent.child,canvas);
  assert.equal(renderer.shaderPipeline,ordinary);assert.equal(canvas.width,1200);assert.equal(surface.canvas.width,1);
});

test('空间临时资源释放不覆盖外部已替换的预览资源',()=>{
  const{renderer}=fixture(),surface=new SpatialShaderSurface(renderer),externalCanvas={},externalPipeline={};
  renderer.shaderCanvas=externalCanvas;renderer.shaderPipeline=externalPipeline;
  surface.restore();assert.equal(renderer.shaderCanvas,externalCanvas);assert.equal(renderer.shaderPipeline,externalPipeline);
});
