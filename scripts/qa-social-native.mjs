import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-social-native-${version}`);await fs.mkdir(out,{recursive:true});
// Provision isolated QA accounts separately; never package or print this file.
const credentials=JSON.parse(await fs.readFile(process.env.DF_QA_ACCOUNTS||path.resolve('../qa-online-native-1.12.0/accounts.private.json'),'utf8'));
const clients=[],checks=[],errors=[];let failure;
const pass=label=>{checks.push(label);console.log('PASS',label);};
async function launch(index,profile){
  profile??=await fs.mkdtemp(path.join(out,`profile-${index}-`));
  const env={...process.env,DEAD_FREQUENCY_QA_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:exe,args:['--qa','--play'],env,timeout:45000}),page=await app.firstWindow();
  const client={app,page,profile,index};clients.push(client);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true'&&!document.querySelector('#account-access-label')?.textContent.includes('GELADEN'),null,{timeout:60000});
  return client;
}
async function api(client,route,body){return client.page.evaluate(({route,body})=>platform.onlineRequest(route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body})}),{route,body});}
async function login(client){
  await client.page.bringToFront();await client.page.locator('#account-open').click();
  await client.page.locator('#account-login-tab').click();await client.page.locator('#account-username').fill(credentials[client.index].username);
  await client.page.locator('#account-password').fill(credentials[client.index].password);await client.page.locator('#account-submit').click();
  await client.page.waitForFunction(()=>__DF.state.online===true,null,{timeout:30000});
  await client.page.locator('#account-overlay').waitFor({state:'hidden'});
  client.id=(await api(client,'/api/me')).user.id;
}
async function openFriends(client,tab='friends'){
  await client.page.bringToFront();if(!await client.page.locator('#friends-overlay').isVisible())await client.page.locator('#friends-open').click();
  await client.page.locator(`#friends-tab-${tab}`).click();await client.page.locator('#friends-refresh').click();
}
async function openCoop(client){await client.page.bringToFront();await client.page.locator('#coop-open').click();await client.page.locator('#coop-overlay').waitFor({state:'visible'});}
async function leave(client){
  await client.page.bringToFront();
  if(await client.page.evaluate(()=>!!__DF.coop)){
    if(await client.page.evaluate(()=>__DF.state.phase==='raid'))await client.page.keyboard.press('Escape');
    if(await client.page.evaluate(()=>__DF.state.phase==='hub')){
      if(!await client.page.locator('#coop-overlay').isVisible())await openCoop(client);
      await client.page.locator('#coop-leave').click();
    }else{
      await client.page.locator('#abandon-raid:visible,#result-hub:visible').first().waitFor({state:'visible'});
      if(await client.page.locator('#abandon-raid').isVisible()){await client.page.locator('#abandon-raid').click();await client.page.locator('#abandon-raid').click();}
      else{await client.page.locator('#result-hub').click();if(await client.page.locator('#result-hub').isVisible())await client.page.locator('#result-hub').click();}
    }
    await client.page.waitForFunction(()=>!__DF.coop,null,{timeout:20000});
  }
  await api(client,'/api/rooms/leave',{});
}
async function layoutCheck(client,selector){
  const result=await client.page.locator(selector).evaluate(element=>{
    const box=element.getBoundingClientRect();
    return{visible:box.width>0&&box.height>0,inViewport:box.left>=0&&box.top>=0&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1,horizontalOverflow:element.scrollWidth>element.clientWidth+1};
  });assert.deepEqual(result,{visible:true,inViewport:true,horizontalOverflow:false});
}
try{
  let host=await launch(0);const guest=await launch(1);
  await login(host);await login(guest);pass('Two actual Windows clients authenticate against the public server');
  for(const [client,other] of [[host,guest],[guest,host]])await api(client,'/api/friends/remove',{userId:other.id});
  await openFriends(host);await host.page.locator('#friend-name').fill(credentials[1].username);await host.page.locator('#friend-request').click();
  await openFriends(host,'requests');await host.page.locator(`[data-friend-cancel="${guest.id}"]`).waitFor();
  await openFriends(guest,'requests');await guest.page.locator(`[data-friend-accept="${host.id}"]`).waitFor({timeout:15000});
  await guest.page.locator(`[data-friend-accept="${host.id}"]`).click();
  await openFriends(host);await host.page.locator(`[data-friend-id="${guest.id}"]`).waitFor({timeout:15000});
  assert.equal((await api(host,'/api/social')).friends.some(friend=>friend.id===guest.id),true);
  pass('Real friend request, incoming notification and acceptance persist symmetrically');
  const previous=host,oldId=host.id;await previous.app.close();clients.splice(clients.indexOf(previous),1);
  host=await launch(0,previous.profile);host.id=oldId;
  await host.page.waitForFunction(()=>__DF.state.online===true,null,{timeout:30000});await openFriends(host);
  await host.page.locator(`[data-friend-id="${guest.id}"]`).waitFor({timeout:15000});pass('Friendship and encrypted login survive a full native app restart');
  await host.page.evaluate(()=>__DF.settingsChanged({fullscreen:false}));
  await host.app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setFullScreen(false);window.setSize(1366,768);});
  await host.page.waitForTimeout(800);await layoutCheck(host,'.social-drawer');
  await host.page.screenshot({path:path.join(out,'friends-1366.png')});pass('Compact friends drawer fits a 1366 by 768 native window');
  await host.page.locator(`[data-friend-invite="${guest.id}"]`).click();
  await host.page.waitForFunction(()=>__DF.coop?.info.status==='lobby',null,{timeout:60000});
  const privateRoom=(await api(host,'/api/me')).room;assert.equal(privateRoom.visibility,'friends');
  assert.equal((await api(guest,'/api/rooms')).rooms.some(room=>room.roomId===privateRoom.roomId),false);
  await openFriends(guest,'invitations');await guest.page.locator('[data-invitation-accept]').waitFor({timeout:15000});
  await guest.page.screenshot({path:path.join(out,'friend-invitation.png')});
  await guest.page.locator('[data-invitation-accept]').click();
  for(const client of [host,guest])await client.page.waitForFunction(()=>__DF.coop?.info.players.length===2,null,{timeout:60000});
  assert.equal((await api(guest,'/api/me')).room.roomId,privateRoom.roomId);
  pass('Inviting a friend creates an unlisted friends lobby and joins it entirely inside the game');
  for(const client of [host,guest]){
    if(!await client.page.locator('#coop-overlay').isVisible())await openCoop(client);
    assert.equal(await client.page.locator('#coop-share-invite').isVisible(),false);
    assert.equal(await client.page.locator('#coop-invite').isVisible(),false);
    await client.page.bringToFront();await client.page.locator('#coop-ready').click();
  }
  await host.page.bringToFront();await host.page.locator('#coop-start').click();
  for(const client of [host,guest])await client.page.waitForFunction(()=>['raid','paused'].includes(__DF.state.phase)&&__DF.state.teammates.length===1,null,{timeout:60000});
  assert.equal(await host.page.evaluate(()=>__DF.state.raid.seed),await guest.page.evaluate(()=>__DF.state.raid.seed));
  await host.page.waitForTimeout(5000);await host.page.screenshot({path:path.join(out,'friends-raid.png')});
  pass('Friend team readies and enters the same real dedicated raid without any visible link field');
  await leave(guest);await leave(host);
  await openCoop(host);await host.page.locator('#coop-visibility').selectOption('public');
  await host.page.locator('#coop-create').click();await host.page.waitForFunction(()=>__DF.coop?.info.status==='lobby',null,{timeout:60000});
  const publicRoom=(await api(host,'/api/me')).room;
  await openCoop(guest);
  const joinButton=guest.page.locator(`[data-lobby-join="${publicRoom.roomId}"]`);await joinButton.waitFor({timeout:15000});
  await layoutCheck(guest,'.coop-dialog');await guest.page.screenshot({path:path.join(out,'public-lobbies.png')});
  await guest.page.bringToFront();await joinButton.click();
  for(const client of [host,guest])await client.page.waitForFunction(()=>__DF.coop?.info.players.length===2,null,{timeout:60000});
  assert.equal((await api(guest,'/api/rooms')).rooms.some(room=>room.roomId===publicRoom.roomId),false);
  pass('Public lobby browser lists an open room, joins by button and removes the full room');
  await leave(guest);await leave(host);
  await openFriends(host);await host.page.locator(`[data-friend-remove="${guest.id}"]`).click();await host.page.locator(`[data-friend-remove="${guest.id}"]`).click();
  await host.page.locator(`[data-friend-id="${guest.id}"]`).waitFor({state:'hidden'});
  assert.equal((await api(guest,'/api/social')).friends.some(friend=>friend.id===host.id),false);
  pass('Removing a friend updates both accounts and leaves no active rooms');
  assert.equal((await api(host,'/api/me')).room,null);assert.equal((await api(guest,'/api/me')).room,null);
  assert.deepEqual(errors,[]);pass('No renderer errors across friendship, invitation, raid and public lobby flows');
}catch(error){failure=error.stack;for(const [index,client] of clients.entries())await client.page.screenshot({path:path.join(out,`failure-${index}.png`)}).catch(()=>{});throw error;}
finally{
  for(const client of clients){await api(client,'/api/rooms/leave',{}).catch(()=>{});await client.app.close().catch(()=>{});}
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,version,exe,appAsarSha256,checks,errors,...(failure?{failure}:{})},null,2));
}
