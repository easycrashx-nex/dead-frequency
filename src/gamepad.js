// Canonical indices: https://www.w3.org/TR/gamepad/#remapping
// Raw Sony layouts differ between transports/OS drivers. Only browser-confirmed
// standard mappings are actionable; a family override changes prompts, not axes.
const PRESSED = {
  fire: [7], aim: [6], jump: [0], confirm: [0], crouch: [1, 11], back: [1],
  reload: [2], interact: [3], heal: [4], inventory: [5], map: [8], pause: [9],
  sprint: [10], tabPrev: [4], tabNext: [5],
};
const HELD = { fire: [7], aim: [6], sprint: [10], crouch: [1, 11] };
const FAMILIES = ['xbox', 'playstation', 'generic'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const setting = (settings, key, fallback, min, max) => clamp(finite(settings[key], fallback), min, max);

export function detectGamepadFamily(id = '') {
  const name = String(id).toLowerCase();
  if (/dual\s*shock|dual\s*sense|playstation|\bsony\b|(?:vendor[:= ]*|vid[_: ]*|\b)054c\b/.test(name)) return 'playstation';
  if (/xbox|xinput|x-input|(?:vendor[:= ]*|vid[_: ]*|\b)045e\b/.test(name)) return 'xbox';
  return 'generic';
}

function displayName(id, family) {
  if (family === 'playstation') {
    if (/dual\s*sense/i.test(id)) return 'PlayStation DualSense';
    if (/dual\s*shock/i.test(id)) return 'PlayStation DualShock';
    return 'PlayStation-Controller';
  }
  return family === 'xbox' ? 'Xbox-Controller' : 'Standard-Controller';
}

function stick(axes, offset, deadzone, response = 1) {
  const x = clamp(finite(axes?.[offset]), -1, 1), y = clamp(finite(axes?.[offset + 1]), -1, 1);
  const length = Math.hypot(x, y);
  if (length <= deadzone) return { x: 0, y: 0 };
  const magnitude = Math.pow((Math.min(length, 1) - deadzone) / (1 - deadzone), response);
  return { x: x / length * magnitude, y: y / length * magnitude };
}

function buttonValue(button) {
  if (typeof button === 'number') return clamp(finite(button), 0, 1);
  return button?.pressed === true ? Math.max(.5, clamp(finite(button.value), 0, 1)) : clamp(finite(button?.value), 0, 1);
}

function idleActions(mapping) {
  return Object.fromEntries(Object.keys(mapping).map(action => [action, false]));
}

function output(pad, settings, blocked = true) {
  const detectedFamily = detectGamepadFamily(pad?.id);
  const family = FAMILIES.includes(settings.controllerPrompts) ? settings.controllerPrompts : detectedFamily;
  return {
    connected: !!pad, index: pad?.index ?? -1, id: pad?.id ?? '',
    name: pad ? displayName(pad.id, detectedFamily) : 'Kein Controller',
    family, detectedFamily, supported: pad?.mapping === 'standard',
    enabled: settings.controllerEnabled !== false, blocked, activity: false,
    moveX: 0, moveY: 0, lookX: 0, lookY: 0,
    held: idleActions(HELD), pressed: idleActions(PRESSED), menu: { x: 0, y: 0 },
  };
}

/** Poll browser Gamepad snapshots; no listeners, navigator access, or sim clock.
 * moveY is forward-positive. lookY/menu.y are down-positive; lookY incorporates
 * controllerInvertY. Angular speed, ADS scaling and menu repeat belong to callers.
 */
export function createGamepadInput() {
  const records = new Map();
  let activeKey = null, activePad = null, vibrationEnabled = true;

  function stopRumble() {
    try { Promise.resolve(activePad?.vibrationActuator?.reset?.()).catch(() => {}); } catch { /* Optional hardware. */ }
  }

  function reset() {
    for (const record of records.values()) record.blocked = true;
    stopRumble();
  }

  function poll(pads = [], settings = {}, _dt = 0) {
    settings = settings && typeof settings === 'object' ? settings : {};
    const enabled = settings.controllerEnabled !== false;
    if (vibrationEnabled && (!enabled || settings.controllerVibration === false)) stopRumble();
    vibrationEnabled = enabled && settings.controllerVibration !== false;
    const movementDeadzone = setting(settings, 'controllerDeadzone', .16, 0, .4);
    const lookDeadzone = setting(settings, 'controllerLookDeadzone', .14, 0, .4);
    const response = setting(settings, 'controllerResponse', 1.5, .5, 3);
    const connected = new Map();
    let takeover = null;

    // Gamepad indices may contain holes; object identity/timestamp can change on
    // every browser poll and are not used to decide whether this is a new device.
    for (let slot = 0; slot < Math.min(finite(pads?.length), 32); slot++) {
      const source = pads[slot];
      if (!source || source.connected === false) continue;
      const index = Number.isInteger(source.index) && source.index >= 0 ? source.index : slot;
      const id = String(source.id ?? '');
      const key = `${index}:${id}:${source.mapping}`;
      const pad = { index, id, mapping: source.mapping, vibrationActuator: source.vibrationActuator };
      let record = records.get(key);
      if (!record) {
        record = { blocked: true, buttons: Array(17).fill(false), previous: Array(17).fill(false),
          moveAnchor: { x: 0, y: 0 }, lookAnchor: { x: 0, y: 0 } };
        records.set(key, record);
      }
      record.pad = pad;
      record.move = stick(source.axes, 0, movementDeadzone);
      record.look = stick(source.axes, 2, lookDeadzone, response);
      let buttonsNeutral = true, edge = false;
      for (let i = 0; i < 17; i++) {
        const value = buttonValue(source.buttons?.[i]);
        record.previous[i] = record.buttons[i];
        const trigger = i === 6 || i === 7;
        record.buttons[i] = value >= (trigger ? (record.previous[i] ? .25 : .35) : .5);
        if (value > (trigger ? .24 : .1)) buttonsNeutral = false;
        if (record.buttons[i] && !record.previous[i]) edge = true;
      }
      record.neutral = buttonsNeutral && !record.move.x && !record.move.y && !record.look.x && !record.look.y;
      if (!enabled || source.mapping !== 'standard') record.blocked = true;
      const wasBlocked = record.blocked;
      if (record.neutral) record.blocked = false;
      let changed = false;
      for (const [vector, anchor] of [[record.move, record.moveAnchor], [record.look, record.lookAnchor]]) {
        if (!vector.x && !vector.y) { anchor.x = 0; anchor.y = 0; }
        else if (Math.hypot(vector.x, vector.y) >= .1 && Math.hypot(vector.x - anchor.x, vector.y - anchor.y) >= .08) {
          changed = true; anchor.x = vector.x; anchor.y = vector.y;
        }
      }
      record.activity = enabled && source.mapping === 'standard' && !wasBlocked && (edge || changed);
      if (record.activity) takeover = key;
      connected.set(key, record);
    }
    for (const key of records.keys()) if (!connected.has(key)) records.delete(key);
    const previousKey = activeKey;
    if (!connected.has(activeKey)) {
      activeKey = [...connected].find(([, record]) => record.pad.mapping === 'standard')?.[0] ?? connected.keys().next().value ?? null;
    }
    // A genuine new action can select another armed pad; drift or merely holding
    // a button cannot steal focus. The selecting action is consumed until neutral.
    if (takeover && takeover !== activeKey && !connected.get(activeKey)?.activity) activeKey = takeover;
    const record = connected.get(activeKey);
    if (activeKey !== previousKey) {
      stopRumble();
      if (previousKey !== null && record) record.blocked = !record.neutral;
    }
    activePad = record?.pad ?? null;
    const result = output(activePad, settings, !record || record.blocked);
    if (!record) return result;
    result.activity = record.activity;
    if (!enabled || !result.supported || record.blocked) return result;
    result.moveX = record.move.x; result.moveY = -record.move.y || 0;
    result.lookX = record.look.x; result.lookY = record.look.y * (settings.controllerInvertY ? -1 : 1) || 0;
    for (const [action, indices] of Object.entries(HELD)) result.held[action] = indices.some(i => record.buttons[i]);
    for (const [action, indices] of Object.entries(PRESSED)) {
      result.pressed[action] = indices.some(i => record.buttons[i]) && !indices.some(i => record.previous[i]);
    }
    const dpadX = Number(record.buttons[15]) - Number(record.buttons[14]);
    const dpadY = Number(record.buttons[13]) - Number(record.buttons[12]);
    result.menu.x = dpadX || (Math.abs(record.move.x) >= .55 ? Math.sign(record.move.x) : 0);
    result.menu.y = dpadY || (Math.abs(record.move.y) >= .55 ? Math.sign(record.move.y) : 0);
    return result;
  }

  async function rumble(options = {}) {
    if (!vibrationEnabled || activePad?.mapping !== 'standard' || records.get(activeKey)?.blocked) return false;
    return rumbleGamepad(activePad, options);
  }
  return { poll, reset, rumble, stopRumble };
}

// Haptics are optional on both browser and hardware. Rejecting/unsupported
// actuators must never interrupt input or produce an unhandled rejection.
export async function rumbleGamepad(pad, options = {}) {
  try {
    if (!pad || pad.connected === false || typeof pad.vibrationActuator?.playEffect !== 'function') return false;
    const result = await pad.vibrationActuator.playEffect('dual-rumble', {
      startDelay: 0, duration: clamp(finite(options.duration, 100), 0, 500),
      strongMagnitude: clamp(finite(options.strongMagnitude, .2), 0, 1),
      weakMagnitude: clamp(finite(options.weakMagnitude, .35), 0, 1),
    });
    return result !== 'preempted' && result !== 'not-supported';
  } catch { return false; }
}
