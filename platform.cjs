const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {Resolver}=require('node:dns/promises');

function createPlatform({app,onStatus=()=>{},request=fetch,refreshDns=async()=>{},waitForDns}){
  let server=null,tunnel=null,starting=false,generation=0;
  const resolvers=new Set();
  async function waitForDnsPublication(hostname,isCurrent,deadline){
    const owned=[];
    function resolver(servers){const value=new Resolver({timeout:1500,tries:1});value.setServers(servers);owned.push(value);resolvers.add(value);return value;}
    try{
      // Ask the zone's current authoritative servers directly. A quick tunnel can
      // register before its DNS record exists; recursive resolvers cache that first
      // NXDOMAIN for 30 minutes. Never ask Chromium for the new name before publication.
      const bootstrap=resolver(['1.1.1.1','8.8.8.8']);
      const names=await bootstrap.resolveNs('trycloudflare.com');
      if(!names.length)throw new Error('Nameserver des Internetdiensts sind nicht erreichbar.');
      const authorities=await Promise.all(names.map(async name=>resolver([(await bootstrap.resolve4(name))[0]])));
      while(isCurrent()&&Date.now()<deadline){
        const results=await Promise.allSettled(authorities.map(value=>value.resolve4(hostname)));
        if(results.every(result=>result.status==='fulfilled'&&result.value.length))return;
        if(isCurrent())await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error(isCurrent()?'Der Internetdienst hat die Einladung noch nicht veröffentlicht. Bitte erneut versuchen oder LAN wählen.':'Verbindung abgebrochen.');
    }catch(error){if(!isCurrent())throw new Error('Verbindung abgebrochen.');throw error;}
    finally{for(const value of owned){value.cancel();resolvers.delete(value);}}
  }
  async function checkHealth(publicUrl){
    const controller=new AbortController();let timer;
    try{
      return await Promise.race([
        (async()=>{
          const response=await request(`${publicUrl}/health`,{signal:controller.signal,cache:'no-store'});
          if(!response.ok)return false;
          const health=await response.json();
          return health.game==='DEAD FREQUENCY'&&health.protocol===1;
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Zeitüberschreitung bei der Einladungsprüfung.'));},3000);}),
      ]);
    }finally{clearTimeout(timer);}
  }
  async function waitUntilReachable(publicUrl,isCurrent=()=>true){
    const deadline=Date.now()+45000;
    let dnsFailure=false;
    await (waitForDns||waitForDnsPublication)(new URL(publicUrl).hostname,isCurrent,deadline);
    while(isCurrent()&&Date.now()<deadline){
      try{
        if(await checkHealth(publicUrl)&&isCurrent())return;
      }catch(error){
        // A new quick-tunnel hostname can briefly return NXDOMAIN. Chromium caches
        // that negative answer for much longer than our startup deadline; retrying
        // fetch alone therefore never performs another DNS lookup.
        if(/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/.test(`${error.message} ${error.cause?.code||''}`)){
          dnsFailure=true;await refreshDns();
        }
      }
      if(!isCurrent())break;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(!isCurrent())throw new Error('Verbindung abgebrochen.');
    throw new Error(dnsFailure?'Der Einladungsname ist über DNS noch nicht erreichbar. Bitte erneut versuchen oder LAN wählen.':'Die Internet-Einladung ist noch nicht erreichbar. Bitte erneut versuchen oder LAN wählen.');
  }
  async function prepareInvite(invite){
    if(typeof invite!=='string'||invite.length>2048)throw new Error('Ungültige Koop-Einladung.');
    let url;try{url=new URL(invite.trim());}catch{throw new Error('Ungültige Koop-Einladung.');}
    if(url.username||url.password||url.pathname!=='/coop'||url.searchParams.getAll('token').length!==1||! /^[a-f0-9]{64}$/i.test(url.searchParams.get('token')||'')||[...url.searchParams.keys()].some(key=>key!=='token'))throw new Error('Ungültige Koop-Einladung.');
    const octets=url.hostname.split('.').map(Number);
    const privateIp=octets.length===4&&octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(octets[0]===10||octets[0]===127||(octets[0]===192&&octets[1]===168)||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===100&&octets[1]>=64&&octets[1]<=127));
    // LAN/VPN invitations do not make HTTP requests or change the DNS cache.
    if(url.protocol==='ws:'&&(url.hostname==='localhost'||privateIp))return;
    if(!['https:','wss:'].includes(url.protocol)||url.port||!/^[-a-z0-9]+\.trycloudflare\.com$/.test(url.hostname))throw new Error('Internet-Einladungen müssen vom Koop-Host des Spiels stammen.');
    const requestGeneration=generation;
    onStatus({type:'hosting',message:'Internet-Einladung wird geprüft …'});
    await waitUntilReachable(`https://${url.hostname}`,()=>requestGeneration===generation);
  }
  async function stopHost(){
    generation++;
    for(const resolver of resolvers)resolver.cancel();
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
        const publicUrl=await startTunnel(server.port);
        await waitUntilReachable(publicUrl,()=>requestGeneration===generation&&!!server&&!!tunnel);
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
  return {host,stopHost,prepareInvite,get session(){return server?.session;}};
}
module.exports={createPlatform};
