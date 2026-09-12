import { getWeapon } from './weapons.js';
import { resolveLoadout, getPresetKit } from './loadouts.js';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const statusText = status => ({ hosting: 'EINLADUNG WIRD VORBEREITET', connecting: 'VERBINDUNG WIRD AUFGEBAUT', lobby: 'TEAMVERBINDUNG AKTIV', raid: 'GEMEINSAM IM EINSATZ', error: 'VERBINDUNG UNTERBROCHEN' })[status] || 'BEREIT FÜR ZWEI';

// This view only presents the controller's session state. It never owns a
// connection or optimistically marks either player ready.
export function createCoopUI(root, actions, { getLoadout, notice }) {
  const access = document.createElement('button');
  access.id = 'coop-open'; access.className = 'coop-hub-access'; access.dataset.coopAction = 'open';
  access.innerHTML = '<span>07</span> <strong id="coop-nav-label">KOOP</strong><i class="coop-nav-dot"></i>';
  root.querySelector('.hub-navigation').insertBefore(access, root.querySelector('.nav-bank'));
  const overlay = document.createElement('div'); overlay.id = 'coop-overlay'; overlay.className = 'coop-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<section class="coop-dialog" role="dialog" aria-modal="true" aria-labelledby="coop-title">
    <header class="coop-heading"><div><span class="micro coop-blue">BLACKLINE / TEAMVERBINDUNG</span><h2 id="coop-title">ZUSAMMEN REIN<span class="orange">.</span></h2><p>Ein Einsatz. Zwei Operatoren. Eure gemeinsame Sperrzone.</p></div><button id="coop-close" class="close-button" data-coop-action="close" aria-label="Koop-Fenster schließen">×</button></header>
    <div class="coop-body"><div class="coop-main">
      <div id="coop-entry"><div class="coop-tabs" role="group" aria-label="Koop-Verbindung"><button id="coop-mode-host" class="selected" data-coop-action="mode-host" aria-pressed="true">TEAM ERSTELLEN</button><button id="coop-mode-join" data-coop-action="mode-join" aria-pressed="false">TEAM BEITRETEN</button></div>
        <label class="coop-label" for="coop-name">DEIN RUFNAME</label><input id="coop-name" class="coop-input" autocomplete="nickname" maxlength="20" placeholder="Operator" value="Operator" spellcheck="false">
        <div id="coop-join-fields" hidden><label class="coop-label" for="coop-invite">EINLADUNG DEINES MITSPIELERS</label><input id="coop-invite" class="coop-input" type="text" autocomplete="off" spellcheck="false" placeholder="Einladung hier einfügen"><p class="coop-field-note">Dein Mitspieler erstellt das Team und schickt dir seine Einladung.</p></div>
        <div id="coop-host-fields"><p class="coop-field-note">Erstelle dein Team und teile die Einladung mit einem Freund. Ihr startet, sobald beide bereit sind.</p><details class="coop-options"><summary>Verbindungsoptionen</summary><label><input id="coop-internet" type="checkbox" checked><span>Über das Internet spielen<small>Im selben Netzwerk kannst du diese Option ausschalten.</small></span></label></details></div>
        <div class="coop-loadout"><span>DEIN EINSATZKIT</span><strong id="coop-kit">SCOUT / VX-9</strong><small>Loadout, Aufsätze und Skills werden beim Beitritt festgelegt.</small></div>
        <button id="coop-connect" class="primary-button coop-primary" data-coop-action="connect"><span id="coop-connect-label">TEAM ERSTELLEN</span><span>↗</span></button>
      </div>
      <div id="coop-session" hidden><p class="coop-field-note">Loadout, Aufsätze und Skills sind für dieses Team festgelegt. Zum Ändern die Lobby verlassen.</p><div class="coop-session-heading"><span class="micro coop-blue">DEIN TEAM</span><span id="coop-player-count" class="micro dim">1 / 2</span></div><div id="coop-players" class="coop-players"></div>
        <div id="coop-share" hidden><label class="coop-label" for="coop-share-invite">EINLADUNG TEILEN</label><div class="coop-share-row"><input id="coop-share-invite" class="coop-input" readonly aria-label="Einladung zum Kopieren"><button id="coop-copy" class="small-button" data-coop-action="copy">KOPIEREN ↗</button></div><p class="coop-field-note">Schicke diese Einladung deinem Mitspieler. Lass das Spiel geöffnet.</p></div>
        <div class="coop-lobby-actions"><button id="coop-ready" class="secondary-button" data-coop-action="ready">BEREIT MELDEN</button><button id="coop-start" class="primary-button coop-primary" data-coop-action="start" hidden><span>KOOP-RAID STARTEN</span><span>↗</span></button></div><p id="coop-start-hint" class="coop-field-note"></p>
      </div>
      <div id="coop-connection-status" class="coop-connection-status" role="status" aria-live="polite"><span class="coop-status-dot"></span><div><strong id="coop-status-label">BEREIT FÜR ZWEI</strong><p id="coop-status-message">Gemeinsam bergen. Gemeinsam extrahieren.</p></div></div>
      <div class="coop-bottom-actions"><button id="coop-retry" class="text-button" data-coop-action="retry" hidden>ERNEUT VERSUCHEN ↗</button><button id="coop-leave" class="text-button" data-coop-action="leave" hidden>TEAM VERLASSEN ↗</button></div>
    </div><aside class="coop-brief"><div class="coop-diagram" aria-hidden="true"><div class="coop-signal-ring ring-a"></div><div class="coop-signal-ring ring-b"></div><span class="coop-operator operator-one">01<i></i></span><span class="coop-operator operator-two">02<i></i></span><span class="coop-diagram-coordinate">SEKTOR 07 / VERBINDUNG STEHT</span></div><span class="micro coop-blue">ZWEI OPERATOREN · EIN ZIEL</span><h3>DECKT EUCH.<br>HOLT DIE FRACHT.</h3><p>Gegner und Beute sind für euch beide dieselben. Jeder trägt seinen eigenen Rucksack und sichert seine eigene Extraktion.</p><div class="coop-rules"><span><b>01</b> Kit, Waffe und Skills wählst du in der Basis.</span><span><b>02</b> Beide bereit? Der Host startet.</span><span><b>03</b> Das Menü hält den Raid nicht an.</span></div></aside></div>
  </section>`;
  root.append(overlay);
  const teamHud = document.createElement('div'); teamHud.id = 'teammate-hud'; teamHud.className = 'teammate-hud'; teamHud.hidden = true;
  root.querySelector('#raid-hud').append(teamHud);
  const nodes = new Map([...root.querySelectorAll('[id]')].map(n => [n.id, n]));
  const node = id => nodes.get(id);
  const setText = (id, value) => { const n = node(id); if (n.textContent !== String(value)) n.textContent = value; };
  let coop = { status: 'offline', players: [] }, state = null, mode = 'host', previousStatus = 'offline', playerSignature = '', hudSignature = '';
  let lastRequest = null, returnFocus = null, disposed = false, initialNameApplied = false;

  function open() {
    if (state?.phase !== 'hub') return;
    returnFocus = document.activeElement; overlay.hidden = false;
    const loadout=resolveLoadout(state.profile,getLoadout());setText('coop-kit',`${loadout.name||'EIGENES LOADOUT'} / ${loadout.weapon?.name||'KEINE WAFFE'} · ${loadout.cost} CR`);
    (coop.status === 'lobby' ? node('coop-ready') : node('coop-name')).focus({ preventScroll: true });
  }
  function close() { overlay.hidden = true; if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }
  function connect(retry = false) {
    const name = node('coop-name').value.trim() || 'Operator';
    const invite = node('coop-invite').value.trim();
    if (!retry && mode === 'join' && !invite) { notice('Füge zuerst die Einladung deines Mitspielers ein.'); node('coop-invite').focus(); return; }
    const request = retry && lastRequest ? { mode: lastRequest.mode, args: { ...lastRequest.args, ...getLoadout() } } : { mode, args: { name, ...getLoadout(), ...(mode === 'host' ? { internet: node('coop-internet').checked } : { invite }) } };
    lastRequest = request;
    const callback = request.mode === 'host' ? actions.coopHost : actions.coopJoin;
    if (callback) callback(request.args);
    else notice('Die Teamverbindung ist gerade nicht verfügbar.');
  }
  function onClick(event) {
    const button = event.target.closest('[data-coop-action]'); if (!button || !root.contains(button) || button.disabled) return;
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
      case 'copy': actions.coopCopyInvite?.(); break;
      case 'ready': actions.coopReady?.(!coop.players?.find(p => p.id === coop.id)?.ready); break;
      case 'start': if (coop.players?.length === 2 && coop.players.every(p => p.ready) && coop.id === coop.hostId) actions.coopStart?.(); break;
      case 'leave': actions.coopLeave?.(); break;
    }
  }
  function onKey(event) {
    if (overlay.hidden || !node('utility-overlay').hidden) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    if (event.code === 'Tab') {
      const items = [...overlay.querySelectorAll('button,input,summary')].filter(n => !n.disabled && n.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.code === 'Enter' && (document.activeElement === node('coop-name') || document.activeElement === node('coop-invite')) && ['offline','error'].includes(coop.status)) { event.preventDefault(); connect(); }
  }
  root.addEventListener('click', onClick); document.addEventListener('keydown', onKey, true);

  function update(nextState, info) {
    if (disposed) return;
    state = nextState; coop = info.coop || { status: 'offline', players: [] };
    const status = coop.status || 'offline', busy = status === 'hosting' || status === 'connecting';
    const inLobby = status === 'lobby', isHost = coop.id && coop.id === coop.hostId;
    const players = coop.players || [], own = players.find(p => p.id === coop.id);
    const shouldOpen = status !== previousStatus && ['hosting','connecting','lobby','error'].includes(status) && state.phase === 'hub';
    if (!initialNameApplied && coop.name) { node('coop-name').value = coop.name; initialNameApplied = true; }
    if (state.phase !== 'hub' || (status === 'offline' && previousStatus !== 'offline')) overlay.hidden = true;
    previousStatus = status;
    access.classList.toggle('connected', status !== 'offline' && status !== 'error');
    setText('coop-nav-label', inLobby ? `LOBBY ${players.length}/2` : busy ? 'VERBINDE …' : 'KOOP');
    node('coop-entry').hidden = inLobby || busy; node('coop-session').hidden = !inLobby;
    node('coop-connect').disabled = busy;
    setText('coop-status-label', statusText(status));
    setText('coop-status-message', coop.message || (inLobby ? players.length < 2 ? 'Warte auf deinen Mitspieler. Teile die Einladung.' : 'Euer Team steht. Meldet euch bereit.' : busy ? 'Einen Moment. Dein Team wird verbunden.' : 'Gemeinsam bergen. Gemeinsam extrahieren.'));
    node('coop-connection-status').dataset.status = status;
    node('coop-leave').hidden = !['hosting','connecting','lobby','error'].includes(status);
    setText('coop-leave', busy ? 'VERBINDUNG ABBRECHEN ↗' : 'TEAM VERLASSEN ↗');
    node('coop-retry').hidden = status !== 'error' || !lastRequest;
    node('coop-share').hidden = !inLobby || !coop.invite;
    if (node('coop-share-invite').value !== (coop.invite || '')) node('coop-share-invite').value = coop.invite || '';
    setText('coop-player-count', `${players.length} / 2`);
    const signature = JSON.stringify([players, coop.id, coop.hostId]);
    if (signature !== playerSignature) {
      playerSignature = signature;
      node('coop-players').innerHTML = [0,1].map(i => {
        const p = players[i];
        return p ? `<div class="coop-player ${p.ready ? 'is-ready' : ''}"><span class="coop-player-icon">0${i + 1}</span><div><strong>${escapeHTML(p.name)}${p.id === coop.id ? ' <small>DU</small>' : ''}</strong><span>${escapeHTML(p.loadout?.mode==='custom'?'EIGENES LOADOUT':getPresetKit(p.loadout?.presetId||p.kit)?.name||'EINSATZKIT')} · ${escapeHTML(getWeapon(p.weapon)?.name||'EIGENE WAFFE')}${p.id === coop.hostId ? ' / HOST' : ''}</span></div><b>${p.ready ? 'BEREIT' : 'WARTET'}</b></div>` : '<div class="coop-player vacant"><span class="coop-player-icon">+</span><div><strong>DEIN MITSPIELER</strong><span>WARTET AUF EINLADUNG</span></div></div>';
      }).join('');
    }
    node('coop-ready').disabled = !own || !inLobby;
    node('coop-ready').classList.toggle('is-ready', !!own?.ready); node('coop-ready').setAttribute('aria-pressed', String(!!own?.ready));
    setText('coop-ready', own?.ready ? 'BEREIT ✓ / ZURÜCKNEHMEN' : 'BEREIT MELDEN');
    node('coop-start').hidden = !isHost; node('coop-start').disabled = players.length !== 2 || !players.every(p => p.ready);
    setText('coop-start-hint', isHost ? players.length < 2 ? 'Der Raid startet, wenn dein Mitspieler da ist und ihr beide bereit seid.' : !players.every(p => p.ready) ? 'Beide Operatoren müssen bereit sein.' : 'Team vollständig. Du kannst den Einsatz starten.' : 'Sobald beide bereit sind, startet der Host euren Raid.');
    if (shouldOpen) open();
    const team = state.multiplayer ? state.teammates || [] : [];
    teamHud.hidden = !team.length || state.phase !== 'raid';
    const hudData = team.map(p => ({ name: p.name, hp: Math.round(Math.max(0, p.hp || 0)), maxHp: p.maxHp || 100, dead: p.dead || p.phase === 'dead', phase: p.phase, distance: Math.round(Math.hypot(p.x - state.player.x, p.z - state.player.z)) }));
    const nextHudSignature = JSON.stringify([hudData, Math.round(coop.ping || 0)]);
    if (nextHudSignature !== hudSignature) {
      hudSignature = nextHudSignature;
      teamHud.innerHTML = hudData.map(p => `<div class="teammate-status ${p.dead ? 'is-dead' : ''}"><span class="teammate-diamond">◇</span><div><strong>${escapeHTML(p.name)}</strong><span>${p.dead ? 'GEFALLEN' : p.phase === 'extracted' ? 'EXTRAHIERT' : p.phase === 'disconnected' ? 'VERBINDUNG VERLOREN' : `${p.distance} M ENTFERNT`}<i>${p.dead || p.phase === 'extracted' ? '' : `${p.hp} HP`}</i></span><div class="teammate-health"><b style="width:${Math.min(100,p.hp / p.maxHp * 100)}%"></b></div></div></div>`).join('');
    }
    setText('connection-label', status === 'offline' ? 'LOKALE OPERATION' : status === 'error' ? 'VERBINDUNG GETRENNT' : 'KOOP-TEAM');
    const online = !!state.multiplayer;
    const pauseTitle = node('pause-title');
    const title = online ? 'LOKALES<br>MENÜ<span class="orange">.</span>' : 'EINSATZ<br>PAUSIERT<span class="orange">.</span>';
    if (pauseTitle.innerHTML !== title) pauseTitle.innerHTML = title;
    setText('pause-description', online ? 'Der Koop-Raid läuft weiter. Dein Mitspieler und Gegner bleiben aktiv.' : 'Durchatmen. Die Zone wartet.');
    setText('pause-coordinate', online ? 'BLACKLINE / SEKTOR 07 / KOOP LIVE' : 'BLACKLINE / SEKTOR 07 / OFFLINE');
    const build = root.querySelector('.build-label'); if (build) build.textContent = 'SOLO OFFLINE · 2-SPIELER-KOOP';
  }
  return { update, close, dispose() { disposed = true; root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey, true); overlay.remove(); access.remove(); teamHud.remove(); } };
}
