import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createOnlinePlatform, ONLINE_ORIGIN } = createRequire(import.meta.url)('../online-platform.cjs');
const token = 'a'.repeat(64);
const storage = { isEncryptionAvailable:()=>true,
  encryptString:value=>Buffer.from([...value].reverse().join('')),
  decryptString:value=>[...value.toString()].reverse().join('') };
function fixture(t, request, safeStorage=storage) {
  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'df-session-test-'));
  t.after(()=>fs.rmSync(userData,{recursive:true,force:true}));
  return { userData, safeStorage, request };
}
test('Online bridge seals session, restores it and never returns token to renderer',async t=>{
  const calls=[];
  const config=fixture(t,async(url,options)=>{
    calls.push({url,options});
    return Response.json(url.endsWith('/login')?{token,user:{username:'Operator'},profile:{credits:500}}:{profile:{credits:500}});
  });
  const result=await createOnlinePlatform(config).onlineRequest('/api/auth/login',{body:{username:'Operator',password:'test-only-password'}});
  assert.equal(result.token,undefined);assert.equal(result.sessionPersistent,true);
  const bytes=fs.readFileSync(path.join(config.userData,'online-session.enc'),'utf8');
  assert.ok(!bytes.includes('test-only-password'));assert.ok(!bytes.includes('"token"'));
  await createOnlinePlatform(config).onlineRequest('/api/me');
  assert.equal(calls[1].options.headers.Authorization,`Bearer ${token}`);
  assert.equal(calls[1].url,`${ONLINE_ORIGIN}/api/me`);
  assert.equal(calls[1].options.redirect,'error');
});
test('Online bridge refuses arbitrary routes, methods and oversized bodies before network',async t=>{
  let calls=0;const bridge=createOnlinePlatform(fixture(t,async()=>{calls++;return Response.json({token});}));
  for(const route of ['https://evil.example/api/me','/api/me?url=evil','/api/../secret','/api/me#token'])await assert.rejects(bridge.onlineRequest(route));
  await assert.rejects(bridge.onlineRequest('/api/auth/login',{method:'GET'}));
  await assert.rejects(bridge.onlineRequest('/api/auth/login',{body:{password:'x'.repeat(40000)}}));
  assert.equal(calls,0);
});
test('Logout deletes persisted session and unauthorized response clears stale token',async t=>{
  let invalid=false;const config=fixture(t,async url=>url.endsWith('/login')?Response.json({token}):invalid?Response.json({message:'Abgelaufen'},{status:401}):Response.json({ok:true}));
  let bridge=createOnlinePlatform(config);await bridge.onlineRequest('/api/auth/login');await bridge.onlineRequest('/api/auth/logout');
  assert.equal(fs.existsSync(path.join(config.userData,'online-session.enc')),false);
  await assert.rejects(bridge.onlineRequest('/api/me'),/zuerst an/);
  await bridge.onlineRequest('/api/auth/login');invalid=true;
  await assert.rejects(bridge.onlineRequest('/api/me'),/Abgelaufen/);
  assert.equal(fs.existsSync(path.join(config.userData,'online-session.enc')),false);
});
test('Unavailable OS encryption keeps session only in memory',async t=>{
  const config=fixture(t,async()=>Response.json({token}),{isEncryptionAvailable:()=>false});
  const bridge=createOnlinePlatform(config);assert.equal((await bridge.onlineRequest('/api/auth/login')).sessionPersistent,false);
  assert.deepEqual(fs.readdirSync(config.userData),[]);
  await assert.rejects(createOnlinePlatform(config).onlineRequest('/api/me'),/zuerst an/);
});
test('Logout works after token expiry and while service is unreachable',async t=>{
  let offline=false;const config=fixture(t,async()=>{if(offline)throw new Error('offline');return Response.json({token});});
  const bridge=createOnlinePlatform(config);
  assert.deepEqual(await bridge.onlineRequest('/api/auth/logout'),{ok:true});
  await bridge.onlineRequest('/api/auth/login');offline=true;
  assert.deepEqual(await bridge.onlineRequest('/api/auth/logout'),{ok:true,revoked:false});
  assert.equal(fs.existsSync(path.join(config.userData,'online-session.enc')),false);
  await assert.rejects(bridge.onlineRequest('/api/me'),/zuerst an/);
});
test('Delayed unauthorized response cannot erase a newer authenticated session',async t=>{
  let release,logins=0;const nextToken='b'.repeat(64);
  const config=fixture(t,async url=>{
    if(url.endsWith('/login'))return Response.json({token:++logins===1?token:nextToken});
    return new Promise(resolve=>{release=resolve;});
  });
  const bridge=createOnlinePlatform(config);await bridge.onlineRequest('/api/auth/login');
  const stale=assert.rejects(bridge.onlineRequest('/api/me'),/Abgelaufen/);
  await bridge.onlineRequest('/api/auth/login');release(Response.json({message:'Abgelaufen'},{status:401}));await stale;
  const saved=JSON.parse(storage.decryptString(fs.readFileSync(path.join(config.userData,'online-session.enc'))));
  assert.equal(saved.token,nextToken);
});
test('Delayed logout cannot erase a newer login, and logout cancels pending login',async t=>{
  let release,logins=0;const nextToken='b'.repeat(64);
  const config=fixture(t,async url=>url.endsWith('/login')?Response.json({token:++logins===1?token:nextToken}):new Promise(resolve=>{release=resolve;}));
  const bridge=createOnlinePlatform(config);await bridge.onlineRequest('/api/auth/login');
  const oldLogout=bridge.onlineRequest('/api/auth/logout');await bridge.onlineRequest('/api/auth/login');release(Response.json({ok:true}));await oldLogout;
  assert.equal(JSON.parse(storage.decryptString(fs.readFileSync(path.join(config.userData,'online-session.enc')))).token,nextToken);
  let finishLogin;
  const empty=fixture(t,()=>new Promise(resolve=>{finishLogin=resolve;}));const second=createOnlinePlatform(empty);
  const pending=assert.rejects(second.onlineRequest('/api/auth/login'),/nicht mehr aktuell/);
  await second.onlineRequest('/api/auth/logout');finishLogin(Response.json({token}));await pending;
  assert.equal(fs.existsSync(path.join(empty.userData,'online-session.enc')),false);
});
