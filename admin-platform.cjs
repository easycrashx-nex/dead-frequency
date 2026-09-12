const { ONLINE_ORIGIN } = require('./online-platform.cjs');
const ROUTES = new Map([
  ['/api/admin/login','POST'], ['/api/admin/logout','POST'], ['/api/admin/me','GET'],
  ['/api/admin/overview','GET'], ['/api/admin/player','POST'], ['/api/admin/catalog','GET'], ['/api/admin/action','POST'],
]);

// Privileged sessions live only in the native process, independently of game accounts.
function createAdminPlatform({request=fetch}={}) {
  let token=null,generation=0;
  async function perform(route,options={}) {
    if(!ROUTES.has(route)||!options||typeof options!=='object'||Array.isArray(options))throw new Error('Ungültige Admin-Anfrage.');
    const method=options.method??ROUTES.get(route),login=route==='/api/admin/login';
    if(method!==ROUTES.get(route))throw new Error('Ungültige Admin-Methode.');
    const body=method==='POST'?JSON.stringify(options.body??{}):undefined;
    if(body&&Buffer.byteLength(body)>16384)throw new Error('Admin-Anfrage ist zu groß.');
    const requestToken=token,revision=login?++generation:generation;
    if(!login&&!requestToken)throw Object.assign(new Error('Bitte als Admin anmelden.'),{status:401});
    let response;
    try{response=await request(`${ONLINE_ORIGIN}${route}`,{method,body,redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(25000),
      headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(!login?{Authorization:`Bearer ${requestToken}`}:{})}});}
    catch{throw new Error('Admin-Server nicht erreichbar.');}
    const reader=response.body?.getReader(),chunks=[];let length=0;
    if(reader)for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>1024*1024){await reader.cancel();throw new Error('Admin-Antwort ist zu groß.');}chunks.push(Buffer.from(value));}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new Error('Ungültige Admin-Antwort.');}
    if(!response.ok){if(response.status===401&&!login&&token===requestToken)token=null;
      throw Object.assign(new Error(data.message||data.error||'Admin-Aktion fehlgeschlagen.'),{status:response.status});}
    const {token:received,...publicData}=data;
    if(login){if(revision!==generation)throw new Error('Anmeldung ist nicht mehr aktuell.');
      if(!/^[a-f0-9]{64}$/.test(received))throw new Error('Ungültige Admin-Sitzung.');token=received;}
    return publicData;
  }
  async function adminRequest(route,options) {
    if(route!=='/api/admin/logout')return perform(route,options);
    const oldToken=token;++generation;
    try{if(oldToken)await perform(route,options);return {ok:true};}
    catch{return {ok:true,revoked:false};}
    finally{if(token===oldToken)token=null;}
  }
  return {adminRequest};
}
module.exports={createAdminPlatform};
