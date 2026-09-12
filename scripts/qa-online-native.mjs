import {_electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {getCatalogItem} from '../src/loadouts.js';

const version=JSON.parse(await fs.readFile('package.json','utf8')).version;
const exe=path.resolve(`../../outputs/v${version}/DEAD FREQUENCY-win32-x64/DEAD FREQUENCY.exe`);
const out=path.resolve(`../qa-online-native-${version}`);await fs.mkdir(out,{recursive:true});
const privateFile=path.join(out,'accounts.private.json');
let credentials;try{credentials=JSON.parse(await fs.readFile(privateFile,'utf8'));}catch{
  credentials=[0,1].map(()=>({username:`qat_${randomBytes(5).toString('hex')}`,password:randomBytes(24).toString('base64url'),created:false}));
  await fs.writeFile(privateFile,JSON.stringify(credentials),{mode:0o600});
}
const clients=[],checks=[],errors=[],measurements={};
const pass=name=>{checks.push(name);console.log('PASS',name);};
const SAVE_KEY='dead-frequency.profile.v2';
async function launch(index,profile){
  profile??=await fs.mkdtemp(path.join(out,`profile-${index}-`));
  const env={...process.env,DEAD_FREQUENCY_QA_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:exe,args:['--qa','--play'],env,timeout:45000});
  const page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.waitForFunction(()=>window.__DF&&document.documentElement.dataset.ready==='true'&&document.querySelector('#account-access-label')?.textContent!=='KONTO WIRD GELADEN …',null,{timeout:60000});
  const client={app,page,profile,index};clients.push(client);return client;
}
async function account(client){
  const {page,index}=client,credential=credentials[index];await page.bringToFront();
  await page.locator('#account-open').click();
  await page.locator(credential.created?'#account-login-tab':'#account-register-tab').click();
  await page.locator('#account-username').fill(credential.username);await page.locator('#account-password').fill(credential.password);
  if(!credential.created)await page.locator('#account-confirm').fill(credential.password);
  await page.locator('#account-submit').click();
  try{await page.waitForFunction(()=>__DF.state.online===true,null,{timeout:30000});}
  catch{throw new Error(`Account action failed: ${await page.locator('#account-message').innerText()}`);}
  credential.created=true;await fs.writeFile(privateFile,JSON.stringify(credentials),{mode:0o600});
  if(await page.locator('#account-close').isVisible())await page.locator('#account-close').click();
}
async function api(client,route,body){return client.page.evaluate(({route,body})=>platform.onlineRequest(route,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body})}),{route,body});}
async function leave(client){
  await client.page.bringToFront();
  // The account dialog can recover a lobby after a connection/reload as well.
  if(await client.page.evaluate(()=>!!__DF.coop)){
    if(await client.page.evaluate(()=>__DF.state.phase==='raid'))await client.page.keyboard.press('Escape');
    await client.page.locator('#abandon-raid:visible, #result-hub:visible').first().waitFor({state:'visible',timeout:10000});
    const abandon=client.page.locator('#abandon-raid'),hub=client.page.locator('#result-hub');
    if(await abandon.isVisible()){await abandon.click();await abandon.click();}
    else if(await hub.isVisible()){await hub.click();if(await hub.isVisible())await hub.click();}
    else throw new Error('No visible raid exit control');
    await client.page.waitForFunction(()=>!__DF.coop,null,{timeout:20000});
  }
  await api(client,'/api/rooms/leave',{});
  await client.page.reload();await client.page.waitForFunction(()=>window.__DF?.state.online&&window.__DF.state.phase==='hub',null,{timeout:60000});
}
try{
  let host=await launch(0);
  await host.page.evaluate(key=>{__DF.game.state.profile.credits=4321;__DF.persist();},SAVE_KEY);
  const offline=await host.page.evaluate(()=>structuredClone(__DF.state.profile));
  pass('Packaged Windows app boots with independent offline profile');
  await account(host);assert.notEqual((await api(host,'/api/me')).profile.credits,4321);
  pass('Actual account form registers/logs in through trusted public IP HTTPS');
  const security=await host.app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
  assert.deepEqual(security,{sandbox:true,contextIsolation:true,nodeIntegration:false});measurements.security=security;
  assert.equal((await api(host,'/api/me')).token,undefined);pass('Sandbox remains enabled and bearer session is hidden from renderer');
  const before=(await api(host,'/api/me')).profile,itemId='muzzle-short';
  await host.page.locator('#tab-arsenal').click();await host.page.locator('.armory-tabs [data-armory-tab="shop"]').click();
  await host.page.locator('#shop-kind').selectOption('attachment');await host.page.locator('#shop-category').selectOption('all');
  await host.page.locator('#shop-search').fill(getCatalogItem(itemId).name);await host.page.locator(`[data-shop-item="${itemId}"]`).click();
  await host.page.locator('#purchase-equipment').click();await host.page.waitForFunction(credits=>__DF.state.profile.credits===credits,before.credits-getCatalogItem(itemId).purchaseCost);
  const purchased=(await api(host,'/api/me')).profile;assert.equal(purchased.stash.length,before.stash.length+1);
  pass('Actual shop purchase charges canonical server price and stores owned attachment');
  const encrypted=await fs.readFile(path.join(host.profile,'online-session.enc'));assert.ok(encrypted.length>32);assert.ok(!encrypted.includes(Buffer.from(credentials[0].password)));
  await host.app.close();clients.splice(clients.indexOf(host),1);host=await launch(0,host.profile);
  await host.page.waitForFunction(()=>__DF.state.online===true,null,{timeout:30000});
  assert.equal(await host.page.evaluate(()=>__DF.state.online),true);assert.equal((await api(host,'/api/me')).profile.credits,purchased.credits);
  pass('Native app restart restores OS-encrypted login and server inventory without password entry');
  await host.page.locator('#tab-deploy').click();await host.page.locator('#start-raid').click();
  await host.page.waitForFunction(()=>__DF.coop?.info.online&&['raid','paused'].includes(__DF.state.phase),null,{timeout:60000});
  assert.equal(await host.page.evaluate(()=>__DF.state.teammates.length),0);
  const soloSeed=await host.page.evaluate(()=>__DF.state.raid.seed);assert.ok(Number.isInteger(soloSeed));
  pass('Solo start creates a real dedicated server raid with authoritative snapshots');
  await host.page.bringToFront();if(await host.page.evaluate(()=>__DF.state.phase==='paused'))await host.page.locator('[data-action="resume"]').click();
  const ammo=await host.page.evaluate(()=>__DF.state.player.ammo);await host.page.mouse.down();await host.page.waitForTimeout(260);await host.page.mouse.up();
  await host.page.waitForFunction(previous=>__DF.state.player.ammo<previous,ammo);
  pass('Real native fire input is accepted by remote authoritative simulation');
  await leave(host);const postSolo=(await api(host,'/api/me')).profile;
  assert.equal((await api(host,'/api/me')).room,null);pass('Leaving online solo settles loss and releases account lock');
  const guest=await launch(1);await account(guest);
  for(const client of [host,guest]){await client.page.bringToFront();await client.page.locator('#coop-open').click();}
  await host.page.bringToFront();await host.page.locator('#coop-connect').click();
  await host.page.waitForFunction(()=>__DF.coop?.info.status==='lobby',null,{timeout:60000});
  await host.page.locator('#coop-share-invite').waitFor({state:'visible'});
  const invite=await host.page.locator('#coop-share-invite').inputValue();assert.match(invite,/^wss:\/\/91\.98\.64\.49\/coop\?token=[a-f0-9]{64}$/);
  await guest.page.bringToFront();await guest.page.locator('#coop-mode-join').click();await guest.page.locator('#coop-invite').fill(invite);await guest.page.locator('#coop-connect').click();
  for(const client of [host,guest])await client.page.waitForFunction(()=>__DF.coop?.info.players.length===2,null,{timeout:60000});
  pass('Two packaged Windows clients join one server-hosted account-bound Internet lobby');
  for(const client of [host,guest]){await client.page.bringToFront();await client.page.locator('#coop-ready').click();}
  await host.page.bringToFront();await host.page.locator('#coop-start').click();
  for(const client of [host,guest])await client.page.waitForFunction(()=>['raid','paused'].includes(__DF.state.phase)&&__DF.state.teammates.length===1,null,{timeout:60000});
  assert.equal(await host.page.evaluate(()=>__DF.state.raid.seed),await guest.page.evaluate(()=>__DF.state.raid.seed));
  assert.equal(await host.page.evaluate(()=>__DF.state.teammates[0].name),credentials[1].username);
  pass('Both authenticated operators enter the same seeded server raid');
  await host.page.waitForTimeout(15000);measurements.server=await(await fetch('https://91.98.64.49/health')).json();
  assert.equal(measurements.server.version,version);assert.ok(measurements.server.simulation.simulations.some(s=>s.phase==='raid'));
  await host.page.screenshot({path:path.join(out,'online-coop.png')});
  pass('Live public server reports raid tick timing under real two-client load');
  for(const client of [guest,host])await leave(client);
  const finalProfile=(await api(host,'/api/me')).profile;assert.ok(finalProfile.raids>=postSolo.raids);
  await host.page.locator('#account-open').click();await host.page.locator('#account-logout').click();
  await host.page.waitForFunction(()=>!__DF.state.online);
  const restored=await host.page.evaluate(()=>__DF.state.profile);
  for(const field of ['credits','stash','intake','mailbox','progression','upgrades'])assert.deepEqual(restored[field],offline[field]);
  assert.equal(await fs.stat(path.join(host.profile,'online-session.enc')).then(()=>true,()=>false),false);
  pass('Logout deletes local session and returns to untouched offline possessions and progression');
  await host.page.screenshot({path:path.join(out,'offline-after-logout.png')});
  assert.deepEqual(errors,[]);pass('No renderer errors during account, inventory, restart, solo and coop flow');
}catch(error){
  for(const [i,client] of clients.entries())await client.page.screenshot({path:path.join(out,`failure-${i}.png`)}).catch(()=>{});
  measurements.failure=error.stack;throw error;
}finally{
  for(const client of clients){await api(client,'/api/rooms/leave',{}).catch(()=>{});await client.app.close().catch(()=>{});}
  const appAsarSha256=createHash('sha256').update(await fs.readFile(path.join(path.dirname(exe),'resources/app.asar'))).digest('hex');
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({native:true,exe,version,appAsarSha256,checks,errors,...measurements},null,2));
}
