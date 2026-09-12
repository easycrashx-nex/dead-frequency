import {onlineError} from './online-client.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel={offline:'OFFLINE',online:'BEREIT',lobby:'IN DER LOBBY',raid:'IM EINSATZ'};
const empty=(title,detail)=>`<div class="social-empty"><span aria-hidden="true">◇</span><strong>${title}</strong><p>${detail}</p></div>`;
const personName=value=>value.username||value.from?.username||'Operator';
const roomName=room=>room?.host?.username?`Lobby von ${room.host.username}`:'Gemeinsame Lobby';

export function createSocialUI(root,actions,{getLoadout=()=>({}),notice=()=>{},beforeOpen=()=>{},openAccount=()=>{}}={}){
  const access=document.createElement('button');access.id='friends-open';access.className='friends-hub-access';access.innerHTML='<span>08</span><strong>FREUNDE</strong><b id="friends-badge" hidden>0</b>';
  root.querySelector('.hub-navigation').insertBefore(access,root.querySelector('.nav-bank'));
  const overlay=document.createElement('div');overlay.id='friends-overlay';overlay.className='social-overlay';overlay.hidden=true;
  overlay.innerHTML=`<section class="social-drawer" role="dialog" aria-modal="true" aria-labelledby="friends-title"><header class="social-heading"><div><span class="micro orange">DEAD FREQUENCY / FUNKNETZ</span><h2 id="friends-title">Deine Leute.</h2><p>Zusammen in die Zone. Zusammen wieder raus.</p></div><button id="friends-close" class="close-button" aria-label="Freundesliste schließen">×</button></header>
    <div id="friends-login-note" class="social-login-note" hidden><span aria-hidden="true">⌖</span><h3>Bleibt in Verbindung.</h3><p>Melde dich mit deinem Operator-Konto an, um Freunde hinzuzufügen, Einladungen zu erhalten und gemeinsam zu starten.</p><button id="friends-signin" class="primary-button">KONTO ÖFFNEN <span>↗</span></button></div>
    <div id="friends-online-content"><nav class="social-tabs" aria-label="Freundesbereiche"><button id="friends-tab-friends" data-social-tab="friends" aria-pressed="true" class="selected">FREUNDE <b id="friends-count">0</b></button><button id="friends-tab-requests" data-social-tab="requests" aria-pressed="false">ANFRAGEN <b id="friend-requests-count">0</b></button><button id="friends-tab-invitations" data-social-tab="invitations" aria-pressed="false">EINLADUNGEN <b id="friend-invitations-count">0</b></button></nav>
    <div class="social-list-heading"><span id="friends-section-label">DEIN FUNKNETZ</span><button id="friends-refresh" class="text-button">AKTUALISIEREN ↻</button></div><div id="friends-list" class="social-list"></div><p id="friends-room-hint" class="social-room-hint" hidden>Verlasse deine aktuelle Lobby, bevor du einem anderen Team beitrittst.</p>
    <form id="friend-request-form" class="friend-request-form"><label for="friend-name">FREUND HINZUFÜGEN</label><div><input id="friend-name" name="friend" autocomplete="off" spellcheck="false" maxlength="24" minlength="3" pattern="(?:[A-Za-z0-9_]|-){3,24}" required placeholder="Exakter Rufname"><button id="friend-request" class="secondary-button" type="submit">ANFRAGEN ↗</button></div><span>Der vollständige Rufname deines Mitspielers.</span></form></div>
    <footer class="social-footer"><p id="friends-message" role="status" aria-live="polite"></p><span id="friends-sync-state">FUNKNETZ BEREIT</span></footer></section>`;
  root.append(overlay);
  const node=id=>overlay.querySelector(`#${id}`),text=(id,value)=>{if(node(id).textContent!==String(value))node(id).textContent=value;};
  let state=null,info={},social={},tab='friends',pending=false,returnFocus=null,armedRemove=null,signature='',lastError='',disposed=false;
  const online=()=>!!info.online?.authenticated;
  const busy=()=>pending||!!social.pending||!!info.online?.busy||!!info.online?.restoring;
  const ownRoom=()=>social.room||info.online?.room||(['hosting','connecting','lobby'].includes(info.coop?.status)?{phase:'lobby'}:null);
  const inHub=()=>state?.phase==='hub';
  const canChangeTeam=()=>inHub()&&!ownRoom()&&!['hosting','connecting','lobby'].includes(info.coop?.status);
  function selectTab(next){tab=next;armedRemove=null;signature='';render();}
  function open(){if(!inHub())return;returnFocus=document.activeElement;beforeOpen();overlay.hidden=false;if((social.invitations||[]).length)tab='invitations';else if((social.incoming||[]).length)tab='requests';signature='';render();(online()?node(`friends-tab-${tab}`):node('friends-signin')).focus({preventScroll:true});if(online())refresh();}
  function close({restoreFocus=true}={}){if(overlay.hidden)return false;overlay.hidden=true;armedRemove=null;if(restoreFocus)(returnFocus?.isConnected&&returnFocus.getClientRects().length?returnFocus:access).focus({preventScroll:true});return true;}
  async function run(action,success=''){
    if(busy()||!online()||!inHub())return false;
    pending=true;text('friends-message','');render();
    try{const result=await action();if(result===false)text('friends-message',info.online?.error||social.error||'Aktion nicht möglich. Prüfe den Rufnamen oder den aktuellen Lobby-Status.');else if(success){text('friends-message',success);if(overlay.hidden)notice(success);}return result!==false;}
    catch(error){text('friends-message',onlineError(error));return false;}
    finally{pending=false;signature='';render();}
  }
  async function refresh(){if(busy())return;try{await actions.socialRefresh?.();}catch(error){text('friends-message',onlineError(error));}}
  function friendRow(friend){
    const status=Object.hasOwn(statusLabel,friend.status)?friend.status:'offline',room=friend.room,sameRoom=!!room?.roomId&&room.roomId===ownRoom()?.roomId;
    const ownedLobby=info.coop?.status==='lobby'&&info.coop?.id===info.coop?.hostId;
    const inviteAllowed=inHub()&&['online','lobby'].includes(status)&&!sameRoom&&(!ownRoom()||ownedLobby);
    const joinAllowed=canChangeTeam()&&room?.joinable&&room.phase==='lobby';
    const armed=armedRemove===friend.id;
    return `<article class="social-person" data-friend-id="${esc(friend.id)}"><span class="social-person-mark" data-presence="${status}" aria-hidden="true">⌖</span><div class="social-person-copy"><strong>${esc(friend.username)}</strong><span class="social-presence" data-presence="${status}">${statusLabel[status]}${sameRoom?' · DEIN TEAM':''}</span>${room&&status==='lobby'?`<small>${esc(roomName(room))} · ${room.playerCount??0}/${room.maxPlayers??2}</small>`:''}</div><div class="social-person-actions"><button data-friend-invite="${esc(friend.id)}" class="small-button"${!inviteAllowed||busy()?' disabled':''} title="${status==='offline'?'Dein Freund ist offline.':sameRoom?'Schon in deinem Team.':ownRoom()&&!ownedLobby?'Nur der Teamleiter kann einladen.':'Zum gemeinsamen Einsatz einladen.'}">EINLADEN ↗</button>${room&&status==='lobby'?`<button data-friend-join="${esc(room.roomId)}" class="small-button"${!joinAllowed||busy()?' disabled':''}>${sameRoom?'IM TEAM':room.joinable?'BEITRETEN ↗':'BELEGT'}</button>`:''}<button data-friend-remove="${esc(friend.id)}" class="social-remove${armed?' armed':''}"${busy()?' disabled':''} aria-label="${esc(friend.username)} ${armed?'endgültig entfernen':'aus Freundesliste entfernen'}">${armed?'ENTFERNEN BESTÄTIGEN':'ENTFERNEN'}</button></div></article>`;
  }
  function requestRow(friend,incoming){return `<article class="social-person" data-request-user="${esc(friend.id)}"><span class="social-person-mark" aria-hidden="true">${incoming?'↓':'↑'}</span><div class="social-person-copy"><strong>${esc(personName(friend))}</strong><span>${incoming?'MÖCHTE DICH HINZUFÜGEN':'ANFRAGE GESENDET'}</span></div><div class="social-person-actions">${incoming?`<button data-friend-accept="${esc(friend.id)}" class="small-button accent-button"${busy()?' disabled':''}>ANNEHMEN ✓</button><button data-friend-decline="${esc(friend.id)}" class="social-remove"${busy()?' disabled':''}>ABLEHNEN</button>`:`<button data-friend-cancel="${esc(friend.id)}" class="small-button"${busy()?' disabled':''}>ZURÜCKZIEHEN</button>`}</div></article>`;}
  function invitationRow(invitation){const expired=Number(invitation.expiresAt)<=Date.now(),minutes=Math.max(1,Math.ceil((Number(invitation.expiresAt)-Date.now())/60000));return `<article class="social-person social-invitation" data-invitation-id="${esc(invitation.id)}"><span class="social-person-mark" aria-hidden="true">↗</span><div class="social-person-copy"><strong>${esc(invitation.from?.username||'Operator')}</strong><span>LÄDT DICH IN DIE LOBBY EIN</span><small>${invitation.difficulty==='hard'?'Hohe':'Normale'} Bedrohung · ${expired?'abgelaufen':`noch ${minutes} Min.`}</small></div><div class="social-person-actions"><button data-invitation-accept="${esc(invitation.id)}" class="small-button accent-button"${busy()||expired||!canChangeTeam()?' disabled':''}>BEITRETEN ↗</button><button data-invitation-decline="${esc(invitation.id)}" class="social-remove"${busy()?' disabled':''}>ABLEHNEN</button></div></article>`;}
  function replaceRoster(markup){
    const list=node('friends-list');if(list.innerHTML===markup)return;
    const active=list.contains(document.activeElement)?document.activeElement:null,key=active?[...active.attributes].find(attribute=>attribute.name.startsWith('data-')):null;
    list.innerHTML=markup;
    if(key){const next=[...list.querySelectorAll('button')].find(button=>button.getAttribute(key.name)===key.value);if(next&&!next.disabled)next.focus({preventScroll:true});}
  }
  function render(){
    if(disposed)return;
    const friends=social.friends||[],incoming=social.incoming||[],outgoing=social.outgoing||[],invitations=social.invitations||[],badge=online()?incoming.length+invitations.length:0;
    const badgeNode=root.querySelector('#friends-badge');badgeNode.hidden=!badge;badgeNode.textContent=badge;access.classList.toggle('has-updates',!!badge);access.setAttribute('aria-label',badge?`Freunde · ${badge} neue Anfragen und Einladungen`:'Freunde');
    node('friends-login-note').hidden=online();node('friends-online-content').hidden=!online();
    text('friends-count',friends.length);text('friend-requests-count',incoming.length+outgoing.length);text('friend-invitations-count',invitations.length);
    for(const button of overlay.querySelectorAll('[data-social-tab]')){const selected=button.dataset.socialTab===tab;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
    text('friends-section-label',tab==='friends'?`${friends.filter(friend=>friend.status!=='offline').length} FREUNDE ONLINE`:tab==='requests'?'VERBINDUNGSANFRAGEN':'BEREIT FÜR EINEN GEMEINSAMEN EINSATZ');
    node('friend-name').disabled=busy();node('friend-request').disabled=busy();node('friends-refresh').disabled=busy()||!!social.loading;
    node('friends-room-hint').hidden=!ownRoom()||tab==='requests';
    text('friends-sync-state',social.loading?'FUNKNETZ WIRD AKTUALISIERT …':busy()?'AKTION LÄUFT …':social.error?'VERBINDUNG PRÜFEN':online()?'FUNKNETZ AKTIV':'ONLINE-KONTO ERFORDERLICH');
    if(social.error&&social.error!==lastError)text('friends-message',social.error);lastError=social.error||'';
    const next=JSON.stringify([friends,incoming,outgoing,invitations,tab,busy(),social.loading,armedRemove,ownRoom(),info.coop?.id,info.coop?.hostId,Math.floor(Date.now()/60000)]);
    if(next===signature)return;signature=next;
    let markup;
    if(social.loading&&!social.updatedAt&&!friends.length&&!incoming.length&&!invitations.length)markup=empty('FUNKVERBINDUNG WIRD AUFGEBAUT.','Deine Freunde werden geladen.');
    else if(tab==='friends')markup=friends.length?[...friends].sort((a,b)=>Number(a.status==='offline')-Number(b.status==='offline')||a.username.localeCompare(b.username,'de')).map(friendRow).join(''):empty('NOCH KEINE VERBINDUNG.','Füge deinen Mitspieler über seinen genauen Rufnamen hinzu.');
    else if(tab==='requests')markup=incoming.length||outgoing.length?incoming.map(friend=>requestRow(friend,true)).join('')+outgoing.map(friend=>requestRow(friend,false)).join(''):empty('KEINE OFFENEN ANFRAGEN.','Neue Freundschaftsanfragen erscheinen hier.');
    else markup=invitations.length?invitations.map(invitationRow).join(''):empty('DEIN FUNK IST RUHIG.','Wenn ein Freund dich einlädt, findest du seinen Einsatz hier.');
    replaceRoster(markup);
  }
  async function submit(event){event.preventDefault();const name=node('friend-name').value.trim();if(!/^[A-Za-z0-9_-]{3,24}$/.test(name)){text('friends-message','Rufname: 3–24 Buchstaben, Zahlen, Unterstrich oder Bindestrich.');return;}if(await run(()=>actions.friendRequest(name),'Freundschaftsanfrage gesendet.'))node('friend-name').value='';}
  async function click(event){const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.id==='friends-close')return close();if(button.id==='friends-signin'){close({restoreFocus:false});openAccount();return;}if(button.id==='friends-refresh')return refresh();if(button.dataset.socialTab)return selectTab(button.dataset.socialTab);
    if(button.dataset.friendAccept)return run(()=>actions.friendRespond(button.dataset.friendAccept,true),'Freund hinzugefügt.');
    if(button.dataset.friendDecline)return run(()=>actions.friendRespond(button.dataset.friendDecline,false),'Anfrage abgelehnt.');
    if(button.dataset.friendCancel)return run(()=>actions.friendRemove(button.dataset.friendCancel),'Anfrage zurückgezogen.');
    if(button.dataset.friendRemove){const id=button.dataset.friendRemove;if(armedRemove!==id){armedRemove=id;signature='';render();return;}armedRemove=null;return run(()=>actions.friendRemove(id),'Freund aus dem Funknetz entfernt.');}
    if(button.dataset.friendInvite)return run(()=>actions.friendInvite(button.dataset.friendInvite,getLoadout()),'Einladung gesendet.');
    if(button.dataset.friendJoin){if(await run(()=>actions.coopJoin({roomId:button.dataset.friendJoin,...getLoadout()})))close({restoreFocus:false});return;}
    if(button.dataset.invitationAccept){if(await run(()=>actions.invitationRespond(button.dataset.invitationAccept,true,getLoadout())))close({restoreFocus:false});return;}
    if(button.dataset.invitationDecline)return run(()=>actions.invitationRespond(button.dataset.invitationDecline,false),'Einladung abgelehnt.');
  }
  function key(event){if(overlay.hidden||!root.querySelector('#controller-keyboard-overlay')?.hidden)return false;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();return close();}if(event.key==='Tab'){const items=[...overlay.querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length),index=items.indexOf(document.activeElement);event.preventDefault();items[(index+(event.shiftKey?-1:1)+items.length)%items.length]?.focus();return true;}event.stopPropagation();return false;}
  access.addEventListener('click',open);overlay.addEventListener('click',click);node('friend-request-form').addEventListener('submit',submit);
  return {open,close,key,isOpen:()=>!overlay.hidden,update(nextState,nextInfo={}){state=nextState;info=nextInfo;social=info.social||{};if(!inHub())close({restoreFocus:false});render();},dispose(){disposed=true;access.removeEventListener('click',open);overlay.removeEventListener('click',click);node('friend-request-form').removeEventListener('submit',submit);access.remove();overlay.remove();}};
}
