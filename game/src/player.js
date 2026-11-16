// The player: a body moved by the shared mover, with acceleration, friction,
// gravity, crouch, jump and slow-walk. Stopping to aim pays: spread grows with
// speed, and slow-walk keeps it tight. Health lives here; damage comes from main.
import { createBody } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const SLOW_SPEED = 2.9;
const CROUCH_SPEED = 2.5;
const ADS_SPEED = 3.4;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const JUMP_SPEED = 6.4;

export function createPlayer(mover, start) {
  const body = createBody(start, STAND_HEIGHT);
  body.eye = STAND_EYE;
  let health = 100;
  let alive = true;
  let stepTimer = 0;

  function look(dx, dy, sensitivity = 0.0021) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys, aiming, onStep) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching && !mover.overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    let wishX = -sin * forward + cos * strafe;
    let wishZ = -cos * forward - sin * strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    const slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = body.crouching ? CROUCH_SPEED : aiming ? ADS_SPEED : slow ? SLOW_SPEED : WALK_SPEED;
    const blend = Math.min(1, ((body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / speed);
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishLen === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    mover.move(body, dt);

    // Footsteps: a soft tick each stride while moving on the ground.
    const speedNow = Math.hypot(body.velocity.x, body.velocity.z);
    if (body.onGround && speedNow > 1.5) {
      stepTimer += dt * speedNow;
      if (stepTimer > 2.6) {
        stepTimer = 0;
        if (onStep) onStep();
      }
    }
  }

  return {
    body,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    isAlive() { return alive; },
    health() { return health; },
    damage(amount) {
      if (!alive) return false;
      health -= amount;
      if (health <= 0) {
        health = 0;
        alive = false;
        return true;
      }
      return false;
    },
    healFull() {
      health = 100;
      alive = true;
    },
    reset(position) {
      body.position.copy(position);
      body.velocity.set(0, 0, 0);
      body.yaw = 0;
      body.pitch = 0;
      body.height = STAND_HEIGHT;
      body.eye = STAND_EYE;
      body.crouching = false;
      body.onGround = true;
      health = 100;
      alive = true;
    },
  };
}
