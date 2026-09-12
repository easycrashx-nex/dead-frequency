import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-admin-native-${version}`);await fs.mkdir(out,{recursive:true});
const credentials=JSON.parse(await fs.readFile(process.env.DF_QA_ACCOUNTS||'../qa-online-native-1.12.0/accounts.private.json','utf8'));
const privileged=JSON.parse(await fs.readFile(process.env.DF_QA_ADMIN||'../../private/admin-access.private.json','utf8'));
const clients=[],checks=[],errors=[];let failure,host,guest,before,grantedId;
const secrets=[privileged.password,...credentials.map(value=>value.password)].filter(value=>typeof value==='string'&&value.length);
const redact=value=>secrets.reduce((text,secret)=>text.replaceAll(secret,'[REDACTED]'),String(value));
const pass=label=>{checks.push(label);console.log('PASS',label);};
async function launch(index,profile){
  profile??=await fs.mkdtemp(path.join(out,`profile-${index}-`));
  const env={...process.env,DEAD_FREQUENCY_QA_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:exe,args:['--qa','--play'],env,timeout:45000}),page=await app.firstWindow();
  const client={app,page,profile,index};clients.push(client);
  page.on('pageerror',error=>errors.push(redact(error.message)));page.on('console',message=>{if(message.type()==='error')errors.push(redact(message.text()));});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true',null,{timeout:60000});
  return client;
}
async function gameApi(client,route,body){return client.page.evaluate(({route,body})=>platform.onlineRequest(route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body})}),{route,body});}
async function adminApi(client,route,body){const result=await client.page.evaluate(({route,body})=>platform.adminRequest(`/api/admin/${route}`,body===undefined?{}:{body}),{route,body});
  if(result.adminError)throw Object.assign(new Error(result.adminError.message),{status:result.adminError.status});return result;}
async function adminAction(client,action,payload){return adminApi(client,'action',{action,payload,requestId:crypto.randomUUID()});}
async function adminOpen(client){await client.page.bringToFront();if(!await client.page.locator('#admin-overlay').isVisible())await client.page.keyboard.press('F8');await client.page.locator('#admin-overlay').waitFor();}
async function adminLogin(client){await adminOpen(client);await client.page.locator('#admin-username').fill(privileged.username);await client.page.locator('#admin-password').fill(privileged.password);await client.page.locator('#admin-login').click();await client.page.locator('#admin-authenticated').waitFor({state:'visible',timeout:30000});await idleAdmin(client);}
async function login(client){
  await client.page.bringToFront();if(await client.page.locator('#admin-overlay').isVisible())await client.page.locator('#admin-close').click();
  await client.page.locator('#account-open').click();await client.page.locator('#account-login-tab').click();
  await client.page.locator('#account-username').fill(credentials[client.index].username);await client.page.locator('#account-password').fill(credentials[client.index].password);await client.page.locator('#account-submit').click();
  await client.page.waitForFunction(()=>__DF.state.online===true,null,{timeout:30000});await client.page.locator('#account-overlay').waitFor({state:'hidden'});client.id=(await gameApi(client,'/api/me')).user.id;
}
async function idleAdmin(client){await client.page.waitForFunction(()=>!document.querySelector('#admin-refresh').disabled,null,{timeout:30000});}
async function findPlayer(client,name){await client.page.locator('[data-admin-tab="player"]').click();await client.page.locator('#admin-player-name').fill(name);await client.page.locator('#admin-player-search').click();await client.page.locator('#admin-player-content').waitFor({state:'visible'});await idleAdmin(client);}
async function roomStart(){
  for(const client of [host,guest]){await client.page.bringToFront();if(await client.page.locator('#admin-overlay').isVisible())await client.page.locator('#admin-close').click();}
  await host.page.locator('#coop-open').click();await host.page.locator('#coop-visibility').selectOption('public');await host.page.locator('#coop-create').click();
  await host.page.waitForFunction(()=>__DF.coop?.info.status==='lobby',null,{timeout:60000});
  const room=(await gameApi(host,'/api/me')).room;
  await guest.page.locator('#coop-open').click();await guest.page.locator('#coop-refresh').click();
  await guest.page.locator(`[data-lobby-join="${room.roomId}"]`).click();
  for(const client of [host,guest]){await client.page.waitForFunction(()=>__DF.coop?.info.players.length===2,null,{timeout:60000});await client.page.bringToFront();await client.page.locator('#coop-ready').click();}
  await host.page.bringToFront();await host.page.locator('#coop-start').click();
  for(const client of [host,guest])await client.page.waitForFunction(()=>['raid','paused'].includes(__DF.state.phase)&&__DF.state.teammates.length===1,null,{timeout:60000});
  return room;
}
async function backToHub(client){await client.page.bringToFront();await client.page.evaluate(()=>__DF.ui.closePanels());
  await client.page.locator('#result-hub').waitFor({state:'visible',timeout:20000});
  await client.page.waitForFunction(()=>!document.querySelector('#account-leave-room').disabled,null,{timeout:20000});
  await client.page.locator('#result-hub').click();
  if(await client.page.locator('#result-hub').isVisible()&&/BESTÄTIGEN/.test(await client.page.locator('#result-hub').innerText()))await client.page.locator('#result-hub').click();
  await client.page.waitForFunction(()=>!__DF.coop&&__DF.state.phase==='hub',null,{timeout:20000});}
try{
  host=await launch(0);guest=await launch(1);
  await adminOpen(host);assert.equal(await host.page.evaluate(()=>__DF.state.online===true),false);
  await host.page.locator('#admin-username').fill(privileged.username);await host.page.locator('#admin-password').fill('deliberately-wrong-test-password');await host.page.locator('#admin-login').click();
  await host.page.waitForFunction(()=>document.querySelector('#admin-message').classList.contains('is-error'));assert.equal(await host.page.locator('#admin-authenticated').isVisible(),false);
  await adminLogin(host);assert.ok(await host.page.locator('#admin-password').inputValue()==='','Password field must be cleared');assert.ok((await adminApi(host,'me')).token===undefined,'Admin token must stay in the native process');
  pass('Separate admin login works without a game account; wrong password denied and token stays native');
  await host.page.keyboard.press('F8');assert.equal(await host.page.locator('#admin-overlay').isVisible(),false);
  await login(host);await login(guest);await adminOpen(host);assert.equal(await host.page.locator('#admin-authenticated').isVisible(),true);
  await assert.rejects(adminApi(guest,'overview'),{status:401});pass('Game login preserves admin authority while another ordinary client has none');
  before=(await gameApi(host,'/api/me')).profile;await findPlayer(host,credentials[0].username);
  await host.page.locator('#admin-credits').fill('17');await host.page.locator('[data-admin-action="credits-add"]').click();
  await host.page.waitForFunction(value=>__DF.state.profile.credits===value,before.credits+17,{timeout:30000});await idleAdmin(host);
  const catalog=(await adminApi(host,'catalog')).items;assert.ok(catalog.length>=190);
  const loot=catalog.find(item=>item.kind==='trade')??catalog.at(-1);
  await host.page.locator('#admin-catalog').selectOption(loot.id);await host.page.locator('#admin-quantity').fill('1');await host.page.locator('[data-admin-action="item-grant"]').click();
  await host.page.waitForFunction(value=>__DF.state.profile.stash.length===value,before.stash.length+1,{timeout:30000});
  const after=(await gameApi(host,'/api/me')).profile;grantedId=after.stash.find(item=>!before.stash.some(old=>old.id===item.id)).id;
  pass('Player search, credits and catalog grant update the real server profile and native hub');
  await idleAdmin(host);await host.app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.setSize(1366,768);});
  await host.page.waitForTimeout(300);const fit=await host.page.locator('.admin-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&el.scrollWidth<=el.clientWidth+1;});assert.equal(fit,true);
  await host.page.screenshot({path:path.join(out,'admin-player-1366.png')});pass('Admin player tools fit the real 1366 by 768 window without horizontal scrolling');
  await adminAction(host,'item-remove',{userId:host.id,itemId:grantedId});grantedId=null;await adminAction(host,'credits-set',{userId:host.id,amount:before.credits});
  await host.page.locator('#admin-close').click();await host.page.locator('#account-open').click();await host.page.locator('#account-logout').click();await host.page.waitForFunction(()=>!__DF.state.online);
  await adminOpen(host);assert.equal(await host.page.locator('#admin-authenticated').isVisible(),true);await login(host);pass('Admin remains usable after logout and re-login of the game account');
  const room=await roomStart(),a=await host.page.evaluate(()=>({spawn:__DF.state.raid.spawn,p:__DF.state.player})),b=await guest.page.evaluate(()=>({spawn:__DF.state.raid.spawn,p:__DF.state.player}));
  assert.equal(a.spawn.id,b.spawn.id);assert.notEqual(a.spawn.id,'arrival');assert.ok(Math.hypot(a.p.x-b.p.x,a.p.z-b.p.z)<5);pass('Two Windows clients enter the same randomized map entry together');
  await adminAction(host,'godmode',{userId:guest.id,enabled:true});await adminAction(host,'heal',{userId:guest.id});
  await adminOpen(host);await idleAdmin(host);await host.page.locator('[data-admin-tab="raid"]').click();await host.page.locator('#admin-raid-room').selectOption(room.roomId);await host.page.locator('#admin-raid-player').selectOption(host.id);
  await host.page.locator('[data-admin-action="godmode"]').click();await host.page.waitForFunction(()=>__DF.state.player.adminGodmode===true,null,{timeout:15000});await idleAdmin(host);
  await host.page.locator('[data-admin-action="stamina"]').click();await host.page.waitForFunction(()=>__DF.state.player.adminStamina===true,null,{timeout:15000});await idleAdmin(host);
  await host.page.locator('[data-admin-action="refill"]').click();await host.page.waitForFunction(()=>__DF.state.player.medkits>=4,null,{timeout:15000});await idleAdmin(host);
  const overview=await adminApi(host,'overview'),spawn=overview.server.spawns.find(value=>value.id!==a.spawn.id);assert.equal(overview.server.spawns.length,16);
  await host.page.locator('#admin-spawn').selectOption(spawn.id);await host.page.locator('[data-admin-action="teleport-spawn"]').click();
  await host.page.waitForFunction(pos=>Math.hypot(__DF.state.player.x-pos.x,__DF.state.player.z-pos.z)<4,spawn,{timeout:15000});
  await idleAdmin(host);await host.page.screenshot({path:path.join(out,'admin-raid.png')});pass('Native raid tools enable protection, refill supplies and teleport to a real safe map entry');
  await host.page.locator('#admin-teleport-player').selectOption(guest.id);await host.page.locator('[data-admin-action="teleport-player"]').click();
  await host.page.waitForFunction(()=>{const t=__DF.state.teammates[0];return t&&Math.hypot(__DF.state.player.x-t.x,__DF.state.player.z-t.z)<5;},null,{timeout:15000});pass('Teleport to teammate returns to the same raid without overlap');
  await adminAction(host,'enemies-clear',{roomId:room.roomId});await guest.page.waitForFunction(()=>__DF.state.enemies.every(enemy=>enemy.dead),null,{timeout:15000});
  await adminAction(host,'room-close',{roomId:room.roomId});
  for(const client of [host,guest])await client.page.waitForFunction(()=>__DF.coop?.info.status==='error',null,{timeout:15000});
  assert.equal((await adminApi(host,'overview')).server.rooms.length,0);for(const client of [host,guest])await backToHub(client);
  pass('Clearing enemies replicates to both clients; closing the raid releases both server account locks');
  await adminOpen(host);await idleAdmin(host);await host.page.locator('[data-admin-tab="audit"]').click();await host.page.locator('#admin-refresh').click();await idleAdmin(host);
  assert.ok((await adminApi(host,'overview')).audit.some(entry=>entry.action==='teleport-spawn'));await host.page.screenshot({path:path.join(out,'admin-audit.png')});pass('Privileged operations appear in the persistent audit view');
  const profile=host.profile;await host.app.close();clients.splice(clients.indexOf(host),1);host=await launch(0,profile);await host.page.waitForFunction(()=>__DF.state.online===true,null,{timeout:30000});host.id=(await gameApi(host,'/api/me')).user.id;
  await adminOpen(host);assert.equal(await host.page.locator('#admin-authenticated').isVisible(),false);await assert.rejects(adminApi(host,'overview'),{status:401});pass('Native restart keeps the encrypted game login but requires a fresh admin login');
  assert.deepEqual(errors,[]);pass('No renderer exceptions or console errors in the two-client native run');
}catch(error){failure=redact(error.stack||error.message);console.error(failure);}
finally{
  for(const client of clients)try{await gameApi(client,'/api/rooms/leave',{});}catch{}
  if(host&&!host.app.process().killed&&host.id&&before)try{
    const current=(await gameApi(host,'/api/me')).profile;
    if(grantedId||current.credits!==before.credits){
      try{await adminApi(host,'me');}catch{await adminApi(host,'login',{username:privileged.username,password:privileged.password});}
      if(grantedId)await adminAction(host,'item-remove',{userId:host.id,itemId:grantedId});
      await adminAction(host,'credits-set',{userId:host.id,amount:before.credits});
    }
  }catch{}
  for(const client of clients)try{await client.app.close();}catch{}
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({version,native:true,exe,appAsarSha256,checks,errors,...(failure?{failure}:{})},null,2));
}
if(failure||errors.length)process.exitCode=1;
