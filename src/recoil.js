// One angular offset for aiming, hitscan and the camera. Values are radians.
// Exponential recovery is monotonic and independent of render frame rate.
import { getWeapon } from './weapons.js';
const YAW_PATTERN = [0, 1, 0, -1, 0, -.5, 0, .5];
const REST_TIME = .55;

export function createRecoil() {
  let pitch = 0, yaw = 0, idle = REST_TIME, shotIndex = 0;
  function reset() { pitch = yaw = shotIndex = 0; idle = REST_TIME; }
  return {
    shot({ weapon = 'VX-9', stats, aim = false, crouch = false, multiplier = 1 } = {}) {
      const base=getWeapon(weapon)||getWeapon('VX-9');
      const recoilPitch=Number.isFinite(stats?.recoilPitch)?Math.max(.0001,Math.min(.1,stats.recoilPitch)):base.recoilPitch;
      const recoilYaw=Number.isFinite(stats?.recoilYaw)?Math.max(0,Math.min(.002,stats.recoilYaw)):base.recoilYaw;
      const scale=Number.isFinite(multiplier)?Math.max(.4,Math.min(1,multiplier)):1;
      const stance = (aim ? .56 : 1) * (crouch ? .78 : 1) * scale;
      const maximum = (aim ? .01 : .018) * (crouch ? .78 : 1) * Math.max(1,recoilPitch/.0066) * scale;
      pitch = Math.min(maximum, pitch + recoilPitch * stance);
      const sideways=Math.min(.0006,recoilYaw);
      yaw = Math.max(-sideways * stance, Math.min(sideways * stance,
        yaw + YAW_PATTERN[shotIndex++ % YAW_PATTERN.length] * Math.min(.00013,sideways*.25) * stance));
      idle = 0;
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      idle += dt;
      if (idle >= REST_TIME) { pitch = yaw = 0; shotIndex = 0; return; }
      const recovery = Math.exp(-12 * dt);
      pitch *= recovery; yaw *= recovery;
    },
    offset() { return { pitch, yaw }; },
    reset,
  };
}
