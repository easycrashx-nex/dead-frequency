import { SETTINGS_CATEGORIES, SETTINGS_FIELDS, BINDING_ACTIONS, defaultSettings, resetSettingsCategory, formatSetting, keyLabel } from './settings.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const searchable = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('ß', 'ss').toLowerCase();
const categoryLabel = id => SETTINGS_CATEGORIES.find(category => category.id === id)?.label || id;
const countFor = id => id === 'tasten' ? BINDING_ACTIONS.length : SETTINGS_FIELDS.filter(field => field.category === id).length;
const markup = field => {
  const id = `setting-${field.key}`, description = `setting-description-${field.key}`;
  const common = `id="${id}" data-setting="${field.key}" aria-describedby="${description}"`;
  const control = field.type === 'range'
    ? `<div class="settings-range-control"><output id="${field.key}-output" for="${id}"></output><input ${common} type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${field.default}"></div>`
    : field.type === 'select'
      ? `<select ${common}>${field.options.map(option => `<option value="${escapeHTML(option.value)}">${escapeHTML(option.label)}</option>`).join('')}</select>`
      : `<div class="settings-toggle-control"><output id="${field.key}-output" for="${id}"></output><input ${common} type="checkbox" role="switch" class="settings-toggle"></div>`;
  return `<div class="settings-field" data-settings-row="${field.key}" data-search="${escapeHTML(searchable(`${categoryLabel(field.category)} ${field.label} ${field.description}`))}"><div class="settings-field-copy"><label for="${id}">${escapeHTML(field.label)}<span class="setting-modified" title="Vom Standard abweichend" aria-hidden="true"></span></label><p id="${description}">${escapeHTML(field.description)}</p></div><div class="settings-field-control">${control}</div></div>`;
};

export function createSettingsUI(container, actions) {
  let values = defaultSettings(), category = SETTINGS_CATEGORIES[0].id, open = false;
  let capture = null, resetArmed = false, resetTimer, savedTimer, signature = '';
  container.innerHTML = `
    <div class="settings-searchbar"><label class="settings-search" for="settings-search"><span aria-hidden="true">⌕</span><input id="settings-search" type="search" placeholder="Einstellungen suchen …" autocomplete="off" spellcheck="false" aria-label="Alle Einstellungen durchsuchen"><kbd>/</kbd></label><span id="settings-total" class="settings-count">${SETTINGS_FIELDS.length + BINDING_ACTIONS.length} OPTIONEN</span></div>
    <div class="settings-workspace"><aside class="settings-sidebar"><nav class="settings-categories" aria-label="Einstellungskategorien">${SETTINGS_CATEGORIES.map((item, index) => `<button type="button" data-settings-category="${item.id}" aria-pressed="${item.id === category}"><span class="settings-category-number">0${index + 1}</span><span>${escapeHTML(item.label)}</span><small data-category-count="${item.id}">${countFor(item.id)}</small></button>`).join('')}</nav>
      <div class="settings-preview-block"><div class="settings-preview-heading"><span>LIVE-VORSCHAU</span><span>07</span></div><div class="settings-preview" role="img" aria-label="Live-Vorschau von HUD und Fadenkreuz mit Beispielwerten"><div class="preview-terrain"><i></i><i></i><i></i></div><span class="preview-compass">NW <b>N</b> NO</span><span class="preview-teammate">◇ ECHO</span><span class="preview-fps">60 FPS</span><div class="preview-vitals"><b>+ 100</b><i></i></div><div class="preview-ammo"><b>30</b><small> / 90</small></div><div class="crosshair preview-crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div><span class="preview-prompt"><kbd data-preview-interact>E</kbd> AUFNEHMEN</span><span class="preview-hit">×</span><div class="preview-damage"></div></div><p>HUD & Fadenkreuz · Beispielwerte</p></div>
    </aside><div class="settings-main"><div class="settings-section-heading"><div><span class="micro orange" id="settings-section-index">PROFIL / 01</span><h3 id="settings-category-title"></h3><p id="settings-category-description"></p></div><span id="settings-modified-count"></span></div><p id="binding-capture-note" class="binding-capture-note" role="status" hidden></p><div class="settings-scroll" id="settings-scroll" tabindex="-1">
      ${SETTINGS_CATEGORIES.map(item => `<section class="settings-category-section" data-settings-section="${item.id}" aria-label="${escapeHTML(item.label)}"><h4 class="settings-result-heading">${escapeHTML(item.label)}</h4>${item.id === 'tasten' ? `<p class="binding-intro">Aktion wählen und die gewünschte Taste drücken. <kbd>Esc</kbd> bricht die Eingabe ab. Belegte Tasten bleiben geschützt.</p>${BINDING_ACTIONS.map(action => `<div class="settings-field binding-field" data-settings-row="binding-${action.key}" data-search="${escapeHTML(searchable(`Tasten Tastatur Tastenbelegung ${action.label}`))}"><div class="settings-field-copy"><label for="setting-binding-${action.key}">${escapeHTML(action.label)}<span class="setting-modified" title="Vom Standard abweichend" aria-hidden="true"></span></label><p>Standard: ${escapeHTML(keyLabel(action.default))}</p></div><button type="button" id="setting-binding-${action.key}" class="binding-button" data-rebind="${action.key}" aria-label="${escapeHTML(action.label)} neu belegen"><kbd></kbd><span aria-hidden="true">↗</span></button></div>`).join('')}<p class="binding-fixed-note">Maus: links feuern, rechts zielen. <kbd>Esc</kbd> Menü, <kbd>F11</kbd> Vollbild bleiben fest belegt.</p>` : SETTINGS_FIELDS.filter(field => field.category === item.id).map(markup).join('')}</section>`).join('')}
      <div id="settings-empty" class="settings-empty" hidden><span>⌕</span><strong>KEINE EINSTELLUNG GEFUNDEN</strong><p>Versuche einen Begriff wie „Schatten“, „Maus“ oder „Fadenkreuz“.</p><button type="button" data-clear-settings-search class="small-button">SUCHE LEEREN</button></div>
    </div></div></div>
    <footer class="settings-footer"><div class="settings-save-state"><i></i><span id="settings-save-status" role="status">Wird automatisch gespeichert</span></div><div class="settings-reset-actions"><button type="button" class="text-button" id="reset-settings-category" data-reset-settings="category">KATEGORIE ZURÜCKSETZEN</button><button type="button" class="text-button" id="reset-settings-all" data-reset-settings="all">ALLES ZURÜCKSETZEN</button><button type="button" class="secondary-button settings-done" data-action="close-utility">FERTIG <span>↗</span></button></div></footer>`;

  const el = selector => container.querySelector(selector);
  const search = el('#settings-search'), scroll = el('#settings-scroll');
  const fieldNodes = new Map(SETTINGS_FIELDS.map(field => [field.key, { input: el(`#setting-${field.key}`), output: el(`#${field.key}-output`), row: el(`[data-settings-row="${field.key}"]`) }]));
  const bindingNodes = new Map(BINDING_ACTIONS.map(action => [action.key, el(`[data-rebind="${action.key}"]`)]));
  const sections = [...container.querySelectorAll('[data-settings-section]')];
  const rows = [...container.querySelectorAll('[data-settings-row]')];
  const categoryButtons = [...container.querySelectorAll('[data-settings-category]')];
  const preview = el('.settings-preview');
  const text = (selector, value) => { const node = el(selector); if (node.textContent !== value) node.textContent = value; };

  function saved(message = 'Änderungen gespeichert') {
    clearTimeout(savedTimer);
    text('#settings-save-status', message);
    savedTimer = setTimeout(() => text('#settings-save-status', 'Wird automatisch gespeichert'), 2400);
  }
  function disarmReset() {
    resetArmed = false; clearTimeout(resetTimer);
    text('#reset-settings-all', 'ALLES ZURÜCKSETZEN'); el('#reset-settings-all').classList.remove('armed');
  }
  function stopCapture(message = '') {
    if (capture) bindingNodes.get(capture).classList.remove('capturing');
    capture = null;
    const note = el('#binding-capture-note'); note.hidden = !message; note.textContent = message; note.classList.remove('binding-error');
    updateBindingLabels();
  }
  function updateBindingLabels() {
    for (const action of BINDING_ACTIONS) {
      const button = bindingNodes.get(action.key);
      button.querySelector('kbd').textContent = capture === action.key ? 'TASTE DRÜCKEN …' : keyLabel(values.bindings[action.key]);
      button.setAttribute('aria-label', `${action.label}: ${keyLabel(values.bindings[action.key])}. Taste ändern.`);
      button.closest('[data-settings-row]').classList.toggle('is-modified', values.bindings[action.key] !== action.default);
    }
  }
  function filter() {
    const query = searchable(search.value.trim()), terms = query.split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const section of sections) {
      let count = 0;
      for (const row of section.querySelectorAll('[data-settings-row]')) {
        const match = !query || terms.every(term => row.dataset.search.includes(term));
        row.hidden = !match; if (match) count++;
      }
      section.hidden = query ? count === 0 : section.dataset.settingsSection !== category;
      if (query || section.dataset.settingsSection === category) matches += count;
      el(`[data-category-count="${section.dataset.settingsSection}"]`).textContent = count;
    }
    container.classList.toggle('settings-searching', !!query);
    for (const button of categoryButtons) {
      const active = !query && button.dataset.settingsCategory === category;
      button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
    }
    const selected = SETTINGS_CATEGORIES.find(item => item.id === category);
    text('#settings-section-index', query ? 'PROFIL / SUCHE' : `PROFIL / 0${SETTINGS_CATEGORIES.indexOf(selected) + 1}`);
    text('#settings-category-title', query ? 'Suchergebnisse' : selected.label);
    text('#settings-category-description', query ? `${matches} ${matches === 1 ? 'passende Einstellung' : 'passende Einstellungen'} in allen Kategorien.` : selected.description);
    el('#settings-empty').hidden = matches > 0;
    el('#reset-settings-category').hidden = !!query;
    el('#reset-settings-category').title = `${selected.label} auf Standardwerte zurücksetzen`;
    const modified = rows.filter(row => !row.hidden && !row.parentElement.hidden && row.classList.contains('is-modified')).length;
    text('#settings-modified-count', modified ? `${modified} ANGEPASST` : 'STANDARDPROFIL');
  }
  function updatePreview() {
    preview.style.setProperty('--preview-hud-scale', values.hudScale);
    preview.style.setProperty('--preview-hud-opacity', values.hudOpacity);
    preview.style.setProperty('--crosshair-color', values.crosshairColor);
    preview.style.setProperty('--crosshair-size', values.crosshairSize);
    preview.style.setProperty('--crosshair-opacity', values.crosshairOpacity);
    for (const [selector, key] of [['.preview-crosshair','crosshair'],['.preview-compass','compass'],['.preview-teammate','teammateHud'],['.preview-prompt','prompts'],['.preview-fps','fps'],['.preview-hit','hitMarker'],['.preview-damage','damageVignette']]) el(selector).hidden = !values[key];
    text('[data-preview-interact]', keyLabel(values.bindings.interact));
  }
  function update(settings = {}) {
    const next = { ...defaultSettings(), ...settings, bindings: { ...defaultSettings().bindings, ...settings.bindings } };
    const nextSignature = JSON.stringify(next);
    if (signature === nextSignature) return;
    signature = nextSignature; values = next;
    for (const field of SETTINGS_FIELDS) {
      const { input, output, row } = fieldNodes.get(field.key), value = values[field.key];
      if (field.type === 'toggle') input.checked = value;
      else if (document.activeElement !== input) input.value = value;
      if (output) output.textContent = formatSetting(field.key, value);
      if (field.type === 'range') {
        input.setAttribute('aria-valuetext', formatSetting(field.key, value));
        input.style.setProperty('--range-fill', `${(value - field.min) / (field.max - field.min) * 100}%`);
      }
      row.classList.toggle('is-modified', value !== field.default);
    }
    updateBindingLabels(); updatePreview(); filter();
  }
  function changeCategory(id) {
    if (!SETTINGS_CATEGORIES.some(item => item.id === id)) return;
    category = id; search.value = ''; stopCapture(); disarmReset(); filter(); scroll.scrollTop = 0;
  }
  function onInput(event) {
    if (event.target === search) { stopCapture(); filter(); scroll.scrollTop = 0; return; }
    const field = SETTINGS_FIELDS.find(field => field.key === event.target.dataset.setting);
    if (!field) return;
    const value = field.type === 'toggle' ? event.target.checked : field.type === 'range' ? Number(event.target.value) : field.options.find(option => String(option.value) === event.target.value)?.value;
    actions.settings({ [field.key]: value });
    update({ ...values, [field.key]: value }); disarmReset(); saved();
  }
  function onClick(event) {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.settingsCategory) { event.stopPropagation(); changeCategory(button.dataset.settingsCategory); }
    else if (button.hasAttribute('data-clear-settings-search')) { search.value = ''; filter(); search.focus(); }
    else if (button.dataset.rebind) {
      event.stopPropagation(); stopCapture(); disarmReset(); capture = button.dataset.rebind;
      button.classList.add('capturing'); button.focus({ preventScroll: true }); updateBindingLabels();
      const note = el('#binding-capture-note'); note.hidden = false;
      note.textContent = `Taste für „${BINDING_ACTIONS.find(action => action.key === capture).label}“ drücken. Esc bricht ab.`;
    } else if (button.dataset.resetSettings) {
      event.stopPropagation(); stopCapture();
      if (button.dataset.resetSettings === 'all' && !resetArmed) {
        resetArmed = true; button.classList.add('armed'); button.textContent = 'WIRKLICH ALLES ZURÜCKSETZEN?';
        saved('Erneut klicken: alle Werte und Tasten zurücksetzen.');
        resetTimer = setTimeout(disarmReset, 6000); return;
      }
      const scope = button.dataset.resetSettings === 'all' ? 'all' : category;
      actions.resetSettings(scope); update(resetSettingsCategory(values, scope)); disarmReset(); saved(scope === 'all' ? 'Alle Standardwerte gespeichert' : 'Kategorie zurückgesetzt');
    }
  }
  function onFocus(event) { if (capture && event.target !== bindingNodes.get(capture)) stopCapture(); }
  function handleKey(event) {
    if (!open) return false;
    if (capture) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') { stopCapture(); return true; }
      if (event.repeat || event.isComposing) return true;
      const action = capture, result = actions.rebind(action, event.code);
      if (result?.ok) {
        update({ ...values, bindings: { ...values.bindings, [action]: event.code } });
        stopCapture(); saved(`${keyLabel(event.code)} gespeichert`); filter();
      } else {
        const note = el('#binding-capture-note'); note.hidden = false; note.classList.add('binding-error');
        note.textContent = result?.error || 'Diese Taste kann nicht belegt werden.';
      }
      return true;
    }
    if (event.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) { event.preventDefault(); event.stopImmediatePropagation(); search.focus(); return true; }
    return false;
  }
  container.addEventListener('input', onInput); container.addEventListener('click', onClick); container.addEventListener('focusin', onFocus);
  update(values);
  return {
    update, handleKey, isCapturingBinding: () => !!capture,
    open() { open = true; filter(); },
    close() { open = false; stopCapture(); disarmReset(); },
    dispose() { clearTimeout(resetTimer); clearTimeout(savedTimer); container.removeEventListener('input', onInput); container.removeEventListener('click', onClick); container.removeEventListener('focusin', onFocus); }
  };
}
