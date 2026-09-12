import { getWeapon } from './weapons.js';
import { createLoadoutUI } from './loadout-ui.js';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Math.round(value || 0).toLocaleString('de-DE');
const silhouettes = {
  pistol: '<path d="M85 36h132v26h-68l-14 49h-34l10-49H85z"/><path d="M143 66h24v23h-30v-7h22v-9h-18z"/><path d="M95 30h10v6H95zM203 30h9v6h-9z"/>',
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
  return `<svg class="weapon-silhouette" viewBox="0 0 320 122" aria-hidden="true" data-silhouette="${escapeHTML(id)}"><g fill="currentColor">${silhouettes[id] || silhouettes[({smg:'VX-9',assault:'AR-4',bullpup:'BR-12',shotgun:'SG-8',marksman:'DMR-7',sniper:'SR-90',machinegun:'MG-60',revolver:'RV-6',pistol:'pistol'})[getWeapon(id)?.model]] || silhouettes['VX-9']}</g></svg>`;
}
export function createArmoryUI(container, actions) {
  return createLoadoutUI(container, actions, {weaponSilhouette});
}
