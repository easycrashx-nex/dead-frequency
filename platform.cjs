const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');

function createPlatform({app,onStatus=()=>{},request=fetch}){
  let server=null,tunnel=null,starting=false,generation=0;
  async function stopHost(){
    generation++;
    const process=tunnel;tunnel=null;if(process&&!process.killed)process.kill();
    const active=server;server=null;if(active)await active.close();
  }
  async function startTunnel(port){
    const vendor=app.isPackaged?path.join(process.resourcesPath,'vendor'):path.join(__dirname,'vendor');
    const manifest=JSON.parse(await fs.readFile(path.join(vendor,'cloudflared.json'),'utf8'));
    const executable=path.join(vendor,'cloudflared.exe');
    const data=await fs.readFile(executable);
    if(data.length!==manifest.size||createHash('sha256').update(data).digest('hex')!==manifest.sha256)throw new Error('Die Internetkomponente ist beschädigt. Bitte das vollständige Spielpaket verwenden.');
    const configDir=path.join(app.getPath('userData'),'tunnel');await fs.mkdir(configDir,{recursive:true});
    const config=path.join(configDir,'empty.yml');await fs.writeFile(config,'{}\n');
    return new Promise((resolve,reject)=>{
      let url=null,settled=false,registered=false,tail='';
      const child=spawn(executable,['tunnel','--config',config,'--no-autoupdate','--url',`http://127.0.0.1:${port}`,'--protocol','http2','--edge-ip-version','4','--metrics','127.0.0.1:0'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      tunnel=child;
      const timer=setTimeout(()=>fail(new Error('Internetverbindung konnte nicht aufgebaut werden. Bitte erneut versuchen oder LAN wählen.')),45000);
      function fail(error){if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(error);}
      function output(chunk){
        tail=(tail+chunk.toString()).slice(-10000);
        url=tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0]||url;
        registered ||= tail.includes('Registered tunnel connection');
        if(url&&registered&&!settled){settled=true;clearTimeout(timer);resolve(url);}
      }
      child.stdout.on('data',output);child.stderr.on('data',output);
      child.on('error',()=>fail(new Error('Die Internetkomponente konnte nicht gestartet werden.')));
      child.on('exit',()=>{if(tunnel===child){tunnel=null;if(settled)onStatus({type:'tunnelLost',message:'Die Internetverbindung des Hosts wurde unterbrochen.'});}fail(new Error('Der Internetdienst ist momentan nicht erreichbar. Erneut versuchen oder LAN wählen.'));});
    });
  }
  async function host({internet=true}={}){
    if(starting||server)throw new Error('Es läuft bereits eine Koop-Sitzung.');
    starting=true;
    const requestGeneration=++generation;
    try{
      const {createCoopServer}=await import(pathToFileURL(path.join(__dirname,'server/coop-server.js')).href);
      const created=await createCoopServer({host:internet?'127.0.0.1':'0.0.0.0',port:0,version:app.getVersion()});
      if(requestGeneration!==generation){await created.close();throw new Error('Verbindung abgebrochen.');}
      server=created;
      const localUrl=`ws://127.0.0.1:${server.port}/coop?token=${server.token}`;
      let invite;
      if(internet){
        onStatus({type:'hosting',message:'Internet-Einladung wird erstellt …'});
        const publicUrl=await startTunnel(server.port),deadline=Date.now()+45000;
        let reachable=false;
        while(server&&tunnel&&Date.now()<deadline){
          try{const response=await request(`${publicUrl}/health`,{signal:AbortSignal.timeout(3000)});if(response.ok&&(await response.json()).game==='DEAD FREQUENCY'){reachable=true;break;}}catch{}
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
        if(!reachable)throw new Error('Die Internet-Einladung ist noch nicht erreichbar. Bitte erneut versuchen oder LAN wählen.');
        invite=`${publicUrl}/coop?token=${server.token}`;
      }
      else{
        const interfaces=Object.values(os.networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal);
        const address=interfaces.find(x=>/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(x.address))?.address||interfaces[0]?.address||'127.0.0.1';
        invite=`ws://${address}:${server.port}/coop?token=${server.token}`;
      }
      return {localUrl,invite,mode:internet?'internet':'lan'};
    }catch(error){await stopHost();throw error;}finally{starting=false;}
  }
  return {host,stopHost,get session(){return server?.session;}};
}
module.exports={createPlatform};
