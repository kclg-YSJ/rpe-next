import test from 'node:test';
import assert from 'node:assert/strict';
import { submitAgentText } from '../src/ui/agent-dialogues.mjs';

test('AI文本输入Enter提交、Shift/Alt Enter换行；不抢输入法候选或重复发送',()=>{
  let submits=0,prevented=0,stopped=0;
  const event=extra=>({key:'Enter',preventDefault(){prevented++;},stopPropagation(){stopped++;},...extra});
  for(const extra of [{shiftKey:true},{altKey:true},{isComposing:true},{keyCode:229},{defaultPrevented:true},{key:'Process'},{key:'a'}])assert.equal(submitAgentText(event(extra),()=>submits++),false);
  assert.equal(submits,0);assert.equal(prevented,0);
  for(const extra of [{},{ctrlKey:true},{metaKey:true}])assert.equal(submitAgentText(event(extra),()=>submits++),true);
  assert.equal(submits,3);assert.equal(prevented,3);assert.equal(stopped,3);
  assert.equal(submitAgentText(event({repeat:true}),()=>submits++),true);assert.equal(submits,3);assert.equal(prevented,4);
});
