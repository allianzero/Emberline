// Shared body physics for the player and the bots: a standing box moved one axis
// at a time against the world's AABB colliders, so a wall never swallows a body
// and a body can stand on a crate. Gravity, jumping and crouching included.
// Bodies are plain objects: { position: Vector3, velocity: Vector3, height, eye,
// onGround, crouching }. No allocations in the hot path: one probe box is reused.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;

export function createBody(position, height = 1.72) {
  return {
    position: position.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    height,
    eye: 1.6,
    onGround: true,
    crouching: false,
  };
}

export function makeMover(colliders) {
  const probe = new THREE.Box3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // Move a body by its velocity for dt, axis by axis. Returns the collider hit
  // on the horizontal axes, if any.
  function move(body, dt) {
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) {
      body.position.x = nextX;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) {
      body.position.z = nextZ;
    } else {
      body.velocity.z = 0;
    }
    body.velocity.y -= GRAVITY * dt;
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    if (body.velocity.y < -30) body.velocity.y = -30;
  }

  // A line-of-sight test against the world: true when nothing solid stands
  // between two points. Uses the same colliders as the bodies.
  const raycaster = new THREE.Raycaster();
  const rayDirection = new THREE.Vector3();
  function hasLineOfSight(from, to, blockers) {
    rayDirection.copy(to).sub(from);
    const distance = rayDirection.length();
    if (distance < 0.01) return true;
    rayDirection.divideScalar(distance);
    raycaster.set(from, rayDirection);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(blockers, false)[0];
    return !hit;
  }

  return { move, overlaps, hasLineOfSight };
}
