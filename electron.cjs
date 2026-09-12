const { app, BrowserWindow, Menu, session, ipcMain, clipboard, net } = require('electron');
const path = require('node:path');
const {fileURLToPath}=require('node:url');
const {createPlatform}=require('./platform.cjs');
const qa = process.argv.includes('--qa');
if (qa && process.env.DEAD_FREQUENCY_QA_PROFILE) app.setPath('userData', path.resolve(process.env.DEAD_FREQUENCY_QA_PROFILE));
app.setName('DEAD FREQUENCY');
if (!app.requestSingleInstanceLock()) app.quit();
let win,platform,updateAbort;
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
  win=new BrowserWindow({width:launcherMode?1040:1440,height:launcherMode?650:900,minWidth:960,minHeight:600,backgroundColor:'#10191b',title:'DEAD FREQUENCY',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,devTools:qa}});
  platform=createPlatform({app,request:net.fetch,refreshDns:()=>session.defaultSession.clearHostResolverCache(),onStatus:value=>{if(!win.isDestroyed())win.webContents.send('coop:status',value);}});
  if(qa)global.__DF_HOST=()=>platform.session;
  ipcMain.handle('coop:host',(event,options)=>{if(!trusted(event))throw new Error('Unzulässiger Aufruf');return platform.host({internet:options?.internet!==false});});
  ipcMain.handle('coop:stop',event=>{if(!trusted(event))throw new Error('Unzulässiger Aufruf');return platform.stopHost();});
  ipcMain.handle('coop:prepare-invite',(event,invite)=>{if(!trusted(event)||typeof invite!=='string'||invite.length>2048)throw new Error('Ungültige Einladung');return platform.prepareInvite(invite);});
  ipcMain.handle('coop:copy',(event,text)=>{if(!trusted(event)||typeof text!=='string'||text.length>2048)throw new Error('Ungültige Einladung');clipboard.writeText(text);return true;});
  ipcMain.handle('display:fullscreen',(event,value)=>{if(!trusted(event)||typeof value!=='boolean')throw new Error('Ungültige Anzeigeoption');win.setFullScreen(value);return true;});
  win.on('enter-full-screen',()=>win.webContents.send('display:fullscreen',true));
  win.on('leave-full-screen',()=>win.webContents.send('display:fullscreen',false));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown'&&input.key==='F11'){event.preventDefault();win.setFullScreen(!win.isFullScreen());}
  });
  win.once('ready-to-show',()=>win.show());
  const launchGame=()=>{win.setSize(1440,900);win.center();return win.loadFile(path.join(__dirname,'dist','index.html'),{query:qa?{qa:'1'}:{}});};
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
app.on('before-quit',()=>{updateAbort?.abort();platform?.stopHost();});
app.on('window-all-closed',()=>app.quit());
