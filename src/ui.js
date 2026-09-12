import { layout } from './layout.js';
import { createCoopUI } from './coop-ui.js';
import { createSettingsUI } from './settings-ui.js';
import { BINDING_ACTIONS, defaultSettings, keyLabel } from './settings.js';
import { KIT_COSTS, UPGRADE_COSTS, RAID_SECONDS } from './simulation.js';
import { marketQuote, saleChance, MARKET_DURATIONS, MARKET_CHECK_MS } from './economy.js';

const number = value => Math.round(Number(value) || 0).toLocaleString('de-DE');
const clock = seconds => `${Math.floor(Math.max(0, seconds || 0) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds || 0) % 60).toString().padStart(2, '0')}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const rarityLabel = rarity => ({ common: 'STANDARD', uncommon: 'INDUSTRIE', rare: 'SELTEN', epic: 'HOCHWERTIG', legendary: 'KRITISCH' })[rarity] || 'FUNDSTÜCK';
const emptyRows = (title, description) => `<div class="logistics-empty"><span aria-hidden="true">▤</span><strong>${title}</strong><p>${description}</p></div>`;
const hubNavigation = `<nav class="hub-navigation" aria-label="Basisbereiche"><button id="tab-deploy" data-hub-tab="deploy" class="selected" aria-pressed="true"><span>01</span> EINSATZ</button><button id="tab-storage" data-hub-tab="storage" aria-pressed="false"><span>02</span> LAGER <b id="nav-storage-count">0</b></button><button id="tab-market" data-hub-tab="market" aria-pressed="false"><span>03</span> MARKT <b id="nav-market-count">0</b></button><button id="tab-mailbox" data-hub-tab="mailbox" aria-pressed="false"><span>04</span> POSTFACH <b id="nav-mail-count">0</b></button><div class="nav-bank"><span>GUTHABEN</span><strong id="nav-bank">750 CR</strong></div></nav>`;
const logisticsPanels = `<section id="hub-logistics" class="hub-logistics" hidden>
  <header class="logistics-heading"><div><span class="eyebrow"><span class="orange-dash"></span> BLACKLINE / BASIS</span><h2 id="logistics-title">DEIN LAGER<span class="orange">.</span></h2><p id="logistics-description">Beute einlagern. Vorräte behalten. Den nächsten Einsatz vorbereiten.</p></div><span class="logistics-stamp">SEKTOR 07<br><b>LOKAL GESICHERT</b></span></header>
  <div id="hub-storage" class="storage-layout logistics-content"><section class="logistics-card intake-card"><div class="logistics-card-heading"><div><span class="micro orange">FRISCH EXTRAHIERT</span><h3>ANLIEFERUNG <b id="intake-count">0</b></h3></div><button id="store-all" class="small-button accent-button" data-action="store-all">ALLES EINLAGERN ↗</button></div><p class="card-description">Dein Extraktionsrucksack. Vor dem nächsten Raid ins sichere Lager übertragen.</p><div id="intake-list" class="logistics-list"></div></section><section class="logistics-card stash-card"><div class="logistics-card-heading"><div><span class="micro dim">BLEIBT BEI TOD ERHALTEN</span><h3>LAGERBESTAND <b id="stash-count">0</b></h3></div><span id="stash-total" class="inventory-total">0 CR <small>RICHTWERT</small></span></div><div class="list-column-labels"><span>GEGENSTAND</span><span>AKTUELLER RICHTWERT</span></div><div id="stash-list" class="logistics-list"></div><p class="logistics-note">Lagerware kannst du behalten oder auf dem lokalen Markt anbieten. Es findet kein automatischer Verkauf statt.</p></section></div>
  <div id="hub-market" class="market-layout logistics-content" hidden><section class="logistics-card sell-card"><div class="sell-scroll"><div class="logistics-card-heading"><div><span class="micro orange">LOKALER HANDEL</span><h3>ANGEBOT ERSTELLEN</h3></div><span class="market-live"><i></i> LIVE</span></div><label class="market-label" for="market-item">GEGENSTAND AUS DEINEM LAGER</label><select id="market-item" aria-label="Gegenstand für Marktangebot"><option value="">Lager ist leer</option></select><div class="quote-display"><div><span class="micro dim">AKTUELLER MARKTRICHTWERT</span><strong id="market-quote">— <small>CR</small></strong></div><span id="market-trend" class="market-trend">—</span></div><svg id="market-chart" class="market-chart" viewBox="0 0 300 50" preserveAspectRatio="none" role="img" aria-label="Marktrichtwert der vergangenen zehn Minuten"><path id="market-chart-fill" d=""/><polyline id="market-chart-line" points=""/></svg><div class="chart-caption"><span>−10 MIN</span><span>JETZT · RICHTWERT</span></div><div class="price-form"><label for="market-price">DEIN WUNSCHPREIS <span>CR</span></label><div class="price-input-row"><input id="market-price" type="number" min="1" max="1000000" step="1" inputmode="numeric" placeholder="Preis festlegen"><button id="use-market-price" class="small-button" data-action="quote-price" title="Aktuellen Marktrichtwert übernehmen">RICHTWERT</button></div><label for="market-duration">ANGEBOTSDAUER</label><select id="market-duration">${MARKET_DURATIONS.map(minutes => `<option value="${minutes}"${minutes === 5 ? ' selected' : ''}>${minutes} MINUTEN</option>`).join('')}</select></div><div class="chance-display"><div><span>VERKAUFSCHANCE</span><strong id="market-chance">—</strong></div><p>je Käuferprüfung (${MARKET_CHECK_MS / 1000} Sekunden). Keine Verkaufsgarantie; Markt und Nachfrage verändern sich.</p><div class="chance-track"><i id="market-chance-fill"></i></div></div><p id="market-form-message" class="market-form-message">Wähle einen eingelagerten Gegenstand.</p></div><button id="create-listing" data-action="list-item" class="primary-button"><span>ANGEBOT EINSTELLEN</span><span>↗</span></button></section><section class="logistics-card listings-card"><div class="logistics-card-heading"><div><span class="micro dim">KAUFINTERESSENTEN PRÜFEN REGELMÄSSIG</span><h3>AKTIVE ANGEBOTE <b id="listing-count">0</b></h3></div><button class="small-button" data-hub-tab="mailbox">POSTFACH ↗</button></div><p class="card-description">Wunschpreis und Laufzeit bleiben fest. Erlöse und unverkaufte Ware landen im Postfach und werden dort von dir beansprucht.</p><div id="listing-list" class="logistics-list"></div><div class="market-rules"><span>01 <b>ANBIETEN</b> Ware verlässt das Lager.</span><span>02 <b>ABWARTEN</b> Käufer entscheiden nach Preis und Nachfrage.</span><span>03 <b>ABHOLEN</b> Credits oder Retoure im Postfach beanspruchen.</span></div></section></div>
  <div id="hub-mailbox" class="mailbox-layout logistics-content" hidden><section class="logistics-card mailbox-card"><div class="logistics-card-heading"><div><span class="micro orange">DEINE MARKTERGEBNISSE</span><h3>POSTEINGANG <b id="mail-count">0</b></h3></div><button id="claim-all" class="small-button accent-button" data-action="claim-all">ALLES BEANSPRUCHEN ↗</button></div><div class="mail-summary"><div><span class="micro dim">ABHOLBARE ERLÖSE</span><strong id="mail-credits">0 CR</strong></div><div><span class="micro dim">WARE ZURÜCK</span><strong id="mail-items">0</strong></div><p>Verkaufserlöse gehen erst beim Beanspruchen auf dein Guthaben. Retouren werden wieder eingelagert.</p></div><div id="mail-list" class="logistics-list"></div></section></div>
</section>`;
const controls = `<dl class="controls-grid"><div><dt><kbd>MAUS</kbd></dt><dd>Umsehen</dd></div><div><dt><kbd>LMB</kbd> / <kbd>RMB</kbd></dt><dd>Feuern / Zielen</dd></div>${BINDING_ACTIONS.map(action => `<div><dt><kbd data-binding-code="${action.key}">${escapeHTML(keyLabel(action.default))}</kbd></dt><dd>${escapeHTML(action.label)}</dd></div>`).join('')}<div><dt><kbd>ESC</kbd></dt><dd>Menü / Pause</dd></div><div><dt><kbd>F11</kbd></dt><dd>Vollbild</dd></div></dl>`;

export function createUI(root, actions) {
  root.classList.add('game-interface');
  root.innerHTML = `
    <div class="damage-vignette" id="damage-flash" aria-hidden="true"></div>
    <section id="hub-screen" class="screen hub-screen">
      <header class="menu-header"><div class="brand-mark"><span class="signal-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span> BLACKLINE <span class="dim">/ OPERATIONS</span></div><div class="header-right"><span class="online-dot"></span><span id="connection-label">LOKALE OPERATION</span><button class="icon-button" data-action="settings" aria-label="Einstellungen">EINSTELLUNGEN <span>↗</span></button></div></header>
      ${hubNavigation}<div id="hub-deploy" class="hub-main"><div class="hero-content">
        <div class="eyebrow"><span class="orange-dash"></span> EXTRACTION PROTOCOL <span class="dim">/ 01</span></div>
        <h1><span>DEAD</span><span>FREQUENCY<span class="title-period">.</span></span></h1>
        <div class="hero-meta"><span>SEKTOR 07</span><i></i><span>KÜSTENSPERRZONE</span><i></i><span>17:42 LOKAL</span></div>
        <p class="hero-description">Geh rein. Hol die Fracht.<br><strong>Komm lebend wieder raus.</strong></p>
        <div class="mission-brief"><span class="micro orange">DEIN AUFTRAG</span><p>Plündere die Sperrzone. Aktiviere das Funkrelais für den Bonus. Erreiche einen Extraktionspunkt, bevor die Zeit abläuft.</p></div>
        <div class="start-row"><button id="start-raid" data-action="start" class="primary-button"><span id="start-label">RAID STARTEN</span><span class="button-arrow">↗</span></button><span class="raid-duration">${clock(RAID_SECONDS)} <small>ZEITFENSTER</small></span></div>
        <p class="loss-warning" id="deployment-note"><span>!</span> Was du nicht extrahierst, bleibt in der Zone.</p>
      </div>
      <aside class="deployment-panel"><div class="panel-heading"><span class="micro">EINSATZVORBEREITUNG</span><span class="tiny dim">01 / 03</span></div>
        <div class="bank-row"><div><span class="micro dim">VERFÜGBARES GUTHABEN</span><strong><span id="hub-credits">0</span><small>CR</small></strong></div><span class="bank-emblem" aria-hidden="true">⌁</span></div>
        <div class="selector-label"><span class="micro">AUSRÜSTUNG</span><span class="tiny dim">VERBRAUCH PRO RAID</span></div>
        <div class="kit-choices"><button id="kit-scout" class="kit-choice selected" data-kit="scout"><span class="choice-top"><strong>SCOUT</strong><span class="kit-cost" id="scout-price">KOSTENLOS</span></span><span class="choice-description" id="scout-description">Leichtes Einsatzkit. Jederzeit bereit.</span><span class="choice-line"><span class="selection-dot"></span> <span id="scout-details">VX-9 · 2 MEDKITS</span></span></button><button id="kit-assault" class="kit-choice" data-kit="assault"><span class="choice-top"><strong>ASSAULT</strong><span class="kit-cost" id="assault-price">350 CR</span></span><span class="choice-description" id="assault-description">Mehr Schutz. Mehr Reserven.</span><span class="choice-line"><span class="selection-dot"></span> <span id="assault-details">AR-4 · VERSTÄRKTE PANZERUNG</span></span></button></div>
        <div class="difficulty-row"><span class="micro">BEDROHUNG</span><div class="segmented"><button id="difficulty-normal" data-difficulty="normal" class="selected">NORMAL</button><button id="difficulty-hard" data-difficulty="hard">HOCH <span>↗</span></button></div></div>
        <p id="difficulty-description" class="tiny dim difficulty-description">Standardpatrouillen. Ein sauberer Einstieg.</p>
        <div class="upgrades-heading"><span class="micro">PERMANENTE UPGRADES</span><span class="tiny dim">BLEIBEN BEI TOD</span></div>
        <div class="upgrade-list">${['armor','backpack','weapon'].map((kind, index) => `<button class="upgrade-button" id="upgrade-${kind}" data-upgrade="${kind}"><span class="upgrade-icon" aria-hidden="true">${['◇','▤','⌖'][index]}</span><span class="upgrade-copy"><strong>${['Panzerung','Rucksack','Waffentuning'][index]}</strong><small id="upgrade-${kind}-level">STUFE 0 / 3</small></span><span class="upgrade-price" id="upgrade-${kind}-price">— CR</span><span class="upgrade-plus">+</span></button>`).join('')}</div>
      </aside></div>${logisticsPanels}
      <footer class="menu-footer"><div class="footer-hint"><span class="micro"><span data-binding-code="forward">W</span> <span data-binding-code="left">A</span> <span data-binding-code="backward">S</span> <span data-binding-code="right">D</span></span> BEWEGEN <span class="footer-separator">/</span> <span class="micro">MAUS</span> ZIELEN <span class="footer-separator">/</span> <span class="micro" data-binding-code="interact">E</span> INTERAGIEREN</div><button data-action="help" class="text-button">FELDHANDBUCH & STEUERUNG <span>↗</span></button><span class="tiny dim build-label">SINGLEPLAYER · OFFLINE</span></footer>
    </section>
    <section id="raid-hud" class="raid-hud" hidden>
      <div class="objective-hud"><div class="objective-label"><span class="live-dot"></span> IM EINSATZ <span id="raid-difficulty">NORMAL</span></div><div class="raid-clock" id="raid-clock">${clock(RAID_SECONDS)}</div><div class="objective-text" id="objective-text">Fracht sichern. Lebend extrahieren.</div><div class="relay-status" id="relay-status">OPTIONAL / FUNKRELAIS AKTIVIEREN</div></div>
      <div class="compass-hud"><span class="compass-pointer">▾</span><div id="compass-labels" class="compass-labels"></div><span id="compass-bearing" class="tiny">000°</span></div>
      <div class="raid-top-right"><span class="micro">SPERRZONE 07</span><span class="tiny dim"><kbd data-binding-code="map">M</kbd> KARTE <i>·</i> <kbd data-binding-code="inventory">TAB</kbd> RUCKSACK</span></div>
      <div id="crosshair" class="crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><div id="hit-marker" class="hit-marker" aria-hidden="true">×</div>
      <div id="interaction" class="interaction" hidden><div class="interaction-key" data-binding-code="interact">E</div><div><span id="interaction-label"></span><small id="interaction-detail"></small></div></div>
      <div id="extraction-hud" class="extraction-hud" hidden><div><span class="micro">EXTRAKTION LÄUFT</span><strong id="extraction-seconds">8.0</strong></div><div class="extraction-track"><i id="extraction-fill"></i></div><span class="tiny">POSITION HALTEN · ZONE NICHT VERLASSEN</span></div>
      <div class="vitals-hud"><div class="health-line"><span class="health-symbol">+</span><strong id="hud-health">100</strong><span class="tiny dim">GESUNDHEIT</span><span class="armor-value"><span>◇</span> <b id="hud-armor">0</b></span></div><div class="health-track"><i id="health-fill"></i></div><div class="stamina-track"><i id="stamina-fill"></i></div><div class="vitals-details"><span><kbd data-binding-code="heal">F</kbd> <b id="hud-medkits">1</b> MEDKIT</span><span id="hud-player-action"></span></div></div>
      <div class="ammo-hud"><div class="loot-mini"><span class="dim">BEUTE</span> <strong id="hud-loot-value">0 CR</strong><span id="hud-loot-space" class="dim">0 / 6</span></div><div class="weapon-name" id="hud-weapon">MX-4 / 5.56</div><div class="ammo-line"><strong id="hud-ammo">30</strong><span>/ <b id="hud-reserve">90</b></span></div><div class="ammo-detail"><span id="hud-firemode">AUTO</span><span><kbd data-binding-code="reload">R</kbd> NACHLADEN</span></div></div>
      <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
      <div class="field-panel" id="map-panel" data-panel="map" hidden><div class="field-panel-header"><div><span class="micro orange">TAKTISCHE ÜBERSICHT</span><h2>SEKTOR 07</h2></div><button class="field-close" data-action="close-field"><kbd data-binding-code="map">M</kbd> / ESC <span>×</span></button></div><div class="map-container"><canvas id="tactical-map" width="720" height="720" aria-label="Taktische Karte mit deiner Position, Funkrelais und Extraktionspunkten"></canvas><span class="map-north">N ↑</span></div><div class="map-legend"><span><i class="legend-player"></i>DU</span><span id="map-team-legend" hidden><i class="legend-teammate"></i>TEAM</span><span><i class="legend-relay"></i>FUNKRELAIS</span><span><i class="legend-exfil"></i>EXTRAKTION</span></div><p class="field-footnote">Die Zeit läuft weiter. Suche Deckung, bevor du die Karte öffnest.</p></div>
      <div class="field-panel inventory-panel" id="inventory-panel" data-panel="inventory" hidden><div class="field-panel-header"><div><span class="micro orange">MITGEFÜHRTE AUSRÜSTUNG</span><h2>RUCKSACK</h2></div><button id="close-inventory" class="field-close" data-action="close-field"><kbd data-binding-code="inventory">TAB</kbd> / ESC <span>×</span></button></div><div class="inventory-summary"><span id="inventory-value">0 CR</span><span id="inventory-capacity" class="micro dim">0 / 6 PLÄTZE</span></div><div id="inventory-list" class="inventory-list"></div><div class="inventory-supplies"><span>RESERVEMUNITION <b id="inventory-reserve">90</b></span><span>MEDKITS <b id="inventory-medkits">1</b></span></div><p class="field-footnote">Der Raid läuft weiter. Abgeworfene Ware bleibt hier in der Zone.</p></div>
    </section>
    <section id="pause-screen" class="screen pause-screen" hidden><div class="pause-content"><span class="eyebrow"><span class="orange-dash"></span> VERBINDUNG GEHALTEN</span><h2 id="pause-title">EINSATZ<br>PAUSIERT<span class="orange">.</span></h2><p class="dim" id="pause-description">Durchatmen. Die Zone wartet.</p><button id="resume-raid" class="primary-button" data-action="resume"><span>FORTSETZEN</span><span>↗</span></button><div class="pause-secondary"><button class="secondary-button" data-action="settings">EINSTELLUNGEN</button><button class="secondary-button" data-action="help">STEUERUNG</button></div><button id="abandon-raid" class="text-button abandon-button" data-action="abandon">EINSATZ ABBRECHEN <span>↗</span></button><p id="abandon-note" class="tiny dim">Mitgeführte Beute geht beim Abbruch verloren.</p></div><div id="pause-coordinate" class="pause-coordinate micro dim">BLACKLINE / SEKTOR 07 / OFFLINE</div></section>
    <section id="result-screen" class="screen result-screen" hidden><div class="result-content"><span class="eyebrow" id="result-eyebrow"><span class="orange-dash"></span> OPERATION ABGESCHLOSSEN</span><h2 id="result-title">ERFOLGREICH<br>EXTRAHIERT<span class="orange">.</span></h2><p id="result-description" class="result-description">Die Fracht ist sicher.</p><div class="result-stats"><div><span class="micro dim">WARENRICHTWERT</span><strong id="result-loot">0 <small>CR</small></strong></div><div><span class="micro dim">BONUS</span><strong id="result-bonus">0 <small>CR</small></strong></div><div><span class="micro dim">ABSCHÜSSE</span><strong id="result-kills">0</strong></div></div><div class="result-total"><span class="micro">BONUS DIREKT GUTGESCHRIEBEN</span><strong id="result-total">0 CR</strong></div><button id="result-hub" class="primary-button" data-action="hub"><span id="result-hub-label">ZURÜCK ZUR BASIS</span><span>↗</span></button><p id="result-storage-note" class="tiny dim">Extrahierte Gegenstände warten unter Lager → Anlieferung.</p></div></section>
    <div id="utility-overlay" class="utility-overlay" hidden><section class="utility-dialog" role="dialog" aria-modal="true" aria-labelledby="utility-title"><div class="utility-heading"><div><span class="micro orange">BLACKLINE / FELDHANDBUCH</span><h2 id="utility-title">STEUERUNG</h2></div><button class="close-button" data-action="close-utility" aria-label="Schließen">×</button></div><div id="help-content"><p class="help-intro">Zwölf Minuten in der Sperrzone. Extrahiere Beute, lagere sie zu Hause ein und verkaufe sie auf dem lokalen Markt.</p>${controls}<div class="help-rules"><p><b>01 / SICHERN</b> Beutekisten durchsuchen. Mit <span data-binding-code="interact">E</span> aufnehmen, solange Platz im Rucksack ist.</p><p><b>02 / SENDEN</b> Das optionale Funkrelais auf der Karte aktivieren und den Bonus sichern.</p><p><b>03 / VERSCHWINDEN</b> Einen markierten Extraktionspunkt erreichen. <span data-binding-code="interact">E</span> drücken und 8 Sekunden in der Zone bleiben.</p></div></div><div id="settings-content" hidden></div><button data-action="close-utility" class="secondary-button utility-done">ZURÜCK</button></section></div>
    <div id="menu-notice" class="menu-notice" role="status" hidden></div>
  `;

  const el = id => root.querySelector(`#${id}`);
  const nodes = Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id, node]));
  const setText = (id, value) => { const node = nodes[id]; if (node && node.textContent !== String(value)) node.textContent = value; };
  const show = (id, visible) => { nodes[id].hidden = !visible; };
  let state = null;
  let currentPhase = '';
  let selectedKit = 'scout';
  let selectedDifficulty = 'normal';
  let panel = null;
  let utility = null;
  let utilityReturnFocus = null, settings = defaultSettings(), bindingSignature = '';
  let lastExternalMap;
  let lastExternalInventory;
  let previousInventory = '';
  let hubTab = 'deploy', selectedMarketItem = '', lastHomeTick = 0;
  const homeSignatures = new Map();
  let abandonArmed = false, resultExitArmed = false;
  let coopInfo = {};
  const hostPartnerActive = () => !!state?.multiplayer && !!coopInfo.id && coopInfo.id === coopInfo.hostId && state.teammates?.some(p => ['raid', 'paused'].includes(p.phase));
  let noticeTimer;
  let hitTimer;
  let damageTimer;
  let toastCounter = 0;
  const timeoutIds = new Set();
  const mapCanvas = el('tactical-map');
  const mapContext = mapCanvas.getContext('2d');
  let economy = { assault: KIT_COSTS.assault, upgradeCosts: UPGRADE_COSTS, maxLevel: 3 };
  const settingsUI = createSettingsUI(nodes['settings-content'], actions);
  const fpsNode = document.createElement('span'); fpsNode.id = 'hud-fps'; fpsNode.className = 'hud-fps'; fpsNode.hidden = true; nodes['raid-hud'].append(fpsNode);

  function notice(text) {
    setText('menu-notice', text);
    show('menu-notice', true);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => show('menu-notice', false), 3400);
  }
  function showUtility(kind) {
    if (kind && !utility) utilityReturnFocus = document.activeElement;
    utility = kind;
    show('utility-overlay', !!kind);
    show('help-content', kind === 'help');
    show('settings-content', kind === 'settings');
    setText('utility-title', kind === 'settings' ? 'EINSTELLUNGEN' : 'STEUERUNG');
    nodes['utility-overlay'].querySelector('.utility-heading .micro').textContent = kind === 'settings' ? 'BLACKLINE / EINSATZPROFIL' : 'BLACKLINE / FELDHANDBUCH';
    nodes['utility-overlay'].querySelector('.utility-dialog').classList.toggle('settings-dialog', kind === 'settings');
    if (kind === 'settings') settingsUI.open(); else settingsUI.close();
    if (kind) el('utility-overlay').querySelector('.close-button').focus({ preventScroll: true });
    else if (utilityReturnFocus?.isConnected && utilityReturnFocus.offsetParent !== null) { utilityReturnFocus.focus({ preventScroll: true }); utilityReturnFocus = null; }
  }
  function selectKit(kit) {
    selectedKit = kit;
    root.querySelectorAll('[data-kit]').forEach(button => {
      button.classList.toggle('selected', button.dataset.kit === kit);
      button.setAttribute('aria-pressed', String(button.dataset.kit === kit));
    });
  }
  function selectDifficulty(difficulty) {
    selectedDifficulty = difficulty;
    root.querySelectorAll('[data-difficulty]').forEach(button => {
      button.classList.toggle('selected', button.dataset.difficulty === difficulty);
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === difficulty));
    });
    setText('difficulty-description', difficulty === 'hard' ? 'Aggressive Patrouillen. Wertvollere Fracht.' : 'Standardpatrouillen. Ein sauberer Einstieg.');
  }
  const homeNow = () => Math.max(Date.now(), state?.profile?.marketTime || 0);
  function selectHubTab(tab) {
    if (!['deploy','storage','market','mailbox'].includes(tab)) return;
    hubTab = tab;
    nodes['hub-screen'].dataset.tab = tab;
    root.querySelectorAll('.hub-navigation [data-hub-tab]').forEach(button => {
      button.classList.toggle('selected', button.dataset.hubTab === tab);
      button.setAttribute('aria-pressed', String(button.dataset.hubTab === tab));
    });
    show('hub-deploy', tab === 'deploy'); show('hub-logistics', tab !== 'deploy');
    for (const name of ['storage','market','mailbox']) show(`hub-${name}`, name === tab);
    nodes['logistics-title'].innerHTML = (({ storage:'DEIN LAGER', market:'DER MARKT', mailbox:'DEIN POSTFACH' })[tab] || '') + '<span class="orange">.</span>';
    setText('logistics-description', ({ storage:'Extrahierte Beute einlagern. Sicher aufbewahren. Für den Handel auswählen.', market:'Deine Ware. Dein Preis. Finde Käufer im dynamischen lokalen Handel.', mailbox:'Verkäufe abschließen. Erlöse abholen. Unverkaufte Ware zurückholen.' })[tab] || '');
    lastHomeTick = 0;
    if (state) renderHome();
  }
  function updateMarketForm() {
    const profile = state?.profile || {}, now = homeNow();
    const item = (profile.stash || []).find(item => String(item.id) === selectedMarketItem);
    const price = Number(nodes['market-price'].value);
    const validPrice = Number.isInteger(price) && price >= 1 && price <= 1000000;
    const full = (profile.listings || []).length >= 20;
    nodes['create-listing'].disabled = !item || !validPrice || full;
    nodes['market-price'].disabled = !item; nodes['market-duration'].disabled = !item; nodes['use-market-price'].disabled = !item;
    setText('market-form-message', !item ? 'Wähle einen eingelagerten Gegenstand.' : full ? '20 Angebote aktiv. Warte auf einen Käufer oder ziehe ein Angebot zurück.' : !validPrice ? 'Wunschpreis: ganze Credits zwischen 1 und 1.000.000.' : 'Kein Sofortverkauf. Die erste Käuferprüfung erfolgt nach 30–45 Sekunden.');
    nodes['market-form-message'].classList.toggle('form-warning', !!item && (!validPrice || full));
    if (!item) {
      setText('market-quote','— CR'); setText('market-trend','KEINE WARE'); setText('market-chance','—');
      nodes['market-chart-line'].setAttribute('points',''); nodes['market-chart-fill'].setAttribute('d',''); nodes['market-chance-fill'].style.width='0%';
      return;
    }
    const quote = marketQuote(item,now), before = marketQuote(item,now-600000);
    const change = before ? (quote/before-1)*100 : 0;
    const chance = validPrice ? clamp(saleChance(item,price,now),0,1) : 0;
    setText('market-quote',`${number(quote)} CR`);
    setText('market-trend',`${change >= 0 ? '↗ +' : '↘ '}${change.toFixed(1).replace('.',',')} % / 10 MIN`);
    nodes['market-trend'].classList.toggle('falling',change<0);
    setText('market-chance',validPrice ? `${(chance*100).toFixed(1).replace('.',',')} %` : '—');
    nodes['market-chance-fill'].style.width=`${chance*100}%`;
    const values = Array.from({length:31},(_,i)=>marketQuote(item,now-(30-i)*20000));
    const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(hi-lo,quote*.04,1);
    const points=values.map((value,i)=>`${i*10},${(44-(value-lo)/span*37).toFixed(1)}`).join(' ');
    nodes['market-chart-line'].setAttribute('points',points);
    nodes['market-chart-fill'].setAttribute('d',`M 0 50 L ${points.replaceAll(' ', ' L ')} L 300 50 Z`);
  }
  function renderHome() {
    const now=homeNow(),tick=Math.floor(now/1000);
    if(lastHomeTick===tick)return;
    lastHomeTick=tick;
    const profile=state?.profile || {},intake=profile.intake || [],stash=profile.stash || [],listings=profile.listings || [],mail=profile.mailbox || [];
    const replaceList=(id,data,render)=>{
      const signature=JSON.stringify(data);
      if(homeSignatures.get(id)!==signature){homeSignatures.set(id,signature);nodes[id].innerHTML=render();}
    };
    setText('nav-storage-count',intake.length+stash.length); setText('nav-market-count',listings.length); setText('nav-mail-count',mail.length);
    nodes['tab-storage'].classList.toggle('attention',intake.length>0); nodes['tab-mailbox'].classList.toggle('attention',mail.length>0);
    setText('nav-bank',`${number(profile.credits)} CR`); setText('intake-count',intake.length); setText('stash-count',stash.length); setText('listing-count',listings.length); setText('mail-count',mail.length);
    nodes['store-all'].disabled=!intake.length; nodes['claim-all'].disabled=!mail.length;
    setText('start-label',intake.length ? 'BEUTE EINLAGERN' : 'RAID STARTEN');
    setText('deployment-note',intake.length ? `${intake.length} Gegenstände warten in der Anlieferung. Vor dem nächsten Einsatz einlagern.` : 'Was du nicht extrahierst, bleibt in der Zone.');
    nodes['deployment-note'].classList.toggle('orange',intake.length>0);
    const itemInfo=item=>`<div class="warehouse-item-info"><strong>${escapeHTML(item.name)}</strong><small>${rarityLabel(item.rarity)}</small></div>`;
    replaceList('intake-list',intake,()=>intake.length ? intake.map(item=>`<div class="warehouse-item rarity-${escapeHTML(item.rarity)}"><span class="cargo-mark" aria-hidden="true">▤</span>${itemInfo(item)}<button class="small-button" data-store-item="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.name)} einlagern">EINLAGERN ↗</button></div>`).join('') : emptyRows('RUCKSACK ENTLADEN.','Neue Beute erscheint hier nach erfolgreicher Extraktion.'));
    replaceList('stash-list',stash,()=>stash.length ? stash.map(item=>`<div class="warehouse-item rarity-${escapeHTML(item.rarity)}"><span class="cargo-mark" aria-hidden="true">▤</span>${itemInfo(item)}<span class="row-quote" data-quote-item="${escapeHTML(item.id)}">${number(marketQuote(item,now))} CR</span><button class="small-button" data-market-item="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.name)} auf dem Markt anbieten">ANBIETEN ↗</button></div>`).join('') : emptyRows('PLATZ FÜR DEINE FRACHT.','Lagere extrahierte Gegenstände ein. Dein Bestand bleibt auch nach einem verlorenen Raid sicher.'));
    let stashValue=0;
    for(const item of stash)stashValue+=marketQuote(item,now);
    setText('stash-total',`${number(stashValue)} CR · RICHTWERT`);
    for(const node of nodes['stash-list'].querySelectorAll('[data-quote-item]')){
      const item=stash.find(item=>String(item.id)===node.dataset.quoteItem);
      if(item)node.textContent=`${number(marketQuote(item,now))} CR`;
    }
    const optionsSignature=JSON.stringify(stash.map(item=>[item.id,item.name]));
    if(homeSignatures.get('market-options')!==optionsSignature){
      homeSignatures.set('market-options',optionsSignature);
      nodes['market-item'].innerHTML=stash.length ? '<option value="">Gegenstand auswählen …</option>'+stash.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${rarityLabel(item.rarity)}</option>`).join('') : '<option value="">Lager ist leer</option>';
      if(!stash.some(item=>String(item.id)===selectedMarketItem))selectedMarketItem='';
      nodes['market-item'].value=selectedMarketItem;
    }
    replaceList('listing-list',listings.map(({nextCheckAt,checks,...listing})=>listing),()=>listings.length ? listings.map(listing=>`<article class="listing-row" data-listing-id="${escapeHTML(listing.id)}"><div class="listing-top"><div class="warehouse-item-info"><strong>${escapeHTML(listing.item.name)}</strong><small>${rarityLabel(listing.item.rarity)} · ANGEBOT AKTIV</small></div><strong class="asking-price">${number(listing.price)} <small>CR</small></strong></div><div class="listing-progress"><i data-listing-progress="${escapeHTML(listing.id)}"></i></div><div class="listing-timing"><span>RESTZEIT <b data-listing-countdown="${escapeHTML(listing.id)}">—</b></span><span>NÄCHSTE PRÜFUNG <b data-listing-check="${escapeHTML(listing.id)}">—</b></span><span>CHANCE <b data-listing-chance="${escapeHTML(listing.id)}">—</b></span></div><div class="listing-bottom"><span class="tiny dim">je Käuferprüfung · kein garantierter Verkauf</span><button class="small-button" data-cancel-listing="${escapeHTML(listing.id)}">ZURÜCKZIEHEN</button></div></article>`).join('') : emptyRows('NOCH NICHT IM HANDEL.','Wähle Lagerware, lege einen Wunschpreis fest und stelle dein erstes Angebot ein.'));
    for(const row of nodes['listing-list'].querySelectorAll('[data-listing-id]')){
      const listing=listings.find(item=>String(item.id)===row.dataset.listingId); if(!listing)continue;
      row.querySelector('[data-listing-countdown]').textContent=clock(Math.ceil((listing.expiresAt-now)/1000));
      row.querySelector('[data-listing-check]').textContent=now>=listing.nextCheckAt?'WIRD GEPRÜFT':`${Math.ceil((listing.nextCheckAt-now)/1000)} S`;
      row.querySelector('[data-listing-chance]').textContent=`${(saleChance(listing.item,listing.price,now)*100).toFixed(1).replace('.',',')} %`;
      row.querySelector('[data-listing-progress]').style.width=`${clamp((listing.expiresAt-now)/Math.max(1,listing.expiresAt-listing.createdAt)*100,0,100)}%`;
    }
    setText('mail-credits',`${number(mail.reduce((sum,item)=>sum+(item.type==='sale' ? item.credits || 0 : 0),0))} CR`);
    setText('mail-items',mail.filter(item=>item.type==='return').length);
    replaceList('mail-list',mail,()=>mail.length ? [...mail].reverse().map(entry=>`<article class="mail-row ${entry.type==='sale' ? 'mail-sale' : 'mail-return'}" data-mail-id="${escapeHTML(entry.id)}"><span class="mail-symbol" aria-hidden="true">${entry.type==='sale'?'↗':'↶'}</span><div class="mail-copy"><span class="micro ${entry.type==='sale'?'orange':'dim'}">${entry.type==='sale'?'VERKAUFT · ERLÖS BEREIT':'RETOURE · WARE BEREIT'}</span><strong>${entry.type==='sale' ? `${number(entry.credits)} CR` : escapeHTML(entry.item?.name || 'Gegenstand')}</strong><p>${escapeHTML((entry.type==='sale' && entry.item?.name ? entry.item.name + ' · ' : '') + (entry.reason || (entry.type==='sale'?'Ein Käufer hat dein Angebot angenommen.':'Dieses Angebot wurde nicht verkauft.')))}</p></div><button class="small-button accent-button" data-claim-mail="${escapeHTML(entry.id)}">${entry.type==='sale'?'ERLÖS ABHOLEN':'ZURÜCK INS LAGER'} ↗</button></article>`).join('') : emptyRows('ALLES ABGEHOLT.','Verkaufserlöse und unverkaufte Gegenstände werden hier zugestellt.'));
    updateMarketForm();
  }
  function chooseMarketItem(id) {
    selectedMarketItem=String(id);
    selectHubTab('market');
    nodes['market-item'].value=selectedMarketItem;
    const item=state?.profile?.stash?.find(item=>String(item.id)===selectedMarketItem);
    nodes['market-price'].value=item ? marketQuote(item,homeNow()) : '';
    updateMarketForm();
  }
  function economyAction(action,...args) {
    const result=actions[action]?.(...args);
    lastHomeTick=0;
    return result;
  }
  const onClick = event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.kit) return selectKit(button.dataset.kit);
    if (button.dataset.difficulty) return selectDifficulty(button.dataset.difficulty);
    if (button.dataset.upgrade) return actions.upgrade(button.dataset.upgrade);
    if (button.dataset.hubTab) return selectHubTab(button.dataset.hubTab);
    if (button.dataset.storeItem) return economyAction('storeItem',button.dataset.storeItem);
    if (button.dataset.marketItem) return chooseMarketItem(button.dataset.marketItem);
    if (button.dataset.cancelListing) return economyAction('cancelListing',button.dataset.cancelListing);
    if (button.dataset.claimMail) return economyAction('claimMail',button.dataset.claimMail);
    if (button.dataset.dropItem) { actions.dropItem?.(button.dataset.dropItem); previousInventory=''; return; }
    switch (button.dataset.action) {
      case 'start': if(state?.profile?.intake?.length){selectHubTab('storage');return;} if (selectedKit === 'assault' && (state?.profile?.credits || 0) < economy.assault) { notice(`Assault benötigt ${number(economy.assault)} CR. Das Scout-Kit ist kostenlos.`); return; } closePanels(); actions.start({ difficulty: selectedDifficulty, kit: selectedKit }); break;
      case 'resume': closePanels(); actions.resume(); break;
      case 'hub':
        if (hostPartnerActive() && !resultExitArmed) { resultExitArmed = true; setText('result-hub-label', 'TEAM BEENDEN BESTÄTIGEN'); setText('result-storage-note', 'Mitspieler noch im Einsatz – Team wirklich beenden? Erneut klicken beendet auch seinen Raid.'); return; }
        closePanels(); actions.hub(); selectHubTab(state?.profile?.intake?.length?'storage':'deploy'); break;
      case 'store-all': economyAction('storeAll'); break;
      case 'claim-all': economyAction('claimAll'); break;
      case 'quote-price': { const item=state?.profile?.stash?.find(item=>String(item.id)===selectedMarketItem); if(item)nodes['market-price'].value=marketQuote(item,homeNow()); updateMarketForm(); break; }
      case 'list-item': if(!nodes['create-listing'].disabled) { const result=economyAction('listItem',selectedMarketItem,Number(nodes['market-price'].value),Number(nodes['market-duration'].value)); if(result!==false){selectedMarketItem='';nodes['market-price'].value='';} } break;
      case 'close-field': closePanels(); actions.closeFieldPanel?.(); break;
      case 'abandon': if (!abandonArmed) { abandonArmed = true; setText('abandon-raid', 'ABBRUCH BESTÄTIGEN →'); setText('abandon-note', hostPartnerActive() ? 'Mitspieler noch im Einsatz – Team wirklich beenden? Erneut klicken beendet beide Raids.' : 'Erneut klicken: Raid beenden und mitgeführte Beute verlieren.'); } else { closePanels(); actions.hub(); } break;
      case 'help': showUtility('help'); break;
      case 'settings': showUtility('settings'); break;
      case 'close-utility': showUtility(null); break;
    }
  };
  const onInput = event => {
    if(event.target.id==='market-item')chooseMarketItem(event.target.value);
    else if(event.target.id==='market-price'||event.target.id==='market-duration')updateMarketForm();
  };
  const onKey = event => {
    if (utility === 'settings' && settingsUI.handleKey(event)) return;
    if (event.key === 'Escape' && utility) { event.stopImmediatePropagation(); event.preventDefault(); showUtility(null); }
    if (event.key === 'Tab' && utility) {
      event.stopPropagation();
      const items = [...el('utility-overlay').querySelectorAll('button,input,select')].filter(node => node.offsetParent !== null && !node.disabled);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (utility) event.stopPropagation();
  };
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey, true);

  function drawMap() {
    if (!mapContext || !state) return;
    const ctx = mapContext, size = mapCanvas.width, margin = 42, scale = (size - margin * 2) / (layout.size || 300);
    const point = (x, z) => [size / 2 + x * scale, size / 2 + z * scale];
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#111b1b'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#29403b'; ctx.lineWidth = 1;
    for (let grid = -(layout.size || 300)/2; grid <= (layout.size || 300)/2; grid += (layout.size || 300)/12) {
      const [coordinate] = point(grid, 0);
      ctx.beginPath(); ctx.moveTo(coordinate, margin); ctx.lineTo(coordinate, size - margin); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(margin, coordinate); ctx.lineTo(size - margin, coordinate); ctx.stroke();
    }
    ctx.strokeStyle = '#657368'; ctx.strokeRect(margin, margin, size-margin*2, size-margin*2);
    for (const obstacle of layout.obstacles || []) {
      const [x, y] = point(obstacle.x-obstacle.w/2, obstacle.z-obstacle.d/2);
      ctx.fillStyle = obstacle.kind === 'building' ? '#58675b' : obstacle.kind === 'container' ? '#536765' : '#37473f';
      ctx.fillRect(x, y, obstacle.w * scale, obstacle.d * scale);
      ctx.strokeStyle = '#8a948066'; ctx.strokeRect(x, y, obstacle.w * scale, obstacle.d * scale);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px "Segoe UI", sans-serif';
    for (const poi of layout.pois || []) {
      const [x, y] = point(poi.x, poi.z);
      ctx.fillStyle = '#0b1518cc'; const width = ctx.measureText(poi.name.toUpperCase()).width + 12;
      ctx.fillRect(x-width/2, y-10, width, 20); ctx.fillStyle = '#e6e7d9'; ctx.fillText(poi.name.toUpperCase(), x, y);
    }
    for (const extraction of layout.extractions || []) {
      const [x, y] = point(extraction.x, extraction.z);
      ctx.fillStyle = '#6cd7b429'; ctx.strokeStyle = '#8ef4c9'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, (extraction.radius || 4) * scale, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#aafbd8'; ctx.font = 'bold 18px "Segoe UI", sans-serif'; ctx.fillText('↗', x, y);
      ctx.font = '600 12px "Segoe UI", sans-serif';
      ctx.fillText(extraction.name.toUpperCase(), clamp(x, 85, size-85), clamp(y+32, 20, size-16));
    }
    if (layout.relay) {
      const [x, y] = point(layout.relay.x, layout.relay.z);
      ctx.strokeStyle = state.raid?.objectiveComplete ? '#8ef4c9' : '#ff9f50'; ctx.fillStyle = '#18211e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x,y-10); ctx.lineTo(x+10,y); ctx.lineTo(x,y+10); ctx.lineTo(x-10,y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const teammate of state.multiplayer ? state.teammates || [] : []) {
      if (teammate.phase === 'extracted' || teammate.phase === 'disconnected') continue;
      const [x, y] = point(teammate.x, teammate.z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-(teammate.yaw || 0));
      ctx.strokeStyle = '#94daf4'; ctx.fillStyle = teammate.dead ? '#406777' : '#75cdec'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 8); ctx.lineTo(0, 4); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const player = state.player;
    if (player) {
      const [x, y] = point(player.x, player.z);
      ctx.save(); ctx.translate(x,y); ctx.rotate(-(player.yaw || 0));
      ctx.shadowColor = '#ff8846'; ctx.shadowBlur = 14; ctx.fillStyle = '#ff9354';
      ctx.beginPath(); ctx.moveTo(0,-13); ctx.lineTo(9,10); ctx.lineTo(0,5); ctx.lineTo(-9,10); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  function renderInventory() {
    const raid = state?.raid || {}, player = state?.player || {};
    setText('inventory-value', `${number(raid.value)} CR`);
    setText('inventory-capacity', `${raid.loot?.length || 0} / ${raid.capacity || 0} PLÄTZE`);
    setText('inventory-reserve', number(player.reserve));
    setText('inventory-medkits', number(player.medkits));
    const signature = JSON.stringify(raid.loot || []);
    if (signature !== previousInventory) {
      previousInventory = signature;
      nodes['inventory-list'].innerHTML = raid.loot?.length ? raid.loot.map((item, index) => `<div class="inventory-item rarity-${escapeHTML(item.rarity || 'common')}"><span class="inventory-slot">${String(index+1).padStart(2,'0')}</span><div><strong>${escapeHTML(item.name || 'Fracht')}</strong><small>${rarityLabel(item.rarity)}</small></div><span class="carried-value">${number(item.value)} <small>CR</small></span><button class="drop-item-button" data-drop-item="${escapeHTML(item.id)}" aria-label="${escapeHTML(item.name)} abwerfen">ABWERFEN <span>↓</span></button></div>`).join('') : `<div class="inventory-empty"><span>▤</span><strong>NOCH KEINE FRACHT.</strong><p>Durchsuche die Zone.<br>Beutekisten sind mit Licht markiert.</p></div>`;
    }
  }

  function update(nextState, info = {}) {
    state = nextState;
    coopInfo = info.coop || {};
    if (info.economy) economy = { ...economy, ...info.economy };
    const phase = state.phase;
    if (phase !== currentPhase) {
      currentPhase = phase;
      root.dataset.phase = phase;
      show('hub-screen', phase === 'hub'); show('raid-hud', phase === 'raid'); show('pause-screen', phase === 'paused'); show('result-screen', phase === 'dead' || phase === 'extracted');
      closePanels();
      abandonArmed = false; resultExitArmed = false;
      setText('abandon-raid', 'EINSATZ ABBRECHEN ↗');
      setText('abandon-note', 'Mitgeführte Beute geht beim Abbruch verloren.');
      if (phase === 'raid') { previousInventory = ''; el('start-raid').blur(); }
    }
    coopUI.update(state, info);
    if (state.multiplayer && phase === 'paused' && !abandonArmed) {
      setText('abandon-note', info.coop?.id === info.coop?.hostId ? 'Als Host beendest du auch den Raid deines Mitspielers. Mitgeführte Beute geht verloren.' : 'Dein Mitspieler bleibt im Raid. Deine mitgeführte Beute geht verloren.');
    }
    show('map-team-legend', !!state.multiplayer);
    if (typeof info.mapOpen === 'boolean' && info.mapOpen !== lastExternalMap) { lastExternalMap = info.mapOpen; if (info.mapOpen) panel = 'map'; else if (panel === 'map') panel = null; }
    if (typeof info.inventoryOpen === 'boolean' && info.inventoryOpen !== lastExternalInventory) { lastExternalInventory = info.inventoryOpen; if (info.inventoryOpen) panel = 'inventory'; else if (panel === 'inventory') panel = null; }
    show('map-panel', phase === 'raid' && panel === 'map'); show('inventory-panel', phase === 'raid' && panel === 'inventory');
    settings = { ...defaultSettings(), ...info.settings, bindings: { ...defaultSettings().bindings, ...info.settings?.bindings } };
    settingsUI.update(settings);
    root.style.setProperty('--hud-scale', settings.hudScale);
    root.style.setProperty('--hud-opacity', settings.hudOpacity);
    root.style.setProperty('--crosshair-color', settings.crosshairColor);
    root.style.setProperty('--crosshair-size', settings.crosshairSize);
    root.style.setProperty('--crosshair-opacity', settings.crosshairOpacity);
    root.dataset.hudCompass = String(settings.compass); root.dataset.teammateHud = String(settings.teammateHud);
    if (!settings.damageVignette) nodes['damage-flash'].classList.remove('visible');
    if (!settings.hitMarker) nodes['hit-marker'].classList.remove('visible');
    fpsNode.hidden = !settings.fps; fpsNode.textContent = `${Math.round(info.fps || 0)} FPS`;
    const nextBindings = JSON.stringify(settings.bindings);
    if (bindingSignature !== nextBindings) {
      bindingSignature = nextBindings;
      root.querySelectorAll('[data-binding-code]').forEach(node => { node.textContent = keyLabel(settings.bindings[node.dataset.bindingCode]); });
    }
    const profile = state.profile || {};
    if (phase === 'hub') renderHome();
    setText('hub-credits', number(profile.credits));
    setText('assault-price', `${number(economy.assault)} CR`);
    nodes['kit-assault'].classList.toggle('unaffordable', (profile.credits || 0) < economy.assault);
    for (const kind of ['armor','backpack','weapon']) {
      const level = profile.upgrades?.[kind] || 0;
      const max = economy.maxLevel || 3;
      const cost = economy.upgradeCosts?.[kind]?.[level] ?? ((economy.upgradeBase?.[kind] || 400) + level * (economy.upgradeStep?.[kind] || 250));
      setText(`upgrade-${kind}-level`, `STUFE ${level} / ${max}`);
      setText(`upgrade-${kind}-price`, level >= max ? 'MAX.' : `${number(cost)} CR`);
      nodes[`upgrade-${kind}`].disabled = level >= max || (profile.credits || 0) < cost;
      nodes[`upgrade-${kind}`].title = level >= max ? 'Maximale Stufe erreicht' : `${({armor:'+20 Panzerung',backpack:'+2 Plätze',weapon:'+10 % Schaden'})[kind]} pro Stufe · ${number(cost)} CR`;
    }
    if (phase === 'raid') {
      const p = state.player, raid = state.raid;
      setText('raid-clock', clock(raid.timeLeft)); nodes['raid-clock'].classList.toggle('urgent', raid.timeLeft <= 60);
      setText('raid-difficulty', raid.difficulty === 'hard' ? 'HOHE BEDROHUNG' : 'NORMAL');
      setText('objective-text', raid.objectiveComplete ? 'Signal gesendet. Extraktionspunkt erreichen.' : 'Fracht sichern. Lebend extrahieren.');
      setText('relay-status', raid.objectiveComplete ? 'FUNKRELAIS AKTIV / BONUS BEREIT' : 'OPTIONAL / FUNKRELAIS AKTIVIEREN');
      nodes['relay-status'].classList.toggle('complete', !!raid.objectiveComplete);
      setText('hud-health', Math.max(0, Math.ceil(p.hp))); setText('hud-armor', Math.max(0, Math.ceil(p.armor))); setText('hud-medkits', p.medkits);
      nodes['health-fill'].style.width = `${clamp(p.hp, 0, 100)}%`; nodes['health-fill'].classList.toggle('critical', p.hp <= 30);
      nodes['stamina-fill'].style.width = `${clamp(p.stamina, 0, 100)}%`;
      setText('hud-ammo', String(p.ammo).padStart(2,'0')); setText('hud-reserve', p.reserve); nodes['hud-ammo'].classList.toggle('urgent', p.ammo <= 5);
      setText('hud-weapon', typeof p.weapon === 'string' ? p.weapon.toUpperCase() : 'MX-4 / 5.56');
      setText('hud-firemode', p.reload > 0 ? 'NACHLADEN …' : p.ammo === 0 ? 'MAGAZIN LEER' : 'AUTO');
      setText('hud-player-action', p.heal > 0 ? 'BEHANDLUNG …' : p.sprinting ? 'SPRINT' : p.sprintExhausted ? settings.sprintMode === 'toggle' ? `ERHOLEN · ${keyLabel(settings.bindings.sprint).toUpperCase()} ERNEUT DRÜCKEN` : `${keyLabel(settings.bindings.sprint).toUpperCase()} LOSLASSEN` : '');
      setText('hud-loot-value', `${number(raid.value)} CR`); setText('hud-loot-space', `${raid.loot?.length || 0} / ${raid.capacity}`);
      const bearing = ((-(p.yaw || 0) * 180 / Math.PI) % 360 + 360) % 360;
      setText('compass-bearing', `${Math.round(bearing).toString().padStart(3,'0')}°`);
      const directions = ['N','NO','O','SO','S','SW','W','NW'];
      const center = Math.round(bearing / 45);
      nodes['compass-labels'].innerHTML = [-2,-1,0,1,2].map(offset => `<span class="${offset === 0 ? 'active' : ''}">${directions[((center+offset)%8+8)%8]}</span>`).join('');
      nodes['crosshair'].classList.toggle('aiming', !!(info.aim ?? p.aim));
      nodes['crosshair'].classList.toggle('moving', !!p.moving);
      show('crosshair', settings.crosshair && !!info.locked && !panel && !(p.reload > 0) && !(p.heal > 0));
      const prompt = state.prompt;
      show('interaction', settings.prompts && !!prompt && !panel && !(raid.extractionProgress > 0));
      if (prompt) { setText('interaction-label', prompt.text); setText('interaction-detail', prompt.kind === 'extract' ? 'EXTRAKTION ANFORDERN' : prompt.kind === 'relay' ? 'OPTIONALES EINSATZZIEL' : 'AUFNEHMEN'); }
      show('extraction-hud', raid.extractionProgress > 0);
      if (raid.extractionProgress > 0) { nodes['extraction-fill'].style.width = `${clamp(raid.extractionProgress / (raid.extractionDuration || 8)*100,0,100)}%`; setText('extraction-seconds', Math.max(0,(raid.extractionDuration || 8)-raid.extractionProgress).toFixed(1)); }
      if (panel === 'map') drawMap();
      if (panel === 'inventory') renderInventory();
    }
    if ((phase === 'dead' || phase === 'extracted') && state.result) {
      const result = state.result;
      nodes['result-title'].innerHTML = result.success ? 'ERFOLGREICH<br>EXTRAHIERT<span class="orange">.</span>' : 'SIGNAL<br>VERLOREN<span class="orange">.</span>';
      setText('result-description', result.success ? `${result.itemCount ?? state.raid?.loot?.length ?? 0} Gegenstände extrahiert. Lagere deine Beute zu Hause ein und entscheide selbst, was du verkaufst.` : result.reason || 'Einsatz beendet. Deine mitgeführte Beute bleibt in der Zone.');
      setText('result-loot', `${number(result.value)} CR`); setText('result-bonus', `${number(result.bonus)} CR`); setText('result-kills', number(result.kills));
      setText('result-total', `${number(result.success ? result.total : 0)} CR`);
      setText('result-storage-note',result.success ? 'Deine Gegenstände warten unter Lager → Anlieferung. Der Warenwert wurde nicht als Guthaben ausgezahlt.' : 'Dein bereits eingelagerter Bestand und bestehende Marktangebote bleiben erhalten.');
      setText('result-hub-label', state.multiplayer ? resultExitArmed && hostPartnerActive() ? 'TEAM BEENDEN BESTÄTIGEN' : 'ZUR BASIS / TEAM VERLASSEN' : 'ZURÜCK ZUR BASIS');
      if (hostPartnerActive()) setText('result-storage-note', resultExitArmed ? 'Mitspieler noch im Einsatz – Team wirklich beenden? Erneut klicken beendet auch seinen Raid.' : 'Dein Mitspieler ist noch im Einsatz. Wenn du als Host das Team verlässt, endet auch sein Raid.');
      nodes['result-screen'].classList.toggle('failure', !result.success);
    }
  }

  function events(items = []) {
    for (const event of items) {
      if (event.type === 'damage' && settings.damageVignette) { nodes['damage-flash'].classList.add('visible'); clearTimeout(damageTimer); damageTimer = setTimeout(() => nodes['damage-flash'].classList.remove('visible'), 330); }
      if ((event.type === 'hit' || event.type === 'kill') && settings.hitMarker) { nodes['hit-marker'].classList.add('visible'); nodes['hit-marker'].classList.toggle('kill', event.type === 'kill'); clearTimeout(hitTimer); hitTimer = setTimeout(() => nodes['hit-marker'].classList.remove('visible'), event.type === 'kill' ? 250 : 140); }
      let text = null, tone = '';
      if (event.type === 'loot') { text = event.name ? `${event.name}  +${number(event.value)} CR` : 'Fracht gesichert'; tone = 'loot'; }
      if (event.type === 'kill') { text = event.headshot ? 'KOPFTREFFER / ZIEL AUSGESCHALTET' : 'ZIEL AUSGESCHALTET'; tone = 'kill'; }
      if (event.type === 'relay') { text = 'FUNKRELAIS AKTIV / EXTRAKTIONSBONUS BEREIT'; tone = 'loot'; }
      if (event.type === 'notice') text = event.text;
      if (text) {
        if (currentPhase !== 'raid') { notice(text); continue; }
        const toast = document.createElement('div'); toast.className = `toast ${tone}`; toast.dataset.toast = ++toastCounter; toast.textContent = text; nodes['toast-stack'].append(toast);
        while (nodes['toast-stack'].children.length > 4) nodes['toast-stack'].firstElementChild.remove();
        const timer = setTimeout(() => { toast.remove(); timeoutIds.delete(timer); }, 3200); timeoutIds.add(timer);
      }
    }
  }

  function togglePanel(kind) {
    if (kind === 'help') { showUtility(utility === 'help' ? null : 'help'); return; }
    panel = panel === kind ? null : kind;
    show('map-panel', panel === 'map'); show('inventory-panel', panel === 'inventory');
    if (panel === 'map') drawMap();
    if (panel === 'inventory') renderInventory();
  }
  function closePanels() { panel = null; show('map-panel', false); show('inventory-panel', false); showUtility(null); }
  const coopUI = createCoopUI(root, actions, { getLoadout: () => ({ kit: selectedKit, difficulty: selectedDifficulty }), notice });
  selectKit('scout'); selectDifficulty('normal'); selectHubTab('deploy');
  return { update, events, togglePanel, closePanels, isUtilityOpen: () => !!utility, isCapturingBinding: () => settingsUI.isCapturingBinding(), closeUtility: () => showUtility(null), dispose() { settingsUI.dispose(); coopUI.dispose(); root.removeEventListener('click',onClick); root.removeEventListener('input',onInput); document.removeEventListener('keydown',onKey,true); clearTimeout(noticeTimer); clearTimeout(hitTimer); clearTimeout(damageTimer); for (const timer of timeoutIds) clearTimeout(timer); root.innerHTML = ''; } };
}
