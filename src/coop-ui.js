import { getWeapon } from './weapons.js';
import { resolveLoadout, getPresetKit } from './loadouts.js';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const statusText = status => ({ hosting: 'EINLADUNG WIRD VORBEREITET', connecting: 'VERBINDUNG WIRD AUFGEBAUT', lobby: 'TEAMVERBINDUNG AKTIV', raid: 'GEMEINSAM IM EINSATZ', error: 'VERBINDUNG UNTERBROCHEN' })[status] || 'BEREIT FÜR ZWEI';

// This view only presents the controller's session state. It never owns a
// connection or optimistically marks either player ready.
export function createCoopUI(root, actions, { getLoadout, notice, beforeOpen=()=>{}, openFriends=()=>{} }) {
  const access = document.createElement('button');
  access.id = 'coop-open'; access.className = 'coop-hub-access'; access.dataset.coopAction = 'open';
  access.innerHTML = '<span>07</span> <strong id="coop-nav-label">KOOP</strong><i class="coop-nav-dot"></i>';
  root.querySelector('.hub-navigation').insertBefore(access, root.querySelector('.nav-bank'));
  const overlay = document.createElement('div'); overlay.id = 'coop-overlay'; overlay.className = 'coop-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<section class="coop-dialog" role="dialog" aria-modal="true" aria-labelledby="coop-title">
    <header class="coop-heading"><div><span class="micro coop-blue">DEAD FREQUENCY / TEAMVERBINDUNG</span><h2 id="coop-title">Koop-Verbindung</h2><p>Zwei Operatoren · gemeinsame Zone</p></div><button id="coop-close" class="close-button" data-coop-action="close" aria-label="Koop-Fenster schließen">×</button></header>
    <div class="coop-body"><div class="coop-main">
      <section id="coop-online-entry" hidden><div class="lobby-browser-heading"><div><span class="micro coop-blue">OPERATOR SUCHT OPERATOR</span><h3>Offene Lobbys</h3></div><button id="coop-refresh" class="text-button" data-coop-action="refresh">AKTUALISIEREN ↻</button></div><p class="lobby-browser-note">Wähle ein Team oder erstelle deinen eigenen Einsatz.</p><div id="coop-room-list" class="lobby-room-list"></div><p id="coop-room-message" class="lobby-room-message" role="status" aria-live="polite"></p><div class="lobby-create"><div><label for="coop-visibility">DEINE LOBBY</label><select id="coop-visibility"><option value="public">Öffentlich · alle Operatoren</option><option value="friends">Nur Freunde · geschlossene Lobby</option></select><p id="coop-visibility-note">Andere Operatoren finden dein Team in der Lobbyauswahl.</p></div><button id="coop-create" class="primary-button coop-primary" data-coop-action="connect">LOBBY ERSTELLEN <span>↗</span></button></div><div class="coop-loadout"><span>DEIN EINSATZKIT</span><strong id="coop-online-kit">SCOUT</strong><small>Dein gewähltes Loadout gilt für diesen Einsatz.</small></div></section>
      <div id="coop-entry"><div class="coop-tabs" role="group" aria-label="Koop-Verbindung"><button id="coop-mode-host" class="selected" data-coop-action="mode-host" aria-pressed="true">TEAM ERSTELLEN</button><button id="coop-mode-join" data-coop-action="mode-join" aria-pressed="false">TEAM BEITRETEN</button></div>
        <label class="coop-label" for="coop-name">DEIN RUFNAME</label><input id="coop-name" class="coop-input" autocomplete="nickname" maxlength="20" placeholder="Operator" value="Operator" spellcheck="false">
        <div id="coop-join-fields" hidden><label class="coop-label" for="coop-invite">EINLADUNG DEINES MITSPIELERS</label><input id="coop-invite" class="coop-input" type="text" autocomplete="off" spellcheck="false" placeholder="Einladung hier einfügen"><p class="coop-field-note">Dein Mitspieler erstellt das Team und schickt dir seine Einladung.</p></div>
        <div id="coop-host-fields"><p class="coop-field-note">Erstelle dein Team und teile die Einladung mit einem Freund. Ihr startet, sobald beide bereit sind.</p><details class="coop-options"><summary>Verbindungsoptionen</summary><label><input id="coop-internet" type="checkbox" checked><span>Über das Internet spielen<small>Im selben Netzwerk kannst du diese Option ausschalten.</small></span></label></details></div>
        <div class="coop-loadout"><span>DEIN EINSATZKIT</span><strong id="coop-kit">SCOUT / VX-9</strong><small>Loadout, Aufsätze und Skills werden beim Beitritt festgelegt.</small></div>
        <button id="coop-connect" class="primary-button coop-primary" data-coop-action="connect"><span id="coop-connect-label">TEAM ERSTELLEN</span><span>↗</span></button>
      </div>
      <div id="coop-session" hidden><p class="coop-field-note">Loadout, Aufsätze und Skills sind für dieses Team festgelegt. Zum Ändern die Lobby verlassen.</p><div class="coop-session-heading"><span class="micro coop-blue">DEIN TEAM</span><span id="coop-player-count" class="micro dim">1 / 2</span></div><div id="coop-players" class="coop-players"></div>
        <div id="coop-online-share" class="lobby-invitation-controls" hidden><div><span id="coop-lobby-visibility" class="micro coop-blue">ÖFFENTLICHE LOBBY</span><p id="coop-lobby-invite-note">Lade einen Freund zu deinem Einsatz ein.</p></div><button id="coop-invite-friends" class="secondary-button" data-coop-action="friends">FREUNDE EINLADEN ↗</button></div>
        <div id="coop-share" hidden><label class="coop-label" for="coop-share-invite">EINLADUNG TEILEN</label><div class="coop-share-row"><input id="coop-share-invite" class="coop-input" readonly aria-label="Einladung zum Kopieren"><button id="coop-copy" class="small-button" data-coop-action="copy">KOPIEREN ↗</button></div><p class="coop-field-note">Schicke diese Einladung deinem Mitspieler. Lass das Spiel geöffnet.</p></div>
        <div class="coop-lobby-actions"><button id="coop-ready" class="secondary-button" data-coop-action="ready">BEREIT MELDEN</button><button id="coop-start" class="primary-button coop-primary" data-coop-action="start" hidden><span>KOOP-RAID STARTEN</span><span>↗</span></button></div><p id="coop-start-hint" class="coop-field-note"></p>
      </div>
      <div id="coop-connection-status" class="coop-connection-status" role="status" aria-live="polite"><span class="coop-status-dot"></span><div><strong id="coop-status-label">BEREIT FÜR ZWEI</strong><p id="coop-status-message">Gemeinsam bergen. Gemeinsam extrahieren.</p></div></div>
      <div class="coop-bottom-actions"><button id="coop-retry" class="text-button" data-coop-action="retry" hidden>ERNEUT VERSUCHEN ↗</button><button id="coop-leave" class="text-button" data-coop-action="leave" hidden>TEAM VERLASSEN ↗</button></div>
    </div><aside class="coop-brief"><div class="coop-diagram" aria-hidden="true"><div class="coop-signal-ring ring-a"></div><div class="coop-signal-ring ring-b"></div><span class="coop-operator operator-one">01<i></i></span><span class="coop-operator operator-two">02<i></i></span><span class="coop-diagram-coordinate">SEKTOR 07 / VERBINDUNG STEHT</span></div><span class="micro coop-blue">ZWEI OPERATOREN · EIN ZIEL</span><h3>Teamprotokoll</h3><p>Gemeinsame Gegner und Beute. Eigener Rucksack, eigene Extraktion. Verwundete Partner mit einem Medkit wiederbeleben.</p><div class="coop-rules"><span><b>01</b> Kit, Waffe und Skills wählst du in der Basis.</span><span><b>02</b> Beide bereit? Der Host startet.</span><span><b>03</b> Das Menü hält den Raid nicht an.</span></div></aside></div>
  </section>`;
  root.append(overlay);
  const teamHud = document.createElement('div'); teamHud.id = 'teammate-hud'; teamHud.className = 'teammate-hud'; teamHud.hidden = true;
  root.querySelector('#raid-hud').append(teamHud);
  const nodes = new Map([...root.querySelectorAll('[id]')].map(n => [n.id, n]));
  const node = id => nodes.get(id);
  const setText = (id, value) => { const n = node(id); if (n.textContent !== String(value)) n.textContent = value; };
  let coop = { status: 'offline', players: [] }, state = null, mode = 'host', previousStatus = 'offline', playerSignature = '', hudSignature = '';
  let lastRequest = null, returnFocus = null, disposed = false, initialNameApplied = false, pending=false,context={},roomSignature='',wasAccountOnline=false;

  function open() {
    if (state?.phase !== 'hub') return;
    returnFocus = document.activeElement;beforeOpen();overlay.hidden = false;
    const loadout=resolveLoadout(state.profile,getLoadout()),description=`${loadout.name||'EIGENES LOADOUT'} / ${loadout.weapon?.name||'KEINE WAFFE'} · ${loadout.cost} CR`;setText('coop-kit',description);setText('coop-online-kit',description);
    (coop.status === 'lobby' ? node('coop-ready') : context.online?.authenticated ? node('coop-visibility') : node('coop-name')).focus({ preventScroll: true });
    if(context.online?.authenticated)refresh();
  }
  function close({restoreFocus=true}={}) {if(overlay.hidden)return false;overlay.hidden = true; if(restoreFocus)(returnFocus?.isConnected&&returnFocus.getClientRects().length?returnFocus:access).focus({preventScroll:true});return true;}
  async function refresh(){if(context.social?.loading||pending)return;try{await actions.socialRefresh?.();}catch(error){setText('coop-room-message',String(error?.message||'Lobbys konnten nicht geladen werden.'));}}
  async function requestConnection(request){if(pending)return false;lastRequest=request;pending=true;node('coop-connect').disabled=node('coop-create').disabled=true;try{return await(request.mode==='host'?actions.coopHost:actions.coopJoin)?.(request.args);}catch(error){notice(String(error?.message||'Verbindung fehlgeschlagen.'));return false;}finally{pending=false;}}
  async function connect(retry = false) {
    if(pending)return;
    if(context.online?.authenticated){return requestConnection(retry&&lastRequest?{mode:lastRequest.mode,args:{...lastRequest.args,...getLoadout()}}:{mode:'host',args:{visibility:node('coop-visibility').value,...getLoadout()}});}
    const name = node('coop-name').value.trim() || 'Operator';
    const invite = node('coop-invite').value.trim();
    if (!retry && mode === 'join' && !invite) { notice('Füge zuerst die Einladung deines Mitspielers ein.'); node('coop-invite').focus(); return; }
    const request = retry && lastRequest ? { mode: lastRequest.mode, args: { ...lastRequest.args, ...getLoadout() } } : { mode, args: { name, ...getLoadout(), ...(mode === 'host' ? { internet: node('coop-internet').checked } : { invite }) } };
    return requestConnection(request);
  }
  function onClick(event) {
    const button = event.target.closest('[data-coop-action],[data-lobby-join]'); if (!button || !root.contains(button) || button.disabled) return;
    if(button.dataset.lobbyJoin)return requestConnection({mode:'join',args:{roomId:button.dataset.lobbyJoin,...getLoadout()}});
    switch (button.dataset.coopAction) {
      case 'open': open(); break;
      case 'close': close(); break;
      case 'mode-host': case 'mode-join':
        mode = button.dataset.coopAction === 'mode-host' ? 'host' : 'join';
        for (const item of ['host','join']) { node(`coop-mode-${item}`).classList.toggle('selected', mode === item); node(`coop-mode-${item}`).setAttribute('aria-pressed', String(mode === item)); }
        node('coop-host-fields').hidden = mode !== 'host'; node('coop-join-fields').hidden = mode !== 'join';
        setText('coop-connect-label', mode === 'host' ? 'TEAM ERSTELLEN' : 'TEAM BEITRETEN'); break;
      case 'connect': connect(); break;
      case 'retry': connect(true); break;
      case 'refresh': refresh(); break;
      case 'friends': openFriends(); break;
      case 'copy': actions.coopCopyInvite?.(); break;
      case 'ready': actions.coopReady?.(!coop.players?.find(p => p.id === coop.id)?.ready); break;
      case 'start': if (coop.players?.length >= (coop.minPlayers||2) && coop.players.every(p => p.ready) && coop.id === coop.hostId) actions.coopStart?.(); break;
      case 'leave': actions.coopLeave?.(); break;
    }
  }
  function onKey(event) {
    if (overlay.hidden || !node('utility-overlay').hidden) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.code === 'Tab') {
      const items = [...overlay.querySelectorAll('button,input,select,summary')].filter(n => !n.disabled && n.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.code === 'Enter' && (document.activeElement === node('coop-name') || document.activeElement === node('coop-invite')) && ['offline','error'].includes(coop.status)) { event.preventDefault(); connect(); }
  }
  root.addEventListener('click', onClick); document.addEventListener('keydown', onKey, true);

  function update(nextState, info) {
    if (disposed) return;
    state = nextState;context=info; coop = info.coop || { status: 'offline', players: [] };
    const status = coop.status || 'offline', busy = pending || info.online?.busy || status === 'hosting' || status === 'connecting';
    const accountOnline=!!info.online?.authenticated,solo=coop.mode==='solo',required=coop.minPlayers||(solo?1:2),maximum=coop.maxPlayers||(solo?1:2);
    if(accountOnline!==wasAccountOnline){lastRequest=null;roomSignature='';wasAccountOnline=accountOnline;}
    const inLobby = status === 'lobby', isHost = coop.id && coop.id === coop.hostId;
    const players = coop.players || [], own = players.find(p => p.id === coop.id);
    const shouldOpen = status !== previousStatus && ['hosting','connecting','lobby','error'].includes(status) && state.phase === 'hub';
    if (!initialNameApplied && coop.name) { node('coop-name').value = coop.name; initialNameApplied = true; }
    node('coop-name').readOnly=accountOnline;node('coop-name').maxLength=accountOnline?24:20;
    if(accountOnline)node('coop-name').value=info.online.user.username;
    node('coop-name').previousElementSibling.textContent=accountOnline?'DEIN ONLINE-OPERATOR':'DEIN LOKALER RUFNAME';
    overlay.querySelector('.coop-options').hidden=accountOnline;
    setText('coop-title',accountOnline?inLobby?'Dein Team':'Lobbys':'Lokale Koop-Verbindung');overlay.classList.toggle('online-lobby-overlay',accountOnline);
    if (state.phase !== 'hub' || (status === 'offline' && previousStatus !== 'offline')) overlay.hidden = true;
    previousStatus = status;
    access.classList.toggle('connected', status !== 'offline' && status !== 'error');
    setText('coop-nav-label', inLobby ? `LOBBY ${players.length}/${maximum}` : busy ? 'VERBINDE …' : accountOnline?'LOBBYS':'LOKALER KOOP');
    node('coop-entry').hidden = accountOnline || inLobby || busy; node('coop-session').hidden = !inLobby;node('coop-online-entry').hidden=!accountOnline||inLobby||busy;
    node('coop-connect').disabled = busy;
    setText('coop-status-label', statusText(status));
    setText('coop-status-message', coop.message || (inLobby ? solo?'Dein Online-Soloeinsatz wird gestartet.':players.length < required ? 'Warte auf deinen Mitspieler. Teile die Einladung.' : 'Euer Team steht. Meldet euch bereit.' : busy ? 'Einen Moment. Dein Team wird verbunden.' : accountOnline?'Gemeinsamer Server · eigener Online-Fortschritt':'Lokaler Spielstand · direkt mit deinem Mitspieler verbinden'));
    node('coop-connection-status').dataset.status = status;
    node('coop-leave').hidden = !['hosting','connecting','lobby','error'].includes(status);
    setText('coop-leave', busy ? 'VERBINDUNG ABBRECHEN ↗' : 'TEAM VERLASSEN ↗');
    node('coop-retry').hidden = status !== 'error' || !lastRequest;
    node('coop-share').hidden = accountOnline || !inLobby || !coop.invite || solo;
    const shareValue=accountOnline?'':coop.invite||'';if(node('coop-share-invite').value!==shareValue)node('coop-share-invite').value=shareValue;
    node('coop-online-share').hidden=!accountOnline||!inLobby||solo;
    const visibility=info.social?.room?.visibility||info.online?.room?.visibility||coop.visibility||'public';
    setText('coop-lobby-visibility',visibility==='friends'?'PRIVATE LOBBY · NUR FREUNDE':'ÖFFENTLICHE LOBBY');
    node('coop-invite-friends').disabled=!isHost||players.length>=maximum||busy;
    setText('coop-lobby-invite-note',players.length>=maximum?'Dein Team ist vollständig.':!isHost?'Der Teamleiter lädt weitere Freunde ein.':visibility==='friends'?'Deine Freunde können über die Freundesliste oder eine Einladung beitreten.':'Andere Operatoren können beitreten. Du kannst auch einen Freund einladen.');
    if(accountOnline)renderRooms(info,busy);
    setText('coop-player-count', `${players.length} / ${maximum}`);
    const signature = JSON.stringify([players, coop.id, coop.hostId,maximum]);
    if (signature !== playerSignature) {
      playerSignature = signature;
      node('coop-players').innerHTML = Array.from({length:maximum},(_,i)=>i).map(i => {
        const p = players[i];
        return p ? `<div class="coop-player ${p.ready ? 'is-ready' : ''}"><span class="coop-player-icon">0${i + 1}</span><div><strong>${escapeHTML(p.name)}${p.id === coop.id ? ' <small>DU</small>' : ''}</strong><span>${escapeHTML(p.loadout?.mode==='custom'?'EIGENES LOADOUT':getPresetKit(p.loadout?.presetId||p.kit)?.name||'EINSATZKIT')} · ${escapeHTML(getWeapon(p.weapon)?.name||'EIGENE WAFFE')}${p.id === coop.hostId ? ' / HOST' : ''}</span></div><b>${p.ready ? 'BEREIT' : 'WARTET'}</b></div>` : '<div class="coop-player vacant"><span class="coop-player-icon">+</span><div><strong>DEIN MITSPIELER</strong><span>WARTET AUF EINLADUNG</span></div></div>';
      }).join('');
    }
    node('coop-ready').disabled = !own || !inLobby;
    node('coop-ready').classList.toggle('is-ready', !!own?.ready); node('coop-ready').setAttribute('aria-pressed', String(!!own?.ready));
    setText('coop-ready', own?.ready ? 'BEREIT ✓ / ZURÜCKNEHMEN' : 'BEREIT MELDEN');
    node('coop-start').hidden = !isHost; node('coop-start').disabled = players.length < required || !players.every(p => p.ready);
    node('coop-start').querySelector('span').textContent=solo?'SOLO-RAID STARTEN':'KOOP-RAID STARTEN';
    setText('coop-start-hint',solo?'Dieser Einsatz läuft auf dem Server. Das Menü pausiert die Zone nicht.':isHost ? players.length < required ? 'Der Raid startet, wenn dein Mitspieler da ist und ihr beide bereit seid.' : !players.every(p => p.ready) ? 'Beide Operatoren müssen bereit sein.' : 'Team vollständig. Du kannst den Einsatz starten.' : 'Sobald beide bereit sind, startet der Teamleiter euren Raid.');
    if (shouldOpen) open();
    const team = state.multiplayer ? state.teammates || [] : [];
    teamHud.hidden = !team.length || state.phase !== 'raid';
    const hudData = team.map(p => ({ name: p.name, hp: Math.round(Math.max(0, p.hp || 0)), maxHp: p.maxHp || 100, dead: p.dead || p.phase === 'dead', downed: !!p.downed, bleedout: Math.ceil(p.bleedoutRemaining || 0), phase: p.phase, distance: Math.round(Math.hypot(p.x - state.player.x, p.z - state.player.z)) }));
    const nextHudSignature = JSON.stringify([hudData, Math.round(coop.ping || 0)]);
    if (nextHudSignature !== hudSignature) {
      hudSignature = nextHudSignature;
      teamHud.innerHTML = hudData.map(p => `<div class="teammate-status ${p.dead ? 'is-dead' : p.downed ? 'is-downed' : ''}"><span class="teammate-diamond">◇</span><div><strong>${escapeHTML(p.name)}</strong><span>${p.dead ? 'GEFALLEN' : p.downed ? `VERWUNDET · ${p.bleedout} S` : p.phase === 'extracted' ? 'EXTRAHIERT' : p.phase === 'disconnected' ? 'VERBINDUNG VERLOREN' : `${p.distance} M ENTFERNT`}<i>${p.dead || p.phase === 'extracted' ? '' : `${p.hp} HP`}</i></span><div class="teammate-health"><b style="width:${Math.min(100,p.hp / p.maxHp * 100)}%"></b></div></div></div>`).join('');
    }
    setText('connection-label', status === 'offline' ? 'LOKALE OPERATION' : status === 'error' ? 'VERBINDUNG GETRENNT' : 'KOOP-TEAM');
    const online = !!state.multiplayer;
    const pauseTitle = node('pause-title');
    const title = online ? 'LOKALES MENÜ<span class="orange">.</span>' : 'EINSATZ PAUSIERT<span class="orange">.</span>';
    if (pauseTitle.innerHTML !== title) pauseTitle.innerHTML = title;
    setText('pause-description', online ? solo?'Dein Online-Soloeinsatz läuft weiter. Die Zone und Gegner bleiben aktiv.':'Der Koop-Raid läuft weiter. Dein Mitspieler und Gegner bleiben aktiv.' : 'Durchatmen. Die Zone wartet.');
    setText('pause-coordinate', online ? 'DEAD FREQUENCY / SEKTOR 07 / KOOP LIVE' : 'DEAD FREQUENCY / SEKTOR 07 / OFFLINE');
    const build = root.querySelector('.build-label'); if (build) build.textContent = 'SOLO OFFLINE · 2-SPIELER-KOOP';
  }
  function renderRooms(info,busy){
    const social=info.social||{},rooms=social.rooms||[],full=!!social.capacity?.maxRooms&&social.capacity.rooms>=social.capacity.maxRooms;
    node('coop-refresh').disabled=busy||!!social.loading;node('coop-create').disabled=busy||full||!!info.online?.room;node('coop-visibility').disabled=busy;
    setText('coop-visibility-note',node('coop-visibility').value==='friends'?'Nur deine Freunde können deiner privaten Lobby beitreten.':'Andere Operatoren finden dein Team in der Lobbyauswahl.');
    setText('coop-room-message',social.error|| (full?'Gerade sind alle Einsatzplätze belegt. Tritt einem Team bei oder versuche es gleich erneut.':social.loading?'Lobbys werden aktualisiert …':rooms.length?'Wähle ein freies Team. Dein Loadout wird beim Beitritt festgelegt.':'Noch kein offenes Team. Erstelle die erste Lobby oder lade einen Freund ein.'));
    const signature=JSON.stringify([rooms,busy,!!social.loading,!!social.updatedAt,!!info.online?.room]);if(signature===roomSignature)return;roomSignature=signature;
    const list=node('coop-room-list'),active=list.contains(document.activeElement)?document.activeElement?.dataset.lobbyJoin:null;
    list.innerHTML=rooms.length?rooms.map(room=>{const count=room.playerCount??room.players?.length??0,max=room.maxPlayers||2,join=room.joinable&&count<max&&room.phase==='lobby'&&!info.online?.room;return `<article class="lobby-room" data-lobby-id="${escapeHTML(room.roomId)}"><span class="lobby-room-marker" aria-hidden="true">${room.visibility==='friends'?'◇':'⌖'}</span><div><strong>${escapeHTML(room.host?.username||'Operator')}</strong><span>${room.visibility==='friends'?'NUR FREUNDE':'ÖFFENTLICH'} · ${room.difficulty==='hard'?'HOHE':'NORMALE'} BEDROHUNG</span></div><span class="lobby-room-occupancy">${count}<small> / ${max}</small></span><button class="small-button" data-lobby-join="${escapeHTML(room.roomId)}"${!join||busy?' disabled':''}>${count>=max?'VOLL':room.phase!=='lobby'?'IM EINSATZ':!room.joinable?'NICHT VERFÜGBAR':'BEITRETEN ↗'}</button></article>`;}).join(''):`<div class="lobby-empty"><span aria-hidden="true">◇</span><strong>${social.loading&&!social.updatedAt?'FUNKVERBINDUNG WIRD AUFGEBAUT.':'NOCH KEINE OFFENE LOBBY.'}</strong><p>${social.loading&&!social.updatedAt?'Wir suchen nach verfügbaren Teams.':'Dein nächster Mitspieler wartet vielleicht auf dich.'}</p></div>`;
    if(active){const button=[...list.querySelectorAll('[data-lobby-join]')].find(node=>node.dataset.lobbyJoin===active);if(button&&!button.disabled)button.focus({preventScroll:true});}
  }
  return { update, open, close,isOpen:()=>!overlay.hidden, dispose() { disposed = true; root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); overlay.remove(); access.remove(); teamHud.remove(); } };
}
