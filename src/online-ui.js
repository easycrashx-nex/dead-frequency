import {validateCredentials,onlineError} from './online-client.js';

export function createOnlineUI(root,actions,{notice=()=>{}}={}){
  const access=document.createElement('button');access.id='account-open';access.className='account-access';access.type='button';access.innerHTML='<span class="account-indicator"></span><span id="account-access-label">KONTO / ANMELDEN</span><span>↗</span>';
  root.querySelector('.header-right').prepend(access);
  const overlay=document.createElement('div');overlay.id='account-overlay';overlay.className='account-overlay';overlay.hidden=true;
  overlay.innerHTML=`<section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title"><header><div><span class="micro orange">DEAD FREQUENCY / OPERATOR-KONTO</span><h2 id="account-title">Dein Zugang zur Zone.</h2></div><button id="account-close" class="close-button" aria-label="Kontofenster schließen">×</button></header>
    <p class="account-intro">Dein Operator. Dein Lager. Auf jedem PC derselbe Online-Fortschritt.</p>
    <div id="account-anonymous"><div class="account-tabs" role="group" aria-label="Kontozugang"><button id="account-login-tab" class="selected" aria-pressed="true">ANMELDEN</button><button id="account-register-tab" aria-pressed="false">KONTO ERSTELLEN</button></div>
      <form id="account-form"><label for="account-username">RUFNAME</label><input id="account-username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="(?:[A-Za-z0-9_]|-){3,24}" spellcheck="false" required placeholder="Dein Operatorname"><p class="account-field-note">3–24 Zeichen · Buchstaben, Zahlen, _ oder -</p>
      <label for="account-password">PASSWORT</label><input id="account-password" name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required placeholder="Mindestens 10 Zeichen">
      <div id="account-confirm-field" hidden><label for="account-confirm">PASSWORT WIEDERHOLEN</label><input id="account-confirm" type="password" autocomplete="new-password" maxlength="128" placeholder="Passwort erneut eingeben"></div>
      <button id="account-submit" class="primary-button" type="submit"><span id="account-submit-label">ANMELDEN</span><span>↗</span></button></form>
    </div>
    <div id="account-authenticated" hidden><div class="account-identity"><span class="account-avatar" aria-hidden="true">⌖</span><div><span class="micro orange">ONLINE-OPERATOR</span><strong id="account-username-display"></strong><span id="account-profile-state">Fortschritt auf dem Server gesichert</span></div></div><div class="account-benefits"><span>SOLO & KOOP <b>Gemeinsame Online-Basis</b></span><span>LAGER & MARKT <b>Automatisch synchronisiert</b></span></div><p id="account-room-note" class="account-field-note" hidden>Dein Konto ist noch mit einem Einsatz verbunden. Verlasse ihn vor dem Abmelden.</p><button id="account-leave-room" class="secondary-button" hidden>SITZUNG VERLASSEN ↗</button><button id="account-logout" class="secondary-button">ABMELDEN & LOKAL SPIELEN ↗</button></div>
    <p id="account-message" class="account-message" role="status" aria-live="polite"></p><footer><span>Lokaler und Online-Spielstand bleiben getrennt.</span><button id="account-offline" class="text-button">LOKAL WEITERSPIELEN ↗</button></footer></section>`;
  root.append(overlay);
  const node=id=>overlay.querySelector(`#${id}`),text=(id,value)=>{if(node(id).textContent!==value)node(id).textContent=value;};
  let info={available:false,authenticated:false},phase='hub',mode='login',pending=false,returnFocus=null,lastServerError='';
  function setMode(next){mode=next;for(const kind of ['login','register']){node(`account-${kind}-tab`).classList.toggle('selected',kind===mode);node(`account-${kind}-tab`).setAttribute('aria-pressed',String(kind===mode));}node('account-confirm-field').hidden=mode!=='register';node('account-confirm').required=mode==='register';node('account-password').autocomplete=mode==='register'?'new-password':'current-password';text('account-submit-label',mode==='register'?'KONTO ERSTELLEN':'ANMELDEN');text('account-message','');}
  function open(){if(phase!=='hub')return;returnFocus=document.activeElement;overlay.hidden=false;(info.authenticated?node('account-close'):node('account-username')).focus({preventScroll:true});}
  function close(){if(overlay.hidden)return false;overlay.hidden=true;node('account-password').value='';node('account-confirm').value='';returnFocus?.focus?.({preventScroll:true});return true;}
  function render(){
    const busy=pending||info.busy||info.restoring;
    access.classList.toggle('is-online',!!info.authenticated);access.setAttribute('aria-label',info.authenticated?`Online-Konto ${info.user?.username}`:'Konto anmelden oder erstellen');
    const label=root.querySelector('#account-access-label');label.textContent=info.restoring?'KONTO WIRD GELADEN …':info.authenticated?info.user.username:'KONTO / ANMELDEN';
    node('account-anonymous').hidden=!!info.authenticated;node('account-authenticated').hidden=!info.authenticated;node('account-offline').hidden=!!info.authenticated;
    for(const input of overlay.querySelectorAll('#account-form input'))input.disabled=busy;
    for(const id of ['account-login-tab','account-register-tab','account-submit'])node(id).disabled=busy||!info.available;
    node('account-logout').disabled=busy||!!info.room;node('account-leave-room').disabled=busy;
    node('account-leave-room').hidden=!info.room;node('account-room-note').hidden=!info.room;
    if(info.authenticated){text('account-username-display',info.user.username);text('account-profile-state',info.sessionExpired?'Anmeldung abgelaufen · erneut anmelden':info.error?'Synchronisierung ausstehend':busy?'Wird synchronisiert …':'Fortschritt auf dem Server gesichert');}
    text('account-submit-label',busy?'BITTE WARTEN …':mode==='register'?'KONTO ERSTELLEN':'ANMELDEN');
    if(info.restoring)text('account-message','Gespeicherte Anmeldung wird geprüft …');
    else if(!info.available)text('account-message','Online-Konten sind in der aktuellen Windows-Version verfügbar. Du kannst lokal weiterspielen.');
    else if(info.error&&info.error!==lastServerError)text('account-message',info.error);
    lastServerError=info.error||'';
    const build=root.querySelector('.build-label');if(build)build.textContent=info.authenticated?'ONLINE · SOLO & KOOP':'LOKAL · SEPARATER SPIELSTAND';
    root.dataset.online=String(!!info.authenticated);
  }
  async function run(action){if(pending||info.busy)return false;pending=true;text('account-message','');render();try{return await action();}catch(error){text('account-message',onlineError(error));return false;}finally{pending=false;render();}}
  async function submit(event){event.preventDefault();const username=node('account-username').value.trim(),password=node('account-password').value,invalid=validateCredentials(username,password);if(invalid){text('account-message',invalid);return;}if(mode==='register'&&password!==node('account-confirm').value){text('account-message','Die beiden Passwörter stimmen nicht überein.');node('account-confirm').focus();return;}const ok=await run(()=>actions.accountAuthenticate(mode,username,password));if(ok){node('account-password').value='';node('account-confirm').value='';text('account-message','Angemeldet. Dein Online-Operator ist bereit.');notice('Online-Profil geladen. Dein lokaler Spielstand bleibt erhalten.');}}
  async function click(event){const id=event.target.closest('button')?.id;if(id==='account-close'||id==='account-offline')close();else if(id==='account-login-tab')setMode('login');else if(id==='account-register-tab')setMode('register');else if(id==='account-logout'){if(await run(()=>actions.accountLogout())){close();notice('Abgemeldet. Dein lokaler Spielstand ist aktiv.');}}else if(id==='account-leave-room')await run(()=>actions.coopLeave());}
  function key(event){if(overlay.hidden||!root.querySelector('#controller-keyboard-overlay')?.hidden)return false;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return true;}if(event.key==='Tab'){const items=[...overlay.querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length),i=items.indexOf(document.activeElement);event.preventDefault();items[(i+(event.shiftKey?-1:1)+items.length)%items.length]?.focus();return true;}event.stopPropagation();return false;}
  access.addEventListener('click',open);overlay.addEventListener('click',click);node('account-form').addEventListener('submit',submit);
  return {open,close,key,isOpen:()=>!overlay.hidden,update(next={},context={}){info=next;phase=context.phase||'hub';if(phase!=='hub')close();render();},dispose(){access.removeEventListener('click',open);overlay.removeEventListener('click',click);node('account-form').removeEventListener('submit',submit);access.remove();overlay.remove();}};
}
