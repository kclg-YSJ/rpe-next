import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, createLine, createNote } from '../src/core/chart.mjs';
import { TempoMap } from '../src/core/tempo.mjs';
import { SceneRuntime } from '../src/core/scene.mjs';
import { HitGeometryCache } from '../src/core/hit-effects.mjs';
import { HIT_DURATION } from '../src/core/visual-constants.mjs';
import { Preview } from '../src/ui/preview.mjs';
import { AutoplayScene } from '../src/ui/render-studio/renderer.mjs';
import { hitParticles as renderParticles, HIT_PARTICLE_SECONDS, HIT_PARTICLE_SCALE, HIT_PARTICLE_REACH, HIT_PARTICLE_SHRINK, particleEasing, shrinkEasing } from '../src/core/render-particles.mjs';
import { hitFrame } from '../src/core/visual-constants.mjs';

function fixture(lines, { policy='render', skinLife, batch=false }={}) {
  const chart=createChart();chart.judgeLineList=lines;
  const scene=new SceneRuntime();scene.compile(chart,new TempoMap(chart.BPMList));
  const sprites=[],particles=[],native=[];let batches=0;
  const context={globalAlpha:1,save(){},restore(){},drawImage(image,x,y){sprites.push({image,x,y});},fillRect(){}};
  const preview=Object.assign(Object.create(Preview.prototype),{scene,effectsSince:0,noteSize:175,
    noteDraft:{runtime:(scene,index)=>scene.lines[index]},hitGeometry:new HitGeometryCache(),
    skin:{hitLifetime:skinLife,hitBatchCompatible:batch,hitRadius:()=>400,
      drawHit(_context,hit){native.push(hit);return policy==='skin';},tinted:name=>name},
    hitBatch:{begin:()=>{batches++;return context;},end:()=>true},
  });
  const renderer=Object.assign(Object.create(AutoplayScene.prototype),{preview,skin:preview.skin,noteSkinPack:null,
    settings:{showHitEffects:true,skinPolicy:policy},width:1350,height:900,dpr:1,positionScale:{x:1,y:1},
    paintStudioParticles(_context,age,_seed,x,y){particles.push({age,x,y});},
  });
  return {renderer,context,sprites,particles,native,get batches(){return batches;},paint:seconds=>renderer.paintHitEffects(context,{width:1350,height:900,scale:1,positionScale:{x:1,y:1},viewport:{left:0,top:0,width:1350,height:900}},seconds)};
}

test('密集渲染不让旧粒子占满数量限制，后续新打击贴图全部保留',()=>{
  const line=createLine();line.notes=Array.from({length:1200},(_,i)=>createNote(1,(.34+i*.00054)*2,0));
  const f=fixture([line],{batch:true});f.paint(1);
  const start=note=>(note.startTime[0]+note.startTime[1]/note.startTime[2])/2;
  const recent=line.notes.filter(n=>1-start(n)<2/3&&start(n)<1),pictures=recent.filter(n=>1-start(n)<HIT_DURATION);
  assert.ok(pictures.length>241);assert.equal(f.sprites.length,pictures.length);assert.equal(f.particles.length,recent.length);assert.ok(f.batches>0);
});
test('屏外密集打击不遮蔽后续判定线，假音符不产生特效',()=>{
  const outside=createLine(),inside=createLine();outside.notes=Array.from({length:600},()=>createNote(1,1.5,5000));
  inside.notes=Array.from({length:700},(_,i)=>({...createNote(1,1.8,0),isFake:i<50?1:0}));
  const f=fixture([outside,inside]);f.paint(1);
  assert.equal(f.sprites.length,650);assert.equal(f.particles.length,650);assert.ok(f.particles.every(p=>p.x===675));
});
test('跟随皮肤复用普通播放的特效寿命，不追加渲染器粒子',()=>{
  const line=createLine();line.notes=[createNote(1,.8,0),createNote(1,1.8,0)];
  const f=fixture([line],{policy:'skin',skinLife:.5});f.paint(1);
  assert.equal(f.native.length,1);assert.ok(Math.abs(f.native[0].age-.1)<1e-8);assert.equal(f.particles.length,0);
});

test('渲染器使用 PR 调整后的粒子参数，命中贴图和普通播放保持原有路径', () => {
  const seed = 42, size = 175;
  for (const age of [.05, .2, .4 / 1.5, .3, .45, .65]) {
    const progress = age * 1.5, spread = particleEasing(progress), scale = HIT_PARTICLE_SCALE, reach = HIT_PARTICLE_REACH;
    const shrink = progress < .4 ? 1 : 1 - HIT_PARTICLE_SHRINK * shrinkEasing((progress - .4) / .6);
    const particles = renderParticles(age, seed, size);
    assert.equal(particles.length, 4);
    for (const particle of particles) {
      assert.ok(Math.abs(Math.hypot(particle.x, particle.y) / (size * reach * spread) - 1) < 1e-12);
      assert.ok(Math.abs(particle.radius / (size * .0907 * spread * shrink * scale) - 1) < 1e-12);
      assert.equal(particle.alpha, 1 - progress);
    }
    const sprites = [], renderer = Object.assign(Object.create(AutoplayScene.prototype), {
      preview: { skin: { tinted: name => name } }, noteSkinPack: null, paintStudioParticles() {},
    });
    renderer.drawRenderHit({ drawImage: (...args) => sprites.push(args) }, { age, seed, size: size * 1.4, x: 400, y: 300, rotation: 0 });
    const frame = hitFrame(age);
    assert.deepEqual(sprites, frame === null ? [] : [[`img-${frame}`, 400 - size * .7, 300 - size * .7, size * 1.4, size * 1.4]]);
  }
  assert.deepEqual(renderParticles(-.001, seed, size), []);
  assert.deepEqual(renderParticles(HIT_PARTICLE_SECONDS, seed, size), []);
});
