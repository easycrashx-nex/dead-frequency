const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,callback)=>{const handler=(_event,value)=>callback(value);ipcRenderer.on(channel,handler);return()=>ipcRenderer.removeListener(channel,handler);};
contextBridge.exposeInMainWorld('platform',Object.freeze({
  host:options=>ipcRenderer.invoke('coop:host',options),
  prepareInvite:invite=>ipcRenderer.invoke('coop:prepare-invite',invite),
  stopHost:()=>ipcRenderer.invoke('coop:stop'),
  copyInvite:text=>ipcRenderer.invoke('coop:copy',text),
  onStatus:callback=>subscribe('coop:status',callback),
}));
contextBridge.exposeInMainWorld('launcher',Object.freeze({onProgress:callback=>subscribe('launcher:progress',callback)}));
