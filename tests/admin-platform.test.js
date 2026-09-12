import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createAdminPlatform}=createRequire(import.meta.url)('../admin-platform.cjs');
const first='a'.repeat(64),second='b'.repeat(64);
test('Admin bridge restricts destination and keeps privileged tokens out of renderer and disk',async()=>{
  const calls=[],bridge=createAdminPlatform({request:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/login')?{token:first,admin:{username:'Admin'}}:{ok:true});}});
  assert.deepEqual(await bridge.adminRequest('/api/admin/login',{body:{username:'Admin',password:'only-test-password'}}),{admin:{username:'Admin'}});
  await bridge.adminRequest('/api/admin/overview');
  assert.equal(calls[1].url,'https://91.98.64.49/api/admin/overview');assert.equal(calls[1].options.headers.Authorization,`Bearer ${first}`);assert.equal(calls[1].options.redirect,'error');
  for(const route of ['/api/me','https://evil.test/api/admin/me','/api/admin/me?x=1','/api/admin/../action'])await assert.rejects(bridge.adminRequest(route));
  await assert.rejects(bridge.adminRequest('/api/admin/me',{method:'POST'}));
  await assert.rejects(bridge.adminRequest('/api/admin/action',{body:{value:'x'.repeat(17000)}}));
  assert.equal(calls.length,2);await assert.rejects(createAdminPlatform().adminRequest('/api/admin/me'),/anmelden/);
});
test('Admin native logout works offline and stale unauthorized requests cannot revoke newer login',async()=>{
  let release,count=0,offline=false;
  const bridge=createAdminPlatform({request:async url=>{
    if(offline)throw new Error('offline');
    if(url.endsWith('/login'))return Response.json({token:++count===1?first:second});
    if(url.endsWith('/overview'))return new Promise(resolve=>{release=resolve;});
    return Response.json({ok:true});
  }});
  await bridge.adminRequest('/api/admin/login');
  const stale=assert.rejects(bridge.adminRequest('/api/admin/overview'),{status:401});
  await bridge.adminRequest('/api/admin/login');release(Response.json({message:'expired'},{status:401}));await stale;
  await bridge.adminRequest('/api/admin/me');offline=true;
  assert.deepEqual(await bridge.adminRequest('/api/admin/logout'),{ok:true,revoked:false});
  await assert.rejects(bridge.adminRequest('/api/admin/me'),{status:401});
});
test('Admin logout cancels an in-flight login',async()=>{
  let release;const bridge=createAdminPlatform({request:()=>new Promise(resolve=>{release=resolve;})});
  const pending=assert.rejects(bridge.adminRequest('/api/admin/login'),/nicht mehr aktuell/);
  await bridge.adminRequest('/api/admin/logout');release(Response.json({token:first}));await pending;
  await assert.rejects(bridge.adminRequest('/api/admin/me'),{status:401});
});
