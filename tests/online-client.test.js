import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOnlineClient,createOnlineHub,validateCredentials} from '../src/online-client.js';
import {createCoopClient} from '../src/coop-client.js';

const profile=(credits=750)=>({credits,stash:[],intake:[],loadout:{mode:'preset',presetId:'scout'}});
const identity={id:'account-1',username:'Operator_1'};
const deferred=()=>{let resolve;return{promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};

test('the actual account input pattern compiles with HTML Unicode Sets and accepts only valid ASCII names',()=>{
  const markup=readFileSync(new URL('../src/online-ui.js',import.meta.url),'utf8');
  const actualPattern=markup.match(/id="account-username"[^>]*\bpattern="([^"]+)"/)?.[1];
  assert.ok(actualPattern);
  assert.doesNotThrow(()=>new RegExp(actualPattern,'v'));
  // HTML pattern validation matches the complete value, not a substring.
  const valid=new RegExp(`^(?:${actualPattern})$`,'v');
  for(const name of ['Abc','Op_09','Alpha-One','___','---','a'.repeat(24)])assert.equal(valid.test(name),true,name);
  for(const name of ['','ab','a'.repeat(25),'a b','ab.c','äbc','abc/','abc\\','abc\n','abc😀'])assert.equal(valid.test(name),false,JSON.stringify(name));
});

test('account validation matches server constraints and missing native sessions remain ordinary offline starts',async()=>{
  assert.equal(validateCredentials(' Op_1 ','0123456789'),'');
  for(const [name,password] of [['aa','0123456789'],['a b','0123456789'],['x'.repeat(25),'0123456789'],['Valid','short'],['Valid','a'.repeat(129)]])assert.ok(validateCredentials(name,password));
  const client=createOnlineClient({request:async()=>{throw new Error("Error invoking remote method 'online:request': Error: Bitte melde dich zuerst an.");}});
  assert.equal(await client.restore(),false);assert.equal(client.info.error,'');assert.equal(client.info.busy,false);assert.equal(client.info.restoring,false);
});

test('online hub never simulates or mutates the offline profile and request payloads contain only actions',async()=>{
  const local={state:{phase:'hub',profile:profile(991),player:{x:2},raid:{loot:[]}},layout:{size:1500}};
  const original=JSON.stringify(local.state);const calls=[];
  const client=createOnlineClient({request:async(path,options)=>{calls.push({path,...options});return path.includes('/auth/')?{user:identity,profile:profile()}:{profile:profile(100),result:true};}});
  await client.authenticate('login','Operator_1','0123456789');const hub=createOnlineHub(local,client.profile);
  hub.update(1000);hub.state.profile.credits=50000;assert.equal(JSON.stringify(local.state),original);assert.equal(client.profile.credits,750);
  assert.equal(hub.startRaid,undefined);assert.equal(hub.purchaseEquipment,undefined);
  await client.action('game','purchaseEquipment',['VX-9']);
  assert.deepEqual(calls[1],{path:'/api/action',method:'POST',body:{kind:'game',action:'purchaseEquipment',args:['VX-9']}});
  assert.equal(client.profile.credits,100);assert.equal(JSON.stringify(local.state),original);
});

test('duplicate purchases are blocked and delayed market refreshes cannot overwrite a completed mutation',async()=>{
  const refresh=deferred(),purchase=deferred();let me=0,purchases=0;
  const client=createOnlineClient({request:async path=>{if(path==='/api/me'){me++;return refresh.promise;}if(path==='/api/action'){purchases++;return purchase.promise;}return{user:identity,profile:profile()};}});
  await client.authenticate('login','Operator_1','0123456789');const polling=client.refresh();const buying=client.action('game','purchaseEquipment',['VX-9']);
  assert.equal(await client.action('game','purchaseEquipment',['VX-9']),false);assert.equal(purchases,1);
  purchase.resolve({profile:profile(100),result:true});assert.equal(await buying,true);
  refresh.resolve({profile:profile(750)});await polling;assert.equal(client.profile.credits,100);assert.equal(me,1);
});

test('logout invalidates pending profile reads and exposes no retained credentials',async()=>{
  const pending=deferred(),sessions=[];
  const client=createOnlineClient({request:async path=>path==='/api/me'?pending.promise:path==='/api/auth/logout'?{ok:true}:{user:identity,profile:profile(),token:'must-not-retain'},onSession:value=>sessions.push(value)});
  await client.authenticate('register','Operator_1','0123456789');const poll=client.refresh();await client.logout();pending.resolve({profile:profile(9000)});await poll;
  assert.equal(client.info.authenticated,false);assert.equal(client.profile,null);assert.deepEqual(sessions,[true,false]);assert.equal(JSON.stringify(client.info).includes('must-not-retain'),false);
});

test('failed server mutations retain authoritative profile and clear busy state',async()=>{
  const client=createOnlineClient({request:async path=>path==='/api/action'?{error:'Nicht genug Credits.',code:'insufficient_funds',status:409}:{user:identity,profile:profile()}});
  await client.authenticate('login','Operator_1','0123456789');await assert.rejects(client.action('game','purchaseEquipment',['SR-90']),/Nicht genug/);
  assert.equal(client.info.busy,false);assert.equal(client.profile.credits,750);
});

test('online socket joins carry only the one-use ticket, while solo lobby constraints reach the UI',async()=>{
  const original=globalThis.WebSocket,messages=[];let wire,client;
  const local={state:{phase:'hub',profile:profile(),player:{x:0,y:0,z:0},raid:{loot:[]}},layout:{}};
  try{
    globalThis.WebSocket=class extends EventTarget{static OPEN=1;readyState=1;constructor(){super();wire=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}send(raw){const m=JSON.parse(raw);messages.push(m);if(m.type==='join')queueMicrotask(()=>this.receive({type:'welcome',id:'p1',hostId:'p1'}));}receive(m){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(m)}));}close(){this.readyState=3;}};
    client=createCoopClient({localGame:local});await client.connect(`wss://91.98.64.49/coop?token=${'a'.repeat(64)}`,{online:true,mode:'solo',ticket:'ticket-secret',profile:{credits:999999},name:'forged',loadout:{mode:'custom'}});
    assert.deepEqual(Object.keys(messages[0]).sort(),['protocol','ticket','type','version']);assert.equal(messages[0].ticket,'ticket-secret');
    wire.receive({type:'lobby',players:[{id:'p1',ready:true}],hostId:'p1',mode:'solo',minPlayers:1,maxPlayers:1});assert.equal(client.info.minPlayers,1);assert.equal(client.info.mode,'solo');
    assert.equal(JSON.stringify(client.info).includes('ticket-secret'),false);
  }finally{client?.dispose();globalThis.WebSocket=original;}
});
