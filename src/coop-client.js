import packageInfo from '../package.json' with {type:'json'};
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

export function parseInvite(value){
  const url=new URL(String(value).trim());
  if(url.protocol==='https:')url.protocol='wss:';
  if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/coop'||!/^([a-f0-9]{64})$/.test(url.searchParams.get('token')||''))throw new Error('Bitte den vollständigen Einladungslink deines Kollegen einfügen.');
  if(url.protocol==='ws:'&&!/^(localhost|127\.0\.0\.1|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.[\d.]+)$/.test(url.hostname))throw new Error('Internet-Einladungen benötigen eine verschlüsselte Verbindung.');
  url.hash='';return url.href;
}

export function createCoopClient({localGame,onChange=()=>{},onRaid=()=>{},onProfile=()=>{},onDisconnect=()=>{}}){
  let socket=null,events=[],sequence=0,lastSnapshot=-1,sendTime=0,paused=false,target=null,closed=false,lastMessage=0,watchdog,pendingJump=false;
  let state=structuredClone(localGame.state);
  let closingContainerId=null;
  const info={status:'offline',name:'',invite:'',players:[],id:null,hostId:null,message:'',ping:0};
  function change(values){Object.assign(info,values);onChange(info);}
  function send(message){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(message));return true;}return false;}
  function disconnect(message='Verbindung beendet.'){
    if(closed)return;closed=true;clearInterval(watchdog);socket?.close();
    const wasRaid=['raid','paused'].includes(state.phase);
    if(wasRaid){state.phase='dead';state.result={success:false,value:state.raid.value,kills:state.raid.kills,reason:message,bonus:0,total:0,itemCount:state.raid.loot.length};state.prompt=null;events.push({type:'death',...state.result});}
    change({status:'error',message,players:[]});onDisconnect({message,wasRaid});
  }
  function receive(data){
    let message;try{message=JSON.parse(data);}catch{return;}
    lastMessage=performance.now();
    if(message.type==='welcome'){change({id:message.id,hostId:message.hostId,status:'lobby',message:''});}
    else if(message.type==='lobby'){change({players:message.players,hostId:message.hostId,status:state.phase==='hub'?'lobby':info.status});}
    else if(message.type==='error'){change({message:message.message,...(!info.id?{status:'error'}:{})});events.push({type:'notice',text:message.message});}
    else if(message.type==='closed'){disconnect(message.message||'Der Host hat die Sitzung beendet.');}
    else if(message.type==='snapshot'){
      if(!message.state||message.seq<=lastSnapshot)return;lastSnapshot=message.seq;
      const incoming=message.state,oldPhase=state.phase,oldPlayer=state.player;
      if(closingContainerId){
        if(incoming.activeContainerId===closingContainerId){incoming.activeContainerId=null;incoming.containerSearchRemaining=0;}
        else closingContainerId=null;
      }
      target={x:incoming.player.x,y:incoming.player.y,z:incoming.player.z};
      if(['raid','paused'].includes(oldPhase)&&incoming.phase==='raid')Object.assign(incoming.player,{x:oldPlayer.x,y:oldPlayer.y,z:oldPlayer.z,yaw:oldPlayer.yaw,pitch:oldPlayer.pitch});
      state=incoming;state.multiplayer=true;
      if(paused&&state.phase==='raid')state.phase='paused';
      if(!['raid','paused'].includes(oldPhase)&&state.phase==='raid'){paused=false;change({status:'raid',message:''});onRaid(state);}
      if(Array.isArray(message.events))events.push(...message.events);
      localGame.state.profile=structuredClone(state.profile);
      if(oldPhase!==state.phase)onProfile();
      if(!['raid','paused','hub'].includes(state.phase))change({status:'raid'});
    }
    else if(message.type==='pong'&&Number.isFinite(message.time))info.ping=Math.round(performance.now()-message.time);
  }
  async function connect(invite,{name,profile,kit='scout',invitation=invite,difficulty='normal'}={}){
    const url=parseInvite(invite);closed=false;state=structuredClone(localGame.state);state.multiplayer=true;
    state.teammates=[];lastSnapshot=-1;events=[];paused=false;sequence=0;
    change({status:'connecting',name:String(name||'Operator').trim().slice(0,20),invite:invitation,players:[],message:'Verbindung wird aufgebaut …',difficulty});
    await new Promise((resolve,reject)=>{
      socket=new WebSocket(url);let welcomed=false;
      const timer=setTimeout(()=>{reject(new Error('Keine Antwort vom Host. Prüfe, ob die Einladung noch aktiv ist.'));socket.close();},20000);
      socket.addEventListener('open',()=>send({type:'join',protocol:1,version:packageInfo.version,name:info.name,profile,kit}));
      socket.addEventListener('message',event=>{
        receive(event.data);
        if(info.id&&!welcomed){welcomed=true;clearTimeout(timer);resolve();}
        if(!welcomed&&info.message&&info.status==='error'){clearTimeout(timer);reject(new Error(info.message));}
      });
      socket.addEventListener('error',()=>{if(!welcomed){clearTimeout(timer);reject(new Error('Host nicht erreichbar. Prüfe Einladung und Internetverbindung.'));}});
      socket.addEventListener('close',event=>{clearTimeout(timer);const message=event.reason||'Die Verbindung zum Host wurde getrennt.';if(!welcomed)reject(new Error(message));disconnect(message);});
    });
    lastMessage=performance.now();let pingTicks=0;
    watchdog=setInterval(()=>{if(performance.now()-lastMessage>12000){disconnect('Der Host antwortet nicht mehr.');return;}if(++pingTicks%2===0)send({type:'ping',time:performance.now()});},1000);
    return adapter;
  }
  const adapter={
    get state(){return state;},layout:localGame.layout,info,connect,
    update(dt,input={}){
      if(closed)return;
      pendingJump ||= !!input.jump;
      if(target&&['raid','paused'].includes(state.phase)){
        const factor=1-Math.exp(-25*dt);
        for(const axis of ['x','y','z'])state.player[axis]+= (target[axis]-state.player[axis])*factor;
        if(Number.isFinite(input.yaw))state.player.yaw=input.yaw;
        if(Number.isFinite(input.pitch))state.player.pitch=clamp(input.pitch,-1.5,1.5);
      }
      sendTime+=dt;
      if(sendTime>=1/30&&['raid','paused'].includes(state.phase)){
        sendTime=0;send({type:'input',seq:++sequence,input:paused?{yaw:state.player.yaw,pitch:state.player.pitch}:{...input,jump:pendingJump}});pendingJump=false;
      }
    },
    fire(){return false;},
    reload(){return send({type:'action',action:'reload'});},heal(){return send({type:'action',action:'heal'});},
    interact(){closingContainerId=null;return send({type:'action',action:'interact'});},dropItem(id){return send({type:'action',action:'drop',id});},
    takeContainerItem(containerId,id){return send({type:'action',action:'take',id,containerId});},
    takeAllContainerItems(containerId){return send({type:'action',action:'takeAll',containerId});},
    closeContainer(){if(!state.activeContainerId)return false;closingContainerId=state.activeContainerId;state.activeContainerId=null;state.containerSearchRemaining=0;return send({type:'action',action:'closeContainer'});},
    pause(value=true){paused=value;if(value&&state.phase==='raid')state.phase='paused';else if(!value&&state.phase==='paused')state.phase='raid';send({type:'input',seq:++sequence,input:{yaw:state.player.yaw,pitch:state.player.pitch}});},
    ready(ready){send({type:'ready',ready:!!ready});},start(){send({type:'start',difficulty:info.difficulty||'normal'});},
    leave(){closed=true;clearInterval(watchdog);send({type:'leave'});socket?.close();change({status:'offline',players:[],message:'',id:null,hostId:null});},
    drainEvents(){const list=events;events=[];return list;},getSave(){return localGame.getSave();},
    dispose(){this.leave();},returnToHub(){this.leave();},buyUpgrade(){return false;},startRaid(){return false;},
  };
  return adapter;
}
