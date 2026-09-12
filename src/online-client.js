// Account credentials and bearer tokens belong to the native bridge. This
// module only holds the server's public account state for the current session.
export function validateCredentials(username,password){
  if(!/^[A-Za-z0-9_-]{3,24}$/.test(String(username).trim()))return 'Rufname: 3–24 Buchstaben, Zahlen, Unterstrich oder Bindestrich.';
  if(typeof password!=='string'||password.length<10||password.length>128)return 'Passwort: 10–128 Zeichen.';
  return '';
}

export function onlineError(error){
  return String(error?.message||error?.error||'Der Online-Dienst ist gerade nicht erreichbar.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
}

export function createOnlineClient({request,onChange=()=>{},onProfile=()=>{},onSession=()=>{}}){
  const info={available:typeof request==='function',authenticated:false,user:null,busy:false,restoring:false,error:'',room:null,sessionExpired:false};
  let profile=null,revision=0,refreshing=null;
  const change=values=>{Object.assign(info,values);onChange(info);};
  async function call(path,body){
    if(!info.available)throw new Error('Online-Konten sind in der aktuellen Windows-Version verfügbar.');
    try{
      const response=await request(path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body})});
      if(response?.error){const error=new Error(response.error);error.code=response.code;error.status=response.status;throw error;}
      return response;
    }catch(error){
      if(info.authenticated&&!path.includes('/api/auth/')&&(error.status===401||/bitte anmelden|melde dich.*an|sitzung.*abgelaufen/i.test(onlineError(error))))change({sessionExpired:true,room:null});
      throw error;
    }
  }
  function accept(next){
    if(!next||typeof next!=='object'||!Number.isFinite(next.credits)||!Array.isArray(next.stash))throw new Error('Der Server hat kein gültiges Operator-Profil geliefert.');
    profile=structuredClone(next);onProfile(profile);
  }
  async function exclusive(action){
    if(info.busy)return false;
    revision++;change({busy:true,error:''});
    try{return await action();}
    catch(error){change({error:onlineError(error)});throw error;}
    finally{change({busy:false});}
  }
  async function signIn(path,body){
    const response=await call(path,body);
    if(!response?.user?.id||!response.user.username)throw new Error('Das Konto konnte nicht geladen werden.');
    const changed=!info.authenticated||info.user?.id!==response.user.id;
    accept(response.profile);
    change({authenticated:true,user:response.user,room:response.room||null,error:'',sessionExpired:false});
    if(changed)onSession(true);
    return true;
  }
  return {
    info,get profile(){return profile;},accept,
    async restore(){
      if(!info.available)return false;
      change({restoring:true});
      try{return await exclusive(()=>signIn('/api/me'));}
      catch(error){
        // A fresh installation has no session; this is an ordinary offline start.
        if(error.status===401||/auth_required|unauthorized|session_expired|not_authenticated/i.test(error.code||'')||/nicht angemeldet|anmelden|melde dich.*an|sitzung.*abgelaufen|keine.*sitzung/i.test(onlineError(error)))change({error:''});
        return false;
      }finally{change({restoring:false});}
    },
    authenticate(kind,username,password){
      const invalid=validateCredentials(username,password);if(invalid)return Promise.reject(new Error(invalid));
      return exclusive(()=>signIn(`/api/auth/${kind==='register'?'register':'login'}`,{username:String(username).trim(),password}));
    },
    logout(){return exclusive(async()=>{await call('/api/auth/logout',{});profile=null;change({authenticated:false,user:null,room:null,error:'',sessionExpired:false});onSession(false);return true;});},
    async refresh(){
      if(!info.authenticated||info.busy)return false;
      if(refreshing)return refreshing;
      const started=revision;
      refreshing=(async()=>{try{const data=await call('/api/me');if(started!==revision||!info.authenticated)return false;accept(data.profile);change({room:data.room||null,error:''});return true;}catch(error){if(started===revision)change({error:onlineError(error)});return false;}finally{refreshing=null;}})();
      return refreshing;
    },
    action(kind,action,args=[]){return exclusive(async()=>{const data=await call('/api/action',{kind,action,args});accept(data.profile);return data.result===true;});},
    room(mode,options){return exclusive(async()=>{const data=await call(mode==='join'?'/api/rooms/join':'/api/rooms/create',mode==='join'?{invite:options.invite,loadout:options.loadout}:{mode,loadout:options.loadout,difficulty:options.difficulty});change({room:{roomId:data.roomId,mode}});return data;});},
    leaveRoom(){return exclusive(async()=>{await call('/api/rooms/leave',{});change({room:null});const data=await call('/api/me');accept(data.profile);return true;});},
  };
}

// A presentation-only hub: it deliberately has no local market, raid simulation
// or progression mutation methods. Its profile can only come from the server.
export function createOnlineHub(localGame,profile){
  const state=structuredClone(localGame.state);state.phase='hub';state.multiplayer=false;state.online=true;state.profile=structuredClone(profile);state.teammates=[];state.prompt=null;state.activeContainerId=null;state.result=null;
  return {state,layout:localGame.layout,update(){},fire(){return false;},drainEvents(){return [];},closeContainer(){},pause(){},returnToHub(){state.phase='hub';state.multiplayer=false;state.activeContainerId=null;state.prompt=null;}};
}
