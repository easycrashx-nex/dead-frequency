import { WEAPONS, getWeapon } from './weapons.js';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Math.round(value || 0).toLocaleString('de-DE');
const silhouettes = {
  'VX-9': '<path d="M35 38h43l14 9h81v-5h15v9h45v10h-45l-8 10h-40l8 30h-18l-14-30h-15l-9 21H76l9-30H63L35 61z"/><path d="M147 71h22l-3 31h-21z"/><path d="M100 38h47v5h-47z"/>',
  'AR-4': '<path d="M18 40h37l26 13h44v-7h38l12 5h64v-6h8v8h42v6h13v8h-58l-6 6h-65l-6 10-22-3 8 22h-18l-15-28H86l-19 20H50l12-24-44-3z"/><path d="m148 80 20 1-4 30-22-4z"/><path d="M106 36h40v9h-8v-4h-23v4h-9z"/>',
  'BR-12': '<path d="M28 42h87l21-11h31l21 13h44v9h55v8h-55v13h-70l-8 30h-16l-9-30H40L28 66z"/><path d="M64 73h24l5 35H65z"/><path d="M127 40h50v5h-50z"/><path d="M181 36h24v8h-24z"/>',
  'SG-8': '<path d="M19 55 69 40h66l15 8h123v-5h8v7h24v7H150v8H96L72 90H56l13-27-50 13z"/><path d="M148 59h119v8H148z"/><path d="M174 60h54v17h-54z"/><path d="m111 63 17 3-5 28h-18z"/>',
  'DMR-7': '<path d="M17 46h46l29 10h67l13-9h73v6h57v7h-57v10h-82l-8 9-26-2-6 20h-17l5-24H78L51 91H29l22-23-34-4z"/><path d="M143 77h22v22h-22z"/><path d="M112 31h54v10h-54zM106 28h9v16h-9zM163 27h13v18h-13zM128 41h5v13h-5zM151 41h5v13h-5z"/>',
  'SR-90': '<path d="M16 51h53l25 6h73l13-8h62v6h62v7h-62v7h-96l-19 8-11 22H98l7-25H71L36 95H18l25-26H16z"/><path d="M103 28h83v11h-83zM94 25h12v18H94zM185 22h17v23h-17zM123 40h6v15h-6zM173 40h6v15h-6z"/><path d="m155 57 16 11 1 13h-6l-3-10-15-9z"/><circle cx="170" cy="84" r="6"/>',
  'MG-60': '<path d="M15 44h40l24 12h47l10-14h53v8h56v6h52v8h-54v10h-56l-8 10h-25l-13-7h-17l-8 25h-20l5-27H72L53 90H34l17-22-36-3z"/><path d="M139 74h43v34h-43zM148 36h42v9h-42z"/><path d="m238 71 5-2 18 39h-6zm-4 0 5 2-18 35h-6z"/>',
  'RV-6': '<path d="M90 51h25l8-12h39l15 6h60v-5h8v8h15v14h-84l-7 14h-30l-5 13-20 24H89l10-27-11-17z"/><circle cx="143" cy="58" r="21"/><path d="m112 42 6-15h8v16zM115 77h20l-5 12h-13z"/><circle cx="133" cy="51" r="4" fill="var(--weapon-cutout,#15251d)"/><circle cx="151" cy="51" r="4" fill="var(--weapon-cutout,#15251d)"/><circle cx="143" cy="67" r="4" fill="var(--weapon-cutout,#15251d)"/>',
};
export function weaponSilhouette(id) {
  return `<svg class="weapon-silhouette" viewBox="0 0 320 122" aria-hidden="true" data-silhouette="${escapeHTML(id)}"><g fill="currentColor">${silhouettes[id] || silhouettes['VX-9']}</g></svg>`;
}
export function createArmoryUI(container, actions) {
  container.innerHTML = `<header class="feature-heading"><div><span class="eyebrow"><span class="orange-dash"></span> BLACKLINE / WAFFENKAMMER</span><h2>DEIN ARSENAL<span class="orange">.</span></h2><p>Acht Waffen. Acht Spielweisen. Die Kosten fallen erst beim Raidstart an.</p></div><div class="feature-status"><span class="micro dim">GEWÄHLTE PRIMÄRWAFFE</span><strong id="armory-equipped">VX-9</strong></div></header><p id="armory-lock-note" class="loadout-lock-note" hidden>Waffe und Skills wurden beim Koop-Beitritt festgelegt. Verlasse die Lobby, um sie zu ändern.</p><div class="armory-grid" aria-label="Verfügbare Waffen">${WEAPONS.map((weapon,index) => `<article class="weapon-card" data-weapon-card="${escapeHTML(weapon.id)}"><div class="weapon-card-heading"><span class="tiny">${String(index+1).padStart(2,'0')} / ${escapeHTML(weapon.category)}</span><span class="weapon-selected-mark" aria-hidden="true">✓</span></div>${weaponSilhouette(weapon.id)}<div class="weapon-card-title"><h3>${escapeHTML(weapon.name)}</h3><span class="weapon-price">${weapon.cost ? `${number(weapon.cost)} <small>CR</small>` : 'KOSTENLOS'}</span></div><p class="weapon-description">${escapeHTML(weapon.description)}</p><dl class="weapon-stats"><div><dt>SCHADEN${weapon.pellets > 1 ? ' / SCHROT' : ''}</dt><dd>${weapon.damage}${weapon.pellets > 1 ? ` × ${weapon.pellets}` : ''}</dd></div><div><dt>MAGAZIN / RESERVE</dt><dd>${weapon.magSize} / ${weapon.reserve}</dd></div><div><dt>KADENZ / MIN</dt><dd>${number(60/weapon.fireInterval)}</dd></div><div><dt>NACHLADEN</dt><dd>${weapon.reloadSeconds.toLocaleString('de-DE')} <small>S</small></dd></div><div><dt>REICHWEITE</dt><dd>${number(weapon.range)} <small>M</small></dd></div><div><dt>FEUERMODUS</dt><dd class="weapon-firemode">${weapon.automatic ? 'AUTOMATIK' : weapon.pellets > 1 ? 'PUMPAKTION' : weapon.id === 'SR-90' ? 'REPETIERER' : 'EINZELFEUER'}</dd></div></dl><button class="weapon-select" data-select-weapon="${escapeHTML(weapon.id)}" aria-label="${escapeHTML(weapon.name)} auswählen"><span>WAFFE WÄHLEN</span><b>↗</b></button></article>`).join('')}</div><p class="feature-footnote">Basiswerte ohne Skills. Dein Schutz-Kit wählst du unter Einsatz. Bei Tod gehen Kit und Waffe verloren.</p>`;
  const cards = [...container.querySelectorAll('[data-weapon-card]')];
  let selected = '', locked = false, explicit = false;
  const click = event => { const button = event.target.closest('[data-select-weapon]'); if (button && !button.disabled && !locked) actions.selectWeapon?.(button.dataset.selectWeapon); };
  container.addEventListener('click', click);
  return { update(profile, context = {}) {
    const current = (getWeapon(context.weapon || profile.selectedWeapon) || WEAPONS[0]).id;
    const chosenExplicitly = profile.selectedWeapon === current;
    if (selected === current && locked === !!context.locked && explicit === chosenExplicitly) return;
    selected = current; locked = !!context.locked; explicit = chosenExplicitly;
    container.querySelector('#armory-equipped').textContent = getWeapon(current).name;
    container.querySelector('#armory-lock-note').hidden = !locked;
    for (const card of cards) {
      const chosen = card.dataset.weaponCard === current, button = card.querySelector('[data-select-weapon]');
      card.classList.toggle('selected', chosen); button.disabled = locked || (chosen && explicit); button.setAttribute('aria-pressed', String(chosen));
      button.querySelector('span').textContent = locked ? 'IM KOOP FESTGELEGT' : chosen && explicit ? 'AUSGEWÄHLT' : chosen ? 'WAFFE FESTLEGEN' : 'WAFFE WÄHLEN';
    }
  }, dispose() { container.removeEventListener('click', click); } };
}
