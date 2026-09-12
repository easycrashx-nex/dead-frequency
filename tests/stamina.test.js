import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../src/simulation.js';
const tick=(game,seconds,input={})=>{for(let i=0;i<Math.ceil(seconds*60);i++)game.update(1/60,input);};
const held={forward:1,sprint:true};
async function setup(t){const game=await createGame();t.after(()=>game.dispose());game.startRaid({seed:12});game.state.enemies=[];game.teleport(-145,140);return game;}

test('exhaustion produces one sprint exit while held Shift allows steady recovery',async t=>{
  const game=await setup(t);game.state.player.stamina=2;
  let transitions=0,previous=false,exhausted=false;
  for(let i=0;i<480;i++){
    game.update(1/60,held);const p=game.state.player;
    if(p.sprinting!==previous){transitions++;previous=p.sprinting;}
    if(exhausted)assert.equal(p.sprinting,false,'Holding Shift must never flicker back to sprint');
    exhausted ||= p.sprintExhausted;
    assert.ok(p.stamina>=0&&p.stamina<=100);
  }
  assert.equal(transitions,2);assert.equal(game.state.player.stamina,100);
  assert.equal(game.state.player.sprintExhausted,true);
});
test('releasing Shift re-arms sprint after a useful stamina reserve has recovered',async t=>{
  const game=await setup(t);game.state.player.stamina=2;tick(game,.2,held);
  assert.equal(game.state.player.sprintExhausted,true);
  game.update(1/60,{forward:1}); // Release is remembered even during low stamina.
  tick(game,.3,held);assert.equal(game.state.player.sprinting,false);
  tick(game,1.1,held);assert.equal(game.state.player.sprinting,true);assert.equal(game.state.player.sprintExhausted,false);
  assert.ok(game.state.player.stamina>10);
});
test('a rested player can stop and resume normal sprint immediately without an exhaustion lock',async t=>{
  const game=await setup(t);tick(game,.4,held);assert.equal(game.state.player.sprinting,true);
  game.update(1/60,{forward:1});assert.equal(game.state.player.sprinting,false);
  game.update(1/60,held);assert.equal(game.state.player.sprinting,true);assert.equal(game.state.player.sprintExhausted,false);
});
test('zero stamina, pause and a new raid leave exhaustion state consistent',async t=>{
  const game=await setup(t);game.state.player.stamina=0;
  tick(game,1,held);assert.equal(game.state.player.sprinting,false);assert.equal(game.state.player.sprintExhausted,true);
  game.pause(true);const before=JSON.stringify(game.state.player);tick(game,4,held);assert.equal(JSON.stringify(game.state.player),before);
  game.pause(false);tick(game,1,held);assert.equal(game.state.player.sprinting,false);
  game.returnToHub();game.startRaid({seed:13});game.state.enemies=[];
  assert.equal(game.state.player.stamina,100);assert.equal(game.state.player.sprintExhausted,false);
  game.update(1/60,held);assert.equal(game.state.player.sprinting,true);
});
