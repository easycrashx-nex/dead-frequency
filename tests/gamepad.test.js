import test from 'node:test';
import assert from 'node:assert/strict';
import { createGamepadInput, detectGamepadFamily, rumbleGamepad } from '../src/gamepad.js';

function pad({ index = 0, id = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', mapping = 'standard', axes = [0, 0, 0, 0], buttons = [], ...rest } = {}) {
  return { index, id, mapping, connected: true, timestamp: 0, axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ value: buttons[i] ?? 0, pressed: (buttons[i] ?? 0) >= .5 })), ...rest };
}
function press(device, index, value = 1) {
  device.buttons[index] = { value, pressed: value >= .5 }; device.timestamp++;
}
function armed(device = pad()) {
  const input = createGamepadInput(); input.poll([device]); return { input, device };
}
function noAction(state) {
  assert.equal(state.moveX, 0); assert.equal(state.moveY, 0);
  assert.equal(state.lookX, 0); assert.equal(state.lookY, 0);
  assert.deepEqual(state.menu, { x: 0, y: 0 });
  assert.ok(Object.values(state.held).every(value => !value));
  assert.ok(Object.values(state.pressed).every(value => !value));
}

test('family recognition handles Sony/Microsoft USB IDs, product names and prompt overrides without lying about mapping', () => {
  for (const id of ['DualSense Wireless Controller', 'DualShock 4', 'Sony Wireless Controller', '054c-0ce6-Wireless Controller', 'Wireless Controller (Vendor: 054c Product: 05c4)', 'VID_054C&PID_09CC']) assert.equal(detectGamepadFamily(id), 'playstation', id);
  for (const id of ['Xbox 360 Controller', 'Xbox Series Controller', 'Controller (XInput STANDARD GAMEPAD)', '045e-02ea-Controller', 'VID_045E&PID_028E']) assert.equal(detectGamepadFamily(id), 'xbox', id);
  assert.equal(detectGamepadFamily('8BitDo Pro 2'), 'generic');
  const { input, device } = armed();
  const overridden = input.poll([device], { controllerPrompts: 'playstation' });
  assert.equal(overridden.family, 'playstation'); assert.equal(overridden.detectedFamily, 'xbox');
  assert.equal(overridden.supported, true);
  assert.equal(input.poll([device], { controllerPrompts: 'auto' }).family, 'xbox');
  assert.equal(input.poll([pad({ id: 'Mystery pad' })]).name, 'Standard-Controller');
});

test('all standard buttons map to the intended independent gameplay and menu actions', () => {
  const expected = [
    [0, ['jump', 'confirm']], [1, ['crouch', 'back']], [2, ['reload']], [3, ['interact']],
    [4, ['heal', 'tabPrev']], [5, ['inventory', 'tabNext']], [6, ['aim']], [7, ['fire']],
    [8, ['map']], [9, ['pause']], [10, ['sprint']], [11, ['crouch']],
  ];
  for (const [button, actions] of expected) {
    const { input, device } = armed(); press(device, button);
    const first = input.poll([device]);
    assert.deepEqual(Object.keys(first.pressed).filter(action => first.pressed[action]).sort(), actions.sort());
    assert.equal(first.activity, true);
    const held = input.poll([device]);
    assert.ok(Object.values(held.pressed).every(value => !value)); assert.equal(held.activity, false);
    if (['aim', 'fire', 'sprint', 'crouch'].some(action => actions.includes(action))) assert.ok(Object.values(held.held).some(Boolean));
    press(device, button, 0); input.poll([device]); press(device, button);
    assert.ok(input.poll([device]).pressed[actions[0]], `button ${button} rearms`);
  }
});

test('D-pad and left stick expose menu directions, with D-pad taking precedence', () => {
  const { input, device } = armed();
  for (const [button, x, y] of [[12, 0, -1], [13, 0, 1], [14, -1, 0], [15, 1, 0]]) {
    press(device, button); assert.deepEqual(input.poll([device]).menu, { x, y });
    assert.deepEqual(input.poll([device]).menu, { x, y });
    press(device, button, 0); input.poll([device]);
  }
  device.axes = [-1, 1, 0, 0];
  assert.deepEqual(input.poll([device]).menu, { x: -1, y: 1 });
  press(device, 15); assert.equal(input.poll([device]).menu.x, 1);
});

test('radial dead zones remove diagonal drift and produce bounded diagonal movement', () => {
  const { input, device } = armed();
  device.axes = [.1, .1, -.08, .08];
  const drift = input.poll([device]); noAction(drift); assert.equal(drift.activity, false);
  device.axes = [1, -1, 1, -1];
  const full = input.poll([device]);
  assert.ok(Math.abs(Math.hypot(full.moveX, full.moveY) - 1) < 1e-12);
  assert.ok(Math.abs(Math.hypot(full.lookX, full.lookY) - 1) < 1e-12);
  assert.ok(full.moveX > 0 && full.moveY > 0 && full.lookX > 0 && full.lookY < 0);
});

test('look curve and inversion respond to settings while angular speed remains caller-owned', () => {
  const { input, device } = armed(); device.axes = [0, -.58, .57, .57];
  const linear = input.poll([device], { controllerResponse: 1 });
  const curved = input.poll([device], { controllerResponse: 2, controllerInvertY: true, controllerSensitivity: 3 });
  assert.ok(curved.lookX < linear.lookX); assert.ok(curved.lookY < 0 && linear.lookY > 0);
  assert.equal(curved.moveY, linear.moveY);
  device.axes = [0, -1, 1, 0];
  assert.equal(input.poll([device], { controllerResponse: 3, controllerSensitivity: .2 }).lookX, 1);
  assert.equal(input.poll([device], { controllerDeadzone: .6 }).moveY, 1);
  device.axes = [.01, 0, .01, 0];
  const zero = input.poll([device], { controllerDeadzone: 0, controllerLookDeadzone: 0, controllerResponse: 1 });
  assert.equal(zero.moveX, .01); assert.equal(zero.lookX, .01);
});

test('first connection with held triggers/buttons/sticks is silent until the entire pad is neutral', () => {
  const input = createGamepadInput(), device = pad({ axes: [0, -1, 1, 0] }); press(device, 7); press(device, 0);
  let state = input.poll([device]); noAction(state); assert.equal(state.blocked, true); assert.equal(state.activity, false);
  press(device, 7, 0); press(device, 0, 0); noAction(input.poll([device]));
  device.axes = [0, 0, 0, 0]; state = input.poll([device]); noAction(state); assert.equal(state.blocked, false);
  press(device, 7); state = input.poll([device]); assert.equal(state.held.fire, true); assert.equal(state.pressed.fire, true);
});

test('reset gates held input through menu/blur transitions and permits a fresh press after neutral', () => {
  const { input, device } = armed(); press(device, 7); device.axes[2] = 1;
  assert.equal(input.poll([device]).held.fire, true);
  input.reset(); for (let frame = 0; frame < 6; frame++) noAction(input.poll([device]));
  device.axes[2] = 0; noAction(input.poll([device]));
  press(device, 7, 0); noAction(input.poll([device]));
  press(device, 7); const state = input.poll([device]); assert.equal(state.pressed.fire, true); assert.equal(state.lookX, 0);
});

test('disconnect, same-index reconnect and replacement identity never inherit held fire', () => {
  const { input, device } = armed(); press(device, 7); input.poll([device]);
  const disconnected = input.poll([null]); noAction(disconnected); assert.equal(disconnected.connected, false); assert.equal(disconnected.index, -1);
  const reconnected = input.poll([device]); noAction(reconnected); assert.equal(reconnected.connected, true); assert.equal(reconnected.blocked, true);
  press(device, 7, 0); input.poll([device]); press(device, 7); assert.equal(input.poll([device]).pressed.fire, true);
  device.id = 'DualSense Wireless Controller'; noAction(input.poll([device]));
  press(device, 7, 0); input.poll([device]); press(device, 7); assert.equal(input.poll([device]).pressed.fire, true);
});

test('multiple sparse pads switch only after fresh activity, consuming the selection action safely', () => {
  const input = createGamepadInput(), first = pad(), second = pad({ index: 3, id: 'DualSense Wireless Controller' });
  assert.equal(input.poll([first, null, null, second]).index, 0);
  second.axes = [.1, -.1, .08, -.08];
  for (let i = 0; i < 10; i++) assert.equal(input.poll([first, null, null, second]).index, 0);
  second.axes = [0, 0, 0, 0]; input.poll([first, null, null, second]); press(second, 0);
  let state = input.poll([first, null, null, second]); assert.equal(state.index, 3); assert.equal(state.activity, true); noAction(state);
  noAction(input.poll([first, null, null, second]));
  press(second, 0, 0); input.poll([first, null, null, second]); press(second, 0);
  state = input.poll([first, null, null, second]); assert.equal(state.pressed.confirm, true);
  press(first, 7); state = input.poll([first, null, null, second]); assert.equal(state.index, 0); noAction(state);
});

test('constant stick/buttons and small live-axis jitter do not continually reclaim input focus', () => {
  const { input, device } = armed(); device.axes = [.8, 0, 0, 0]; press(device, 7);
  assert.equal(input.poll([device]).activity, true);
  for (let i = 0; i < 120; i++) {
    device.axes[0] = .8 + Math.sin(i) * .015; device.timestamp++;
    assert.equal(input.poll([device]).activity, false);
  }
  device.axes[0] = -.8; assert.equal(input.poll([device]).activity, true);
  device.axes[0] = 0; press(device, 7, 0); assert.equal(input.poll([device]).activity, false);
  device.axes[0] = .8; assert.equal(input.poll([device]).activity, true);
});

test('analog triggers use hysteresis and a new fire edge is available exactly once per press', () => {
  const { input, device } = armed();
  press(device, 7, .34); assert.equal(input.poll([device]).held.fire, false);
  press(device, 7, .36); assert.equal(input.poll([device]).pressed.fire, true);
  for (const value of [.34, .3, .26, 1]) {
    press(device, 7, value); const state = input.poll([device]); assert.equal(state.held.fire, true); assert.equal(state.pressed.fire, false);
  }
  press(device, 7, .2); assert.equal(input.poll([device]).held.fire, false);
  press(device, 7, .4); assert.equal(input.poll([device]).pressed.fire, true);
});

test('disabled controllers and unrecognized raw mappings remain visible but cannot execute actions', () => {
  const { input, device } = armed(); press(device, 7);
  let state = input.poll([device], { controllerEnabled: false }); noAction(state); assert.equal(state.connected, true); assert.equal(state.enabled, false);
  noAction(input.poll([device], { controllerEnabled: true }));
  press(device, 7, 0); input.poll([device]); press(device, 7); assert.equal(input.poll([device]).held.fire, true);
  const raw = pad({ id: 'Sony DualShock 4 (Vendor: 054c Product: 05c4)', mapping: '' });
  const other = createGamepadInput(); other.poll([raw]); press(raw, 7); raw.axes[0] = 1;
  state = other.poll([raw], { controllerPrompts: 'playstation' }); noAction(state);
  assert.equal(state.family, 'playstation'); assert.equal(state.supported, false); assert.equal(state.activity, false);
});

test('malformed or incomplete snapshots and nonfinite settings cannot generate nonfinite input', () => {
  const input = createGamepadInput(); noAction(input.poll()); noAction(input.poll(null, null));
  const broken = pad({ axes: [NaN, Infinity, undefined, -Infinity] });
  input.poll([broken]); const state = input.poll([broken], { controllerDeadzone: NaN, controllerLookDeadzone: Infinity, controllerResponse: -Infinity }, NaN);
  noAction(state); assert.equal(state.activity, false);
  noAction(input.poll([{ id: 'partial', connected: true, mapping: 'standard' }]));
  noAction(input.poll([pad({ connected: false })]));
});

test('haptics clamp hardware parameters, respect disabled vibration, and stop on reset/disconnect', async () => {
  const effects = []; let stops = 0;
  const actuator = { playEffect: async (...args) => { effects.push(args); return 'complete'; }, reset: () => { stops++; return Promise.resolve('complete'); } };
  const { input, device } = armed(pad({ vibrationActuator: actuator }));
  assert.equal(await input.rumble({ duration: 1000, strongMagnitude: 8, weakMagnitude: -1 }), true);
  assert.deepEqual(effects[0], ['dual-rumble', { startDelay: 0, duration: 500, strongMagnitude: 1, weakMagnitude: 0 }]);
  input.poll([device], { controllerVibration: false }); assert.equal(await input.rumble(), false); assert.equal(stops, 1);
  input.poll([device]); input.reset(); assert.equal(await input.rumble(), false); assert.equal(stops, 2);
  input.poll([device]); input.poll([]); assert.equal(stops, 3);
  assert.equal(await rumbleGamepad(null), false);
  assert.equal(await rumbleGamepad(pad()), false);
  assert.equal(await rumbleGamepad({ vibrationActuator: { playEffect() { throw Error('no device'); } } }), false);
  assert.equal(await rumbleGamepad({ vibrationActuator: { playEffect: async () => { throw Error('unsupported'); } } }), false);
  const rejectedStop = armed(pad({ vibrationActuator: { reset: async () => { throw Error('lost device'); } } }));
  rejectedStop.input.stopRumble(); rejectedStop.input.reset(); await Promise.resolve();
});
