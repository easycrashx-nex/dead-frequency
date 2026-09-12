export function createAdminClient({request,onAction=()=>{},clock=Date.now}={}) {
  const info={available:typeof request==='function',authenticated:false,admin:null,expiresAt:0,busy:false,loading:false,error:'',overview:null,player:null,catalog:[]};
  let revision=0,lastPoll=0;
  function clear(){Object.assign(info,{authenticated:false,admin:null,expiresAt:0,overview:null,player:null,catalog:[]});}
  function errorMessage(error){return String(error?.message||'Admin-Aktion fehlgeschlagen.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');}
  async function call(route,body){
    if(!info.available)throw new Error('Die Admin-Konsole ist in der Windows-App verfügbar.');
    const current=revision;
    try{const result=await request(`/api/admin/${route}`,body===undefined?{}:{body});
      if(result?.adminError)throw Object.assign(new Error(result.adminError.message),{status:result.adminError.status});return result;}
    catch(error){if(current===revision&&(error.status===401||/als Admin anmelden|Sitzung.*abgelaufen|Anmeldung erforderlich/i.test(error.message))){++revision;clear();}throw error;}
  }
  async function refresh(){
    if(!info.authenticated||info.loading||info.busy)return false;
    const current=revision;info.loading=true;lastPoll=clock();
    try{const overview=await call('overview');if(current!==revision)return false;
      Object.assign(info,{overview,admin:overview.admin,expiresAt:overview.expiresAt,error:''});
      if(!info.catalog.length){const result=await call('catalog');if(current===revision)info.catalog=Array.isArray(result)?result:result.catalog??result.items??[];}
      return true;
    }catch(error){if(current===revision||!info.authenticated)info.error=errorMessage(error);return false;}
    finally{info.loading=false;}
  }
  async function login(username,password){
    if(info.busy)return false;info.busy=true;info.error='';const current=++revision;
    try{const result=await call('login',{username,password});if(current!==revision)return false;clear();Object.assign(info,{authenticated:true,admin:result.admin,expiresAt:result.expiresAt});}
    catch(error){info.error=errorMessage(error);return false;}
    finally{info.busy=false;}
    return refresh();
  }
  async function logout(){++revision;clear();info.error='';await call('logout');return true;}
  async function findPlayer(username){
    if(info.busy||!info.authenticated)return false;info.busy=true;info.error='';const current=revision;
    try{const result=await call('player',{username});if(current===revision)info.player=result.player;return result;}
    catch(error){if(current===revision||!info.authenticated)info.error=errorMessage(error);return false;}
    finally{info.busy=false;}
  }
  async function action(action,payload){
    if(info.busy||!info.authenticated)return false;info.busy=true;info.error='';const current=revision;
    try{const result=await call('action',{action,payload,requestId:crypto.randomUUID()});if(current!==revision)return false;
      if(result.result?.player)info.player=result.result.player;
      await onAction(action,payload,result);return result;
    }catch(error){if(current===revision||!info.authenticated)info.error=errorMessage(error);return false;}
    finally{info.busy=false;if(current===revision)void refresh();}
  }
  function poll(open){if(info.authenticated&&clock()>=info.expiresAt){++revision;clear();info.error='Admin-Sitzung abgelaufen. Bitte erneut anmelden.';void call('logout').catch(()=>{});}
    if(open&&info.authenticated&&clock()-lastPoll>=5000)void refresh();}
  return {info,login,logout,refresh,findPlayer,action,poll};
}
