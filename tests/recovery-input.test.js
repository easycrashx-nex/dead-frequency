import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryInput} from '../launcher/recovery-input.js';

function controller({down=false,axes=[0,0,0,0],held=-1,mapping='standard',id='Xbox Controller',index=0}={}){
  return {id,index,mapping,connected:true,axes,buttons:Array.from({length:17},(_,i)=>({pressed:(i===0&&down)||i===held,value:((i===0&&down)||i===held)?1:0}))};
}
function harness(){
  const pending=new Map();let sequence=0,pads=[],enabled=true,confirms=0;
  const input=createRecoveryInput({onConfirm:()=>confirms++,getGamepads:()=>pads,isEnabled:()=>enabled,
    requestFrame:callback=>{pending.set(++sequence,callback);return sequence;},cancelFrame:id=>pending.delete(id)});
  return {input,pending,get confirms(){return confirms;},set enabled(value){enabled=value;},step(nextPads){pads=nextPads;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback();}};
}

test('recovery ignores held confirm on entry and confirms once per fresh press after neutral',()=>{
  const h=harness();
  for(let i=0;i<5;i++)h.step([controller({down:true})]);
  assert.equal(h.confirms,0);
  h.step([controller()]);h.step([controller({down:true})]);
  for(let i=0;i<5;i++)h.step([controller({down:true})]);
  assert.equal(h.confirms,1);
  h.step([controller()]);h.step([controller({down:true})]);assert.equal(h.confirms,2);
  h.input.dispose();
});

test('all sticks and buttons must be released, unsupported mappings never confirm',()=>{
  const h=harness();
  h.step([controller({axes:[.8,0,0,0]})]);h.step([controller({down:true})]);assert.equal(h.confirms,0);
  h.step([controller({held:7})]);h.step([controller({down:true})]);assert.equal(h.confirms,0);
  h.step([controller({mapping:''})]);h.step([controller({mapping:'',down:true})]);assert.equal(h.confirms,0);
  h.step([controller({id:'DualSense Wireless Controller'})]);h.step([controller({id:'DualSense Wireless Controller',down:true})]);assert.equal(h.confirms,1);
  h.input.dispose();
});

test('disconnect, controller replacement and unavailable screen require fresh neutral input',()=>{
  const h=harness();
  h.step([controller()]);h.step([]);h.step([controller({down:true})]);assert.equal(h.confirms,0);
  h.step([controller()]);h.step([controller({id:'Other Controller',down:true})]);assert.equal(h.confirms,0);
  h.step([controller()]);h.enabled=false;h.step([controller()]);h.enabled=true;h.step([controller({down:true})]);assert.equal(h.confirms,0);
  h.step([controller()]);h.step([controller({down:true})]);assert.equal(h.confirms,1);
  h.input.dispose();
});

test('dispose cancels the independent frame loop and is safe to call twice',()=>{
  const h=harness();h.step([controller()]);
  const lateFrame=[...h.pending.values()][0];assert.equal(h.pending.size,1);
  h.input.dispose();h.input.dispose();assert.equal(h.pending.size,0);
  lateFrame();h.step([controller({down:true})]);assert.equal(h.confirms,0);assert.equal(h.pending.size,0);
});
