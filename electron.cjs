const { app, BrowserWindow, Menu, session, ipcMain, clipboard, net, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {fileURLToPath}=require('node:url');
const {createPlatform}=require('./platform.cjs');
const {createOnlinePlatform}=require('./online-platform.cjs');
const {createAdminPlatform}=require('./admin-platform.cjs');
const qa = process.argv.includes('--qa');
if (qa && process.env.DEAD_FREQUENCY_QA_PROFILE) app.setPath('userData', path.resolve(process.env.DEAD_FREQUENCY_QA_PROFILE));
app.setName('DEAD FREQUENCY');
if (!app.requestSingleInstanceLock()) app.quit();
let win,platform,updateAbort,quitting=false;
function trusted(event){
  try{return event.sender===win?.webContents&&path.resolve(fileURLToPath(event.senderFrame.url)).startsWith(path.resolve(__dirname)+path.sep);}catch{return false;}
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.whenReady().then(async()=>{
  app.configureHostResolver({secureDnsMode:'secure',secureDnsServers:['https://dns.google/dns-query']});
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='pointerLock'||permission==='fullscreen'));
  session.defaultSession.setPermissionCheckHandler((_wc,permission)=>permission==='pointerLock'||permission==='fullscreen');
  const launcherMode=!process.argv.includes('--play')&&(!qa||process.argv.includes('--qa-launcher'));
  function createWindow(bounds){
    const window=new BrowserWindow({...bounds,minWidth:960,minHeight:600,backgroundColor:'#10191b',title:'DEAD FREQUENCY',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,devTools:qa}});
    window.on('enter-full-screen',()=>window.webContents.send('display:fullscreen',true));
    window.on('leave-full-screen',()=>window.webContents.send('display:fullscreen',false));
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>{
      // Only the same local document may reload, never arbitrary navigation.
      try{if(path.resolve(fileURLToPath(event.url))===path.resolve(fileURLToPath(window.webContents.getURL())))return;}catch{}
      event.preventDefault();
    });
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
    window.webContents.on('before-input-event',(event,input)=>{
      if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();window.setFullScreen(!window.isFullScreen());}
    });
    window.once('ready-to-show',()=>{if(!window.isDestroyed())window.show();});
    window.webContents.on('render-process-gone',(_event,details)=>{
      if(quitting||window.isDestroyed()||window!==win)return;
      updateAbort?.abort();platform?.stopHost();
      try{
        const log=path.join(app.getPath('userData'),'graphics-errors.log');
        if(fs.existsSync(log)&&fs.statSync(log).size>65536)fs.writeFileSync(log,'');
        fs.appendFileSync(log,JSON.stringify({time:new Date().toISOString(),version:app.getVersion(),reason:details.reason,exitCode:details.exitCode})+'\n');
      }catch{}
      // A full native crash can invalidate Electron's sandbox bootstrap state.
      // Recreate the window before destroying the old one to keep the app alive.
      win=createWindow(window.getBounds());window.destroy();
      win.loadFile(path.join(__dirname,'launcher','recovery.html')).catch(()=>{});
    });
    return window;
  }
  win=createWindow({width:launcherMode?1040:1440,height:launcherMode?650:900});
  platform=createPlatform({app,request:net.fetch,refreshDns:()=>session.defaultSession.clearHostResolverCache(),onStatus:value=>{if(!win.isDestroyed())win.webContents.send('coop:status',value);}});
  const online=createOnlinePlatform({userData:app.getPath('userData'),safeStorage,request:net.fetch});
  const admin=createAdminPlatform({request:net.fetch});
  ipcMain.handle('admin:request',async(event,route,options)=>{
    if(!trusted(event)||path.resolve(fileURLToPath(event.senderFrame.url))!==path.resolve(__dirname,'dist','index.html'))throw new Error('Unzulässiger Aufruf');
    try{return await admin.adminRequest(route,options);}catch(error){return {adminError:{message:error.message,status:error.status}};}
  });
  ipcMain.handle('online:request',(event,route,options)=>{
    if(!trusted(event)||path.resolve(fileURLToPath(event.senderFrame.url))!==path.resolve(__dirname,'dist','index.html'))throw new Error('Unzulässiger Aufruf');
    return online.onlineRequest(route,options);
  });
  if(qa)global.__DF_HOST=()=>platform.session;
  ipcMain.handle('coop:host',(event,options)=>{if(!trusted(event))throw new Error('Unzulässiger Aufruf');return platform.host({internet:options?.internet!==false});});
  ipcMain.handle('coop:stop',event=>{if(!trusted(event))throw new Error('Unzulässiger Aufruf');return platform.stopHost();});
  ipcMain.handle('coop:prepare-invite',(event,invite)=>{if(!trusted(event)||typeof invite!=='string'||invite.length>2048)throw new Error('Ungültige Einladung');return platform.prepareInvite(invite);});
  ipcMain.handle('coop:copy',(event,text)=>{if(!trusted(event)||typeof text!=='string'||text.length>2048)throw new Error('Ungültige Einladung');clipboard.writeText(text);return true;});
  ipcMain.handle('input:paste',event=>{if(!trusted(event))throw new Error('Unzulässiger Aufruf');return clipboard.readText().slice(0,2048);});
  ipcMain.handle('display:fullscreen',(event,value)=>{if(!trusted(event)||typeof value!=='boolean')throw new Error('Ungültige Anzeigeoption');win.setFullScreen(value);return true;});
  const launchGame=(graphicsRecovery=false)=>{win.setSize(1440,900);win.center();return win.loadFile(path.join(__dirname,'dist','index.html'),{query:{...(qa?{qa:'1'}:{}),...(graphicsRecovery?{graphicsRecovery:'1'}:{})}});};
  ipcMain.handle('display:recover',event=>{if(!trusted(event)||!event.senderFrame.url.includes('/launcher/recovery.html'))throw new Error('Unzulässiger Aufruf');return launchGame(true);});
  if(!launcherMode){await launchGame();return;}
  await win.loadFile(path.join(__dirname,'launcher','index.html'));
  updateAbort=new AbortController();
  const {runUpdater}=require('./launcher/updater.cjs');
  try{
    const result=await runUpdater({currentVersion:app.getVersion(),bundledExe:process.execPath,installRoot:path.join(app.getPath('userData'),'updates'),repository:'easycrashx-nex/dead-frequency',signal:updateAbort.signal,onProgress:value=>{if(!win.isDestroyed())win.webContents.send('launcher:progress',value);}});
    if(updateAbort.signal.aborted||win.isDestroyed())return;
    if(path.resolve(result.exe)===path.resolve(process.execPath)){await launchGame();}
    else{app.relaunch({execPath:result.exe,args:qa?['--play','--qa','--remote-debugging-port=0']:['--play']});app.exit(0);}
  }catch(error){
    if(error.name!=='AbortError'&&!win.isDestroyed()){win.webContents.send('launcher:progress',{phase:'fallback',message:'Updateprüfung nicht möglich. Die installierte Version startet.'});await launchGame();}
  }
});
app.on('before-quit',()=>{quitting=true;updateAbort?.abort();platform?.stopHost();});
app.on('window-all-closed',()=>app.quit());
