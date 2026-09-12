// One angular offset for aiming, hitscan and the camera. Values are radians.
// Exponential recovery is monotonic and independent of render frame rate.
const YAW_PATTERN = [0, 1, 0, -1, 0, -.5, 0, .5];
const REST_TIME = .55;

export function createRecoil() {
  let pitch = 0, yaw = 0, idle = REST_TIME, shotIndex = 0;
  function reset() { pitch = yaw = shotIndex = 0; idle = REST_TIME; }
  return {
    shot({ weapon = 'VX-9', aim = false, crouch = false } = {}) {
      const stance = (aim ? .56 : 1) * (crouch ? .78 : 1);
      const maximum = (aim ? .01 : .018) * (crouch ? .78 : 1);
      pitch = Math.min(maximum, pitch + (weapon === 'AR-4' ? .0066 : .005) * stance);
      yaw = Math.max(-.0006 * stance, Math.min(.0006 * stance,
        yaw + YAW_PATTERN[shotIndex++ % YAW_PATTERN.length] * .00013 * stance));
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
