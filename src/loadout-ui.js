import { WEAPONS, getWeapon } from './weapons.js';
import { ATTACHMENTS, EQUIPMENT, PRESET_KITS, ATTACHMENT_SLOTS, GEAR_SLOTS, getAttachment, getEquipment, canAttach, deriveWeapon, resolveLoadout } from './loadouts.js';
import { createWeaponPreview } from './weapon-preview.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Math.round(Number(value)||0).toLocaleString('de-DE');
const decimal=value=>Number(value||0).toLocaleString('de-DE',{maximumFractionDigits:2});
const gearNames={weapon:'Primärwaffe',backpack:'Rucksack',carrier:'Plattenträger',plate:'Schutzplatte',helmet:'Helm'};
const slotNames={optic:'Optik',muzzle:'Mündung',barrel:'Lauf',magazine:'Magazin',grip:'Griff',stock:'Schaft'};
const ids=slots=>slots.map(slot=>typeof slot==='string'?slot:slot.id);
const attachmentIds=weapon=>Object.fromEntries(Object.entries(weapon?.attachments||{}).map(([slot,item])=>[slot,typeof item==='string'?item:item.catalogId]));
const isOwnedItem=item=>['weapon','attachment','equipment'].includes(item.kind);
const countParts=item=>Object.keys(item.attachments||{}).length;
const normalize=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

export function gearSilhouette(slot) {
  const paths={backpack:'M35 28v-9c0-13 50-13 50 0v9M29 26h62v80H29zM40 48h40v23H40zM40 82h40v14H40zM19 39h10v53H19zM91 39h10v53H91z',carrier:'M33 13h18v15h18V13h18l14 26-12 11v57H31V50L19 39zM42 48h36v34H42zM39 90h42',plate:'M36 16h48l13 20v60l-17 12H40L23 96V36zM42 29h36M38 45h44M38 91h44',helmet:'M20 63V48c0-47 80-47 80 0v15M17 63h86v17H87v17H73V80H47v17H33V80H17zM34 27h52M55 16v31h10V16'};
  return `<svg class="gear-silhouette" viewBox="0 0 120 120" aria-hidden="true"><path d="${paths[slot]||paths.carrier}"/></svg>`;
}

export function createLoadoutUI(container, actions, {weaponSilhouette}) {
  let profile={},context={},tab='kits',editorWeaponId='',attachmentSlot=ids(ATTACHMENT_SLOTS)[0],draftAttachment='',shopId=WEAPONS[0]?.id,preview=null,previewSignature='',signature='';
  const slots=ids(GEAR_SLOTS),attachmentSlots=ids(ATTACHMENT_SLOTS);
  const catalog=[...WEAPONS.map(item=>({...item,kind:'weapon'})),...ATTACHMENTS.map(item=>({...item,kind:'attachment'})),...EQUIPMENT.map(item=>({...item,kind:'equipment'}))];
  const catalogById=new Map(catalog.map(item=>[item.id,item]));
  const price=item=>item?.purchaseCost??item?.cost??0;
  const modifierNames={damage:'Schaden',magSize:'Magazin',reloadSeconds:'Nachladezeit',range:'Reichweite',recoilPitch:'Hochschlag',recoilYaw:'Seitenrückstoß',spread:'Streuung',adsZoom:'Vergrößerung',adsSeconds:'Anschlagzeit',soundRadius:'Hörbarkeit',moveMultiplier:'Bewegung'};
  const modifierMarkup=item=>Object.entries(item.modifiers||{}).map(([key,value])=>`<div><dt>${esc(modifierNames[key]||key)}</dt><dd>${key==='adsZoom'?`${decimal(value)} ×`:`${value>=1?'+':''}${decimal((value-1)*100)} %`}</dd></div>`).join('');
  const slotName=slot=>slotNames[slot]||ATTACHMENT_SLOTS.find(item=>item.id===slot)?.name||slot;
  const text=(id,value)=>{const node=el(id);if(node.textContent!==String(value))node.textContent=value;};
  const el=id=>container.querySelector(`#${id}`);
  const setHTML=(node,html)=>{
    if(node.innerHTML===html)return;
    const active=document.activeElement,identity=active&&node.contains(active)?active.id||active.getAttribute('data-owned-item')||active.getAttribute('data-shop-item'):null;
    const oldScroll=node.scrollTop;node.innerHTML=html;node.scrollTop=oldScroll;
    if(identity){const replacement=[...node.querySelectorAll('button,input,select')].find(item=>item.id===identity||item.dataset.ownedItem===identity||item.dataset.shopItem===identity);replacement?.focus({preventScroll:true});}
  };
  const option=(value,label,disabled=false)=>`<option value="${esc(value)}"${disabled?' disabled':''}>${esc(label)}</option>`;
  const instanceLabel=item=>`${item.name}${item.kind==='weapon'&&countParts(item)?` · ${countParts(item)} Aufsätze`:''} · ${String(item.id).slice(-5).toUpperCase()}`;
  const owned=()=> (profile.stash||[]).filter(isOwnedItem);
  const selectedIds=()=>new Set(Object.values(profile.loadout?.custom||{}).filter(value=>typeof value==='string'));
  const currentWeapon=()=>owned().find(item=>item.kind==='weapon'&&item.id===editorWeaponId);
  const image=item=>item?.kind==='weapon'?weaponSilhouette(item.id):item?.kind==='equipment'?gearSilhouette(item.slot):`<svg class="attachment-silhouette" viewBox="0 0 150 90" aria-hidden="true"><path d="M22 37h106v20H22zM36 30h15v34H36zM97 30h15v34H97zM57 56h35v14H57z"/><circle cx="74" cy="46" r="9"/></svg>`;
  container.classList.add('loadout-armory');
  container.innerHTML=`<header class="feature-heading"><div><span class="eyebrow"><span class="orange-dash"></span> BLACKLINE / AUSRÜSTUNG</span><h2>DEIN ARSENAL<span class="orange">.</span></h2><p>Ein fertiges Kit. Oder deine eigene Handschrift.</p></div><div class="feature-status"><span class="micro dim">AKTIVES LOADOUT</span><strong id="armory-equipped">SCOUT</strong><small id="armory-cost"></small></div></header><p id="armory-lock-note" class="loadout-lock-note" hidden>Deine Ausrüstung wurde beim Koop-Beitritt festgelegt. Verlasse die Lobby, um sie zu ändern.</p>
    <nav class="armory-tabs" aria-label="Arsenalbereiche">${[['kits','FERTIGE KITS'],['loadout','AUSRÜSTUNG'],['editor','WAFFENBANK'],['shop','SHOP']].map(([id,label],i)=>`<button data-armory-tab="${id}" aria-pressed="${id===tab}"><span>0${i+1}</span>${label}</button>`).join('')}</nav>
    <section id="armory-kits" class="armory-section"><div class="armory-section-intro"><p>Komplette Einsatzkits. Feste Waffe, feste Aufsätze und fester Schutz. Der Preis wird erst beim Raidstart fällig.</p><span>6 FESTE KITS</span></div><div id="preset-kit-list" class="preset-kit-list"></div><p class="armory-footnote">Leihmaterial: Kitteile können nicht eingelagert, verkauft oder abgeworfen werden. Eigene Fundstücke nimmst du bei erfolgreicher Extraktion mit.</p></section>
    <section id="armory-loadout" class="armory-section" hidden><div class="custom-workspace"><section class="custom-build armory-card"><header><div><span class="micro orange">AUS DEINEM LAGER</span><h3>EIGENES LOADOUT</h3></div><button id="use-custom-loadout" data-loadout-mode="custom" class="small-button accent-button">VERWENDEN ↗</button></header><p class="armory-copy">Wähle besessene Gegenstände. Beim Extrahieren bleibt deine Ausrüstung erhalten; bei Tod verlierst du, was du mitgenommen hast.</p><div id="custom-equipment-slots">${['weapon',...slots].map(slot=>`<div class="custom-equipment-row"><span class="custom-slot-icon">${slot==='weapon'?weaponSilhouette(WEAPONS[0].id):gearSilhouette(slot)}</span><label for="loadout-${slot}"><span>${esc(gearNames[slot]||slot)}</span><select id="loadout-${slot}" data-equip-slot="${slot}" aria-label="${esc(gearNames[slot]||slot)} für eigenes Loadout"></select></label>${slot==='weapon'?'<button id="edit-equipped-weapon" class="small-button" title="Eigene Waffe bearbeiten">BEARBEITEN ↗</button>':''}</div>`).join('')}</div><div class="custom-supplies"><label for="custom-medkits">MEDKITS <small>25 CR / STÜCK</small></label><select id="custom-medkits">${[0,1,2,3,4].map(n=>option(n,`${n} Medkits · ${n*25} CR`)).join('')}</select></div><div id="custom-stat-summary" class="custom-stat-summary"></div><p id="custom-loadout-error" class="armory-warning"></p><div class="custom-cost-line"><span>MUNITION + MEDKITS PRO RAID</span><strong id="custom-supply-cost">0 CR</strong></div></section><section class="owned-equipment armory-card"><header><div><span class="micro dim">SICHER IN DER BASIS</span><h3>DEIN BESTAND <small id="owned-count">0</small></h3></div><button data-armory-tab="shop" class="small-button">SHOP ↗</button></header><div class="owned-filter"><label for="owned-kind" class="sr-only">Bestand filtern</label><select id="owned-kind"><option value="all">Alle Ausrüstung</option value="weapon">Waffen</option><option value="attachment">Aufsätze</option><option value="equipment">Schutz & Rucksäcke</option></select></div><div id="owned-equipment-list" class="owned-equipment-list"></div><p class="armory-footnote">ANBIETEN öffnet den Markt. Du legst Preis und Laufzeit selbst fest.</p></section></div></section>
    <section id="armory-editor" class="armory-section" hidden><div class="editor-toolbar"><label for="editor-weapon"><span class="micro dim">DEINE WAFFENINSTANZ</span><select id="editor-weapon"></select></label><button id="equip-editor-weapon" class="small-button">IM LOADOUT EINPLANEN ↗</button><button data-armory-tab="shop" class="small-button">WAFFE KAUFEN ↗</button></div><div id="editor-empty" class="armory-empty"><span>◇</span><strong>DEINE WAFFENBANK WARTET.</strong><p>Kaufe eine eigene Waffe im Shop oder extrahiere einen Fund.<br>Fertige Kits werden hier nicht verändert.</p><button data-armory-tab="shop" class="secondary-button">ZUM WAFFENSHOP ↗</button></div><div id="editor-workspace" class="editor-workspace"><section class="weapon-inspection armory-card"><div class="editor-model-header"><div><span id="editor-category" class="micro orange"></span><h3 id="editor-weapon-name"></h3></div><span id="editor-build-state" class="editor-build-state">MONTIERT</span></div><div id="weapon-preview" class="weapon-preview" aria-label="Drehbare 3D-Vorschau der gewählten Waffe"><div class="preview-fallback" id="weapon-preview-fallback"></div></div><div class="weapon-preview-controls"><span id="editor-attachment-count" class="micro dim">0 / 6 AUFSÄTZE</span><div><button id="preview-left" class="small-button" aria-label="Waffe nach links drehen">↶ DREHEN</button><button id="preview-reset" class="small-button" aria-label="Waffenansicht zurücksetzen">RESET</button><button id="preview-right" class="small-button" aria-label="Waffe nach rechts drehen">DREHEN ↷</button></div></div><div class="editor-stat-heading"><span>WAFFENWERTE</span><span>MONTIERT → VORSCHAU</span></div><dl id="editor-stats" class="editor-stats"></dl><p class="armory-footnote">Waffenwerte ohne Operator-Skills. Grün verbessert den gewählten Wert; Orange markiert einen Nachteil.</p></section><section class="weapon-modifications armory-card"><header><div><span class="micro orange">ANPASSUNG / 6 SLOTS</span><h3>DEIN AUFBAU</h3></div></header><div class="attachment-slot-grid">${attachmentSlots.map(slot=>`<button data-attachment-slot="${esc(slot)}" aria-pressed="${slot===attachmentSlot}"><span>${esc(slotName(slot))}</span><strong data-slot-installed="${esc(slot)}">STANDARD</strong></button>`).join('')}</div><label class="armory-label" for="editor-attachment">PASSENDE AUFSÄTZE AUS DEINEM LAGER</label><select id="editor-attachment"></select><div id="attachment-detail" class="attachment-detail"></div><p id="attachment-compatibility" class="armory-copy"></p><div class="attachment-actions"><button id="mount-attachment" class="primary-button">MONTIEREN <span>↗</span></button><button id="unmount-attachment" class="secondary-button">ABMONTIEREN</button></div><button id="shop-compatible" class="text-button">PASSENDE AUFSÄTZE IM SHOP ↗</button><p class="armory-footnote">Montieren verwendet genau einen besessenen Aufsatz. Ausgewechselte Teile gehen zurück in dein Lager.</p></section></div></section>
    <section id="armory-shop" class="armory-section" hidden><div class="shop-filters"><label class="shop-search" for="shop-search"><span>⌕</span><input id="shop-search" type="search" placeholder="Waffe, Aufsatz oder Ausrüstung suchen …" aria-label="Shop durchsuchen" autocomplete="off"></label><select id="shop-kind" aria-label="Shop-Art"><option value="weapon">Waffen</option><option value="attachment">Aufsätze</option><option value="equipment">Schutz & Rucksäcke</option></select><select id="shop-category" aria-label="Shop-Kategorie"></select></div><label class="shop-compatible-toggle" id="shop-compatible-label" hidden><input type="checkbox" id="shop-compatible-only"><span id="shop-compatible-text">Nur kompatible Aufsätze für die gewählte eigene Waffe</span></label><div class="shop-workspace"><div id="shop-catalog-list" class="shop-catalog-list" aria-label="Shopangebote"></div><section id="shop-detail" class="shop-detail armory-card"><span id="shop-item-category" class="micro orange"></span><div id="shop-item-art"></div><h3 id="shop-item-name"></h3><p id="shop-item-description" class="armory-copy"></p><dl id="shop-item-stats" class="shop-item-stats"></dl><p id="shop-item-compatibility" class="armory-copy"></p><div class="shop-purchase-summary"><span id="shop-owned-count"></span><strong id="shop-item-price"></strong></div><button id="purchase-equipment" class="primary-button">KAUFEN & EINLAGERN <span>↗</span></button><p id="shop-purchase-note" class="armory-footnote">Du kaufst einen eigenen Gegenstand. Ausrüsten und Bearbeiten erfolgt anschließend in deinem Bestand.</p></section></div></section>`;

  function changeTab(next) {
    if(!['kits','loadout','editor','shop'].includes(next))return;
    tab=next;container.dataset.armoryTab=tab;
    for(const node of container.querySelectorAll('.armory-tabs [data-armory-tab]')){const selected=node.dataset.armoryTab===tab;node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));}
    for(const name of ['kits','loadout','editor','shop'])el(`armory-${name}`).hidden=name!==tab;
    render();syncPreview();
  }
  function statMarkup(weapon) {
    if(!weapon)return '';
    return [['SCHADEN',`${num(weapon.damage)}${weapon.pellets>1?` × ${weapon.pellets}`:''}`],['MAGAZIN',`${weapon.magSize} / ${weapon.reserve}`],['KADENZ',`${num(60/weapon.fireInterval)} / MIN`],['NACHLADEN',`${decimal(weapon.reloadSeconds)} S`],['REICHWEITE',`${num(weapon.range)} M`],['RÜCKSTOSS',`${decimal(weapon.recoilPitch*1000)} MRAD`]].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  }
  function gearStatsMarkup(stats) {
    return [['RUCKSACK',`${num(stats.capacity)} PLÄTZE`],['PANZERUNG',num(stats.maxArmor??stats.armor)],['SCHADENSMINDERUNG',`${num((stats.damageReduction??stats.protection??0)*100)} %`],['BEWEGUNG',`${num((stats.speedMultiplier??1)*100)} %`]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  }
  function renderKits() {
    setHTML(el('preset-kit-list'),PRESET_KITS.map(kit=>{
      const loadout=resolveLoadout(profile,{mode:'preset',presetId:kit.id}),weapon=loadout.weapon,chosen=profile.loadout?.mode==='preset'&&profile.loadout.presetId===kit.id;
      return `<article class="preset-kit-card${chosen?' selected':''}" data-kit-card="${esc(kit.id)}"><header><span class="micro">${kit.cost? 'EINSATZKIT':'RECOVERY / JEDERZEIT'}</span><span class="preset-fixed">FESTER AUFBAU</span></header>${weaponSilhouette(weapon?.id||kit.weapon)}<div class="preset-title"><h3>${esc(kit.name)}</h3><strong>${kit.cost?`${num(kit.cost)} CR`:'KOSTENLOS'}</strong></div><p>${esc(kit.description)}</p><div class="preset-weapon-name">${esc(weapon?.name||kit.weapon)} <span>${Object.values(weapon?.attachments||{}).map(id=>getAttachment(id)?.name).filter(Boolean).map(esc).join(' · ')||'STANDARD-AUFBAU'}</span></div><div class="preset-gear">${slots.map(slot=>`<span><small>${esc(gearNames[slot])}</small>${esc(loadout.equipment?.[slot]?.name||'OHNE')}</span>`).join('')}</div><div class="preset-summary"><span>${num(loadout.gearStats?.maxArmor)} PANZERUNG</span><span>${num(loadout.capacity??loadout.gearStats?.capacity)} PLÄTZE</span><span>${num(loadout.medkits)} MEDKITS</span></div><button data-preset-kit="${esc(kit.id)}" class="weapon-select" aria-pressed="${chosen}" ${context.locked?'disabled':''}><span>${chosen?'FÜR NÄCHSTEN RAID GEWÄHLT':'KIT WÄHLEN'}</span><b>${chosen?'✓':'↗'}</b></button></article>`;
    }).join(''));
  }
  function renderLoadout() {
    const custom=profile.loadout?.custom||{},items=owned(),selected=selectedIds();
    for(const slot of ['weapon',...slots]) {
      const choices=items.filter(item=>slot==='weapon'?item.kind==='weapon':item.kind==='equipment'&&getEquipment(item.catalogId)?.slot===slot),node=el(`loadout-${slot}`);
      const html=option('',slot==='weapon'?'Keine eigene Waffe ausgewählt':'Ohne Ausrüstung')+choices.map(item=>option(item.id,instanceLabel(item))).join('');
      if(node.innerHTML!==html)node.innerHTML=html;node.value=custom[slot]||'';node.disabled=!!context.locked;
    }
    el('custom-medkits').value=custom.medkits??2;el('custom-medkits').disabled=!!context.locked;
    const resolved=resolveLoadout(profile,{...profile.loadout,mode:'custom'});
    setHTML(el('custom-stat-summary'),gearStatsMarkup({...resolved.gearStats,maxArmor:resolved.gearStats?.maxArmor,capacity:resolved.capacity??resolved.gearStats?.capacity}));
    text('custom-supply-cost',`${num(resolved.cost)} CR`);text('custom-loadout-error',resolved.valid?'Eigene Ausrüstung wird beim Raidstart aus dem Lager mitgenommen.':resolved.reason||'Wähle zuerst eine eigene Waffe.');
    text('use-custom-loadout',profile.loadout?.mode==='custom'?'AKTIV ✓':'VERWENDEN ↗');el('use-custom-loadout').disabled=!!context.locked||!resolved.valid;
    el('edit-equipped-weapon').disabled=!custom.weapon;const filter=el('owned-kind').value;const filtered=items.filter(item=>filter==='all'||item.kind===filter);text('owned-count',items.length);
    setHTML(el('owned-equipment-list'),filtered.length?filtered.map(item=>`<article class="owned-item" data-owned-row="${esc(item.id)}"><span class="owned-item-symbol">${item.kind==='weapon'?'⌁':item.kind==='attachment'?'⊙':'◇'}</span><div><strong>${esc(item.name)}</strong><small>${selected.has(item.id)?'IM EIGENEN LOADOUT · ':''}${item.kind==='weapon'?`${countParts(item)} AUFSÄTZE`:item.kind==='attachment'?slotName(getAttachment(item.catalogId)?.slot):gearNames[getEquipment(item.catalogId)?.slot]||'AUSRÜSTUNG'} · ${esc(String(item.id).slice(-5).toUpperCase())}</small></div>${item.kind==='weapon'?`<button class="small-button" data-owned-item="${esc(item.id)}">BEARBEITEN</button>`:''}<button class="small-button" data-market-item="${esc(item.id)}"${context.locked?' disabled':''}>ANBIETEN ↗</button></article>`).join(''):'<div class="armory-empty"><span>▤</span><strong>NOCH KEINE EIGENE AUSRÜSTUNG.</strong><p>Im Shop kaufen oder aus der Zone bergen.</p><button data-armory-tab="shop" class="secondary-button">SHOP ÖFFNEN ↗</button></div>');
  }
  function editorBuild() {
    const item=currentWeapon();if(!item)return null;
    const attachments=attachmentIds(item),candidate=owned().find(item=>item.id===draftAttachment);
    if(candidate && canAttach(item.catalogId,candidate.catalogId))attachments[attachmentSlot]=candidate.catalogId;
    return {weapon:item.catalogId,attachments};
  }
  function renderEditor() {
    const weapons=owned().filter(item=>item.kind==='weapon');if(!weapons.some(item=>item.id===editorWeaponId))editorWeaponId=weapons.find(item=>item.id===profile.loadout?.custom?.weapon)?.id||weapons[0]?.id||'';
    const select=el('editor-weapon'),html=weapons.length?weapons.map(item=>option(item.id,instanceLabel(item))).join(''):option('','Keine eigene Waffe im Lager');if(select.innerHTML!==html)select.innerHTML=html;select.value=editorWeaponId;
    const item=currentWeapon();el('editor-empty').hidden=!!item;el('editor-workspace').hidden=!item;el('equip-editor-weapon').disabled=!item||!!context.locked;select.disabled=!item;
    if(!item)return;
    const weapon=getWeapon(item.catalogId),current=deriveWeapon(item.catalogId,attachmentIds(item));
    const choices=owned().filter(candidate=>candidate.kind==='attachment'&&getAttachment(candidate.catalogId)?.slot===attachmentSlot&&canAttach(item.catalogId,candidate.catalogId));
    if(!choices.some(candidate=>candidate.id===draftAttachment))draftAttachment='';
    const picker=el('editor-attachment'),choiceHTML=option('','Montierter Aufbau / keine Änderung')+choices.map(candidate=>option(candidate.id,instanceLabel(candidate))).join('');if(picker.innerHTML!==choiceHTML)picker.innerHTML=choiceHTML;picker.value=draftAttachment;picker.disabled=!!context.locked;
    text('editor-weapon-name',weapon.name);text('editor-category',weapon.category);text('editor-attachment-count',`${countParts(item)} / 6 AUFSÄTZE`);
    for(const button of container.querySelectorAll('[data-attachment-slot]')){const slot=button.dataset.attachmentSlot,installed=item.attachments?.[slot];button.classList.toggle('selected',slot===attachmentSlot);button.setAttribute('aria-pressed',String(slot===attachmentSlot));button.querySelector('strong').textContent=getAttachment(typeof installed==='string'?installed:installed?.catalogId)?.name||'STANDARD';}
    const candidate=owned().find(item=>item.id===draftAttachment),detail=candidate?getAttachment(candidate.catalogId):getAttachment(item.attachments?.[attachmentSlot]?.catalogId),proposed=deriveWeapon(item.catalogId,editorBuild().attachments);
    text('editor-build-state',candidate?'VORSCHAU · NOCH NICHT MONTIERT':'MONTIERTER AUFBAU');el('editor-build-state').classList.toggle('is-preview',!!candidate);
    setHTML(el('attachment-detail'),detail?`<span class="micro orange">${candidate?'AUS DEINEM LAGER':'MONTIERT'}</span><h4>${esc(detail.name)}</h4><p>${esc(detail.description)}</p>`:'<span class="micro dim">WERKSAUSFÜHRUNG</span><h4>STANDARD</h4><p>Wähle einen passenden Aufsatz aus deinem Lager, um seine Wirkung vor der Montage zu vergleichen.</p>');
    text('attachment-compatibility',choices.length?`${choices.length} passende ${choices.length===1?'Instanz':'Instanzen'} im Lager. Montage kostet keine zusätzlichen Credits.`:'Kein passender Aufsatz für diesen Slot im Lager. Im Shop findest du kompatible Teile.');
    el('mount-attachment').disabled=!!context.locked||!candidate;el('unmount-attachment').disabled=!!context.locked||!item.attachments?.[attachmentSlot];
    const values=[['damage','SCHADEN',false,1],['magSize','MAGAZIN',false,1],['reloadSeconds','NACHLADEN · S',true,1],['range','REICHWEITE · M',false,1],['recoilPitch','HOCHSCHLAG · MRAD',true,1000],['recoilYaw','SEITENRÜCKSTOSS · MRAD',true,1000],['spread','STREUUNG · MRAD',true,1000],['moveMultiplier','BEWEGUNG · %',false,100],['adsZoom','VISIER · VERGRÖSSERUNG',false,1],['adsSeconds','ANSCHLAG · S',true,1],['soundRadius','HÖRBARKEIT · M',true,1]];
    setHTML(el('editor-stats'),values.map(([key,label,lower,factor])=>{const a=Number(current[key]??(key==='adsZoom'?1:0))*factor,b=Number(proposed[key]??(key==='adsZoom'?1:0))*factor,delta=b-a;return`<div data-weapon-stat="${key}" class="${Math.abs(delta)<.00001?'':delta*(lower?-1:1)>0?'stat-better':'stat-worse'}"><dt>${label}</dt><dd><span>${decimal(a)}</span><b>→</b><strong>${decimal(b)}</strong></dd></div>`;}).join(''));
    setHTML(el('weapon-preview-fallback'),weaponSilhouette(weapon.id));
  }
  function syncPreview() {
    const build=editorBuild(),visible=!!context.visible&&tab==='editor'&&build&&!context.locked;
    if(!visible){preview?.dispose();preview=null;previewSignature='';return;}
    const next=JSON.stringify(build);if(next===previewSignature)return;
    try {if(!preview)preview=createWeaponPreview(el('weapon-preview'),build);else preview.update(build);previewSignature=next;el('weapon-preview-fallback').hidden=!!preview;}
    catch {previewSignature=next;el('weapon-preview-fallback').hidden=false;}
  }
  function shopCategory(item) {return item.kind==='weapon'?item.category:item.kind==='attachment'?slotName(item.slot):gearNames[item.slot]||item.slot;}
  function renderShop(resetCategories=false) {
    const kind=el('shop-kind').value,list=catalog.filter(item=>item.kind===kind),category=el('shop-category'),previous=category.value;
    const categories=[...new Set(list.map(shopCategory))];const html=option('all','Alle Kategorien')+categories.map(name=>option(name,name)).join('');if(resetCategories||category.innerHTML!==html){category.innerHTML=html;category.value=categories.includes(previous)?previous:'all';}
    el('shop-compatible-label').hidden=kind!=='attachment'||!currentWeapon();text('shop-compatible-text',`Nur kompatibel mit ${getWeapon(currentWeapon()?.catalogId)?.name||'deiner eigenen Waffe'}`);
    const compatibleOnly=kind==='attachment'&&el('shop-compatible-only').checked&&currentWeapon();
    const terms=normalize(el('shop-search').value).split(/\s+/).filter(Boolean),filtered=list.filter(item=>(!compatibleOnly||canAttach(currentWeapon().catalogId,item.id))&&(category.value==='all'||shopCategory(item)===category.value)&&terms.every(term=>normalize(`${item.name} ${item.description} ${shopCategory(item)}`).includes(term)));
    if(!filtered.some(item=>item.id===shopId))shopId=filtered[0]?.id||'';
    setHTML(el('shop-catalog-list'),filtered.length?filtered.map(item=>`<button data-shop-item="${esc(item.id)}" class="shop-catalog-item${shopId===item.id?' selected':''}" aria-pressed="${shopId===item.id}"><span class="shop-catalog-image">${image(item)}</span><span><strong>${esc(item.name)}</strong><small>${esc(shopCategory(item))}</small></span><span class="shop-catalog-price">${num(price(item))} CR<small>${owned().filter(owned=>owned.catalogId===item.id).length} IM LAGER</small></span></button>`).join(''):'<div class="armory-empty"><span>⌕</span><strong>KEINE TREFFER.</strong><p>Ändere Kategorie oder Suchbegriff.</p></div>');
    const item=catalogById.get(shopId);el('shop-detail').hidden=!item;if(!item)return;
    text('shop-item-category',shopCategory(item));text('shop-item-name',item.name);text('shop-item-description',item.description);setHTML(el('shop-item-art'),image(item));
    setHTML(el('shop-item-stats'),item.kind==='weapon'?statMarkup(item):item.kind==='equipment'?gearStatsMarkup(item):modifierMarkup(item));
    text('shop-item-compatibility',item.kind==='attachment'?`Kompatibel mit ${WEAPONS.filter(weapon=>canAttach(weapon.id,item.id)).length} Waffen. ${currentWeapon()?canAttach(currentWeapon().catalogId,item.id)?`Passt auf deine ${getWeapon(currentWeapon().catalogId).name}.`:`Passt nicht auf deine ${getWeapon(currentWeapon().catalogId).name}.`:''}`:item.kind==='weapon'?'Eigene Waffe: Aufsätze lassen sich nach dem Kauf an der Waffenbank montieren.':'Eigene Ausrüstung: dem Loadout zuweisen oder als Reserve im Lager behalten.');
    text('shop-owned-count',`${owned().filter(owned=>owned.catalogId===item.id).length} IM LAGER`);text('shop-item-price',`${num(price(item))} CR`);
    el('purchase-equipment').disabled=!!context.locked||Number(profile.credits||0)<price(item);
    text('shop-purchase-note',context.locked?'Im Koop festgelegt. Verlasse die Lobby, um Ausrüstung zu kaufen.':Number(profile.credits||0)<price(item)?`Es fehlen ${num(price(item)-Number(profile.credits||0))} CR für diesen Kauf.`:'Du kaufst einen eigenen Gegenstand. Ausrüsten und Bearbeiten erfolgt anschließend in deinem Bestand.');
  }
  function render() {
    const active=resolveLoadout(profile);text('armory-equipped',active.selection?.mode==='custom'?'EIGENES LOADOUT':PRESET_KITS.find(kit=>kit.id===active.selection?.presetId)?.name||'SCOUT');text('armory-cost',`${num(active.cost)} CR BEIM RAIDSTART`);el('armory-lock-note').hidden=!context.locked;
    if(tab==='kits')renderKits();if(tab==='loadout')renderLoadout();if(tab==='editor')renderEditor();if(tab==='shop')renderShop();
  }
  function onInput(event) {
    const node=event.target;
    if(node.dataset.equipSlot){if(!context.locked)actions.equipLoadout?.(node.dataset.equipSlot,node.value||null);renderLoadout();}
    else if(node.id==='custom-medkits'){if(!context.locked)actions.setLoadoutMedkits?.(Number(node.value));renderLoadout();}
    else if(node.id==='owned-kind')renderLoadout();
    else if(node.id==='editor-weapon'){editorWeaponId=node.value;draftAttachment='';renderEditor();syncPreview();}
    else if(node.id==='editor-attachment'){draftAttachment=node.value;renderEditor();syncPreview();}
    else if(['shop-search','shop-kind','shop-category','shop-compatible-only'].includes(node.id))renderShop(node.id==='shop-kind');
  }
  function onClick(event) {
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.armoryTab){changeTab(button.dataset.armoryTab);return;}
    if(button.dataset.shopItem){shopId=button.dataset.shopItem;renderShop();return;}
    if(button.dataset.attachmentSlot){attachmentSlot=button.dataset.attachmentSlot;draftAttachment='';renderEditor();syncPreview();return;}
    if(button.dataset.ownedItem){editorWeaponId=button.dataset.ownedItem;draftAttachment='';changeTab('editor');return;}
    if(button.id==='edit-equipped-weapon'){editorWeaponId=profile.loadout?.custom?.weapon;draftAttachment='';changeTab('editor');return;}
    if(button.id==='preview-left')return preview?.rotate(-.3);
    if(button.id==='preview-right')return preview?.rotate(.3);
    if(button.id==='preview-reset')return preview?.reset();
    if(button.id==='shop-compatible'){el('shop-kind').value='attachment';el('shop-search').value='';el('shop-compatible-only').checked=true;changeTab('shop');el('shop-category').value=slotName(attachmentSlot);renderShop();return;}
    if(context.locked)return;
    if(button.dataset.presetKit)actions.selectLoadout?.({mode:'preset',presetId:button.dataset.presetKit});
    if(button.id==='use-custom-loadout')actions.selectLoadout?.({mode:'custom'});
    if(button.id==='equip-editor-weapon')actions.equipLoadout?.('weapon',editorWeaponId);
    if(button.id==='purchase-equipment'&&shopId)actions.purchaseEquipment?.(shopId);
    if(button.id==='mount-attachment'){actions.mountAttachment?.(editorWeaponId,attachmentSlot,draftAttachment);draftAttachment='';}
    if(button.id==='unmount-attachment'){actions.mountAttachment?.(editorWeaponId,attachmentSlot,null);draftAttachment='';}
  }
  container.addEventListener('input',onInput);container.addEventListener('click',onClick);
  return {update(nextProfile,nextContext={}){profile=nextProfile||{};context=nextContext;const next=JSON.stringify([profile.loadout,profile.stash,profile.credits,context.locked]);if(signature!==next){signature=next;render();}syncPreview();},open(next='kits'){changeTab(next);},dispose(){preview?.dispose();container.removeEventListener('input',onInput);container.removeEventListener('click',onClick);}};
}
