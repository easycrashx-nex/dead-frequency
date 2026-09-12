import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminClient} from '../src/admin-client.js';
test('Admin UI state remains separate and expires without touching game-account state',async()=>{
  let now=100;const calls=[];
  const client=createAdminClient({clock:()=>now,request:async(route,options)=>{
    calls.push({route,options});
    if(route.endsWith('/catalog'))return {catalog:[{id:'test-item'}]};
    return {admin:{username:'Director'},expiresAt:200,server:{rooms:[]},audit:[]};
  }});
  assert.equal(await client.login('Director','only-test-password'),true);
  assert.equal(client.info.authenticated,true);assert.equal(client.info.catalog.length,1);
  assert.equal(JSON.stringify(client.info).includes('only-test-password'),false);
  now=201;client.poll(true);assert.equal(client.info.authenticated,false);assert.equal(client.info.overview,null);
  assert.ok(calls.every(call=>call.route.startsWith('/api/admin/')));
});
test('Admin IPC authorization failures clear privileged state and actions carry unique idempotency IDs',async()=>{
  let unauthorized=false;const ids=[];
  const client=createAdminClient({request:async(route,options)=>{
    if(unauthorized)return {adminError:{message:'Abgelaufen',status:401}};
    if(route.endsWith('/action'))ids.push(options.body.requestId);
    return {admin:{username:'Director'},expiresAt:Date.now()+10000,catalog:[],server:{rooms:[]},audit:[],ok:true};
  }});
  await client.login('Director','only-test-password');await client.action('heal',{userId:'a'});await client.action('heal',{userId:'a'});
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
  unauthorized=true;await client.findPlayer('Someone');assert.equal(client.info.authenticated,false);assert.equal(client.info.error,'Abgelaufen');
});
