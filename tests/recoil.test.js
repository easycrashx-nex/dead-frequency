import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoil } from '../src/recoil.js';
import { WEAPONS } from '../src/weapons.js';

test('sustained fire stays bounded in each stance and has negligible sideways motion', () => {
  for (const weapon of ['VX-9', 'AR-4']) for (const aim of [false, true]) for (const crouch of [false, true]) {
    const recoil = createRecoil(); const cap = (aim ? .01 : .018) * (crouch ? .78 : 1);
    for (let i = 0; i < 600; i++) {
      recoil.shot({ weapon, aim, crouch });
      const result = recoil.offset();
      assert.ok(result.pitch >= 0 && result.pitch <= cap);
      assert.ok(Math.abs(result.yaw) <= .0006);
      recoil.update(1 / 120);
    }
  }
});

test('ADS and crouching reduce recoil, with no recoil remaining after reset', () => {
  const hip = createRecoil(), ads = createRecoil(), crouch = createRecoil();
  hip.shot({ weapon: 'AR-4' }); ads.shot({ weapon: 'AR-4', aim: true }); crouch.shot({ weapon: 'AR-4', crouch: true });
  assert.ok(ads.offset().pitch < hip.offset().pitch);
  assert.ok(crouch.offset().pitch < hip.offset().pitch);
  hip.reset(); assert.deepEqual(hip.offset(), { pitch: 0, yaw: 0 });
});

test('normal weapon cadence gives noticeable controlled bursts without the old camera jumps', () => {
  for (const [weapon, cadence, lower, upper] of [['VX-9', .1, .38, .5], ['AR-4', 8 / 60, .43, .6]]) {
    const hip = createRecoil(), ads = createRecoil();
    for (let shot = 0; shot < 12; shot++) {
      hip.update(cadence); ads.update(cadence);
      hip.shot({ weapon }); ads.shot({ weapon, aim: true });
    }
    const degrees = hip.offset().pitch * 180 / Math.PI;
    assert.ok(degrees >= lower && degrees <= upper, `${weapon} burst: ${degrees} degrees`);
    assert.ok(ads.offset().pitch > hip.offset().pitch * .5 && ads.offset().pitch < hip.offset().pitch * .65);
    assert.ok(Math.abs(hip.offset().yaw) < .0006);
  }
});

test('recovery never overshoots and fully returns within 0.6 seconds', () => {
  const recoil = createRecoil(); for (let i = 0; i < 30; i++) recoil.shot({ weapon: 'AR-4' });
  let previous = recoil.offset().pitch;
  for (let i = 0; i < 60; i++) {
    recoil.update(.01); const current = recoil.offset();
    assert.ok(current.pitch >= 0 && current.pitch <= previous); previous = current.pitch;
  }
  assert.deepEqual(recoil.offset(), { pitch: 0, yaw: 0 });
});

test('identical shot timing gives identical recoil at 30, 60 and 144 fps', () => {
  function run(fps) {
    const recoil = createRecoil();
    // Exactly scheduled shots every 0.125 seconds, even when between frames.
    let time = 0;
    for (let shot = 0; shot < 12; shot++) {
      const target = shot * .125;
      while (time < target - 1e-12) { const step = Math.min(1 / fps, target - time); recoil.update(step); time += step; }
      recoil.shot({ weapon: 'AR-4', aim: true });
    }
    return recoil.offset();
  }
  const baseline = run(30);
  for (const fps of [60, 144]) {
    const actual = run(fps);
    assert.ok(Math.abs(actual.pitch - baseline.pitch) < 1e-12);
    assert.ok(Math.abs(actual.yaw - baseline.yaw) < 1e-12);
  }
});

test('invalid time steps leave state finite and a rested burst restarts its pattern', () => {
  const recoil = createRecoil(); recoil.shot(); const initial = recoil.offset();
  for (const dt of [NaN, Infinity, -1, 0]) recoil.update(dt);
  assert.deepEqual(recoil.offset(), initial);
  recoil.update(1); recoil.shot(); assert.deepEqual(recoil.offset(), initial);
});

test('eight weapon recoil profiles remain stable and the trained recoil modifier reduces the actual aim offset', () => {
  const kicks = [];
  for (const weapon of WEAPONS) {
    const normal=createRecoil(),trained=createRecoil();
    normal.shot({weapon:weapon.id}); trained.shot({weapon:weapon.id,multiplier:.85});
    assert.ok(normal.offset().pitch>0);assert.ok(trained.offset().pitch<normal.offset().pitch);
    kicks.push(normal.offset().pitch);
    for(let i=0;i<500;i++){normal.shot({weapon:weapon.id});normal.update(weapon.fireInterval);}
    assert.ok(normal.offset().pitch<.1 && Math.abs(normal.offset().yaw)<.001,weapon.id);
    normal.update(.6);assert.deepEqual(normal.offset(),{pitch:0,yaw:0});
  }
  assert.ok(new Set(kicks).size>=6,'Weapon families should have distinct recoil impulses');
});
