// The arsenal: four guns and a frag grenade, each with its own view model, fire
// rate, damage, spread and sound. Money buys them in the buy menu; the set owns
// the magazines, the reload, the muzzle flash, the tracers and the live grenades.
// Shooting itself (the ray and the damage) stays in main.js; this module owns the
// numbers, the look and the feel.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, mag: 12, reserve: 36, gap: 0.22, reload: 1.4,
    damage: 30, headMult: 3, spreadStill: 0.004, spreadMove: 0.02, auto: false, sound: 'pistol', kick: 0.011,
  },
  smg: {
    name: 'Vex-9 SMG', price: 1200, mag: 32, reserve: 96, gap: 0.075, reload: 1.7,
    damage: 22, headMult: 3, spreadStill: 0.008, spreadMove: 0.034, auto: true, sound: 'smg', kick: 0.007,
  },
  rifle: {
    name: 'AR-77 Longshot', price: 2700, mag: 30, reserve: 90, gap: 0.1, reload: 1.9,
    damage: 34, headMult: 3.5, spreadStill: 0.0022, spreadMove: 0.028, auto: true, sound: 'rifle', kick: 0.01,
  },
  sniper: {
    name: 'Lance-50', price: 4000, mag: 5, reserve: 15, gap: 1.15, reload: 2.6,
    damage: 110, headMult: 4, spreadStill: 0.0006, spreadMove: 0.05, auto: false, sound: 'sniper', kick: 0.045,
  },
};
export const GRENADE = { name: 'Spark Frag', price: 300, damage: 120, radius: 5.5, fuse: 1.8 };

const TRACER_MAX = 14;

export function createWeaponSet(camera, scene, audio) {
  const gunmetal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c2f33'), roughness: 0.45, metalness: 0.6 });
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a2c18'), roughness: 0.8, metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  function buildModel(kind) {
    const model = new THREE.Group();
    const add = (w, h, d, x, y, z, mat = gunmetal) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      model.add(mesh);
      return mesh;
    };
    if (kind === 'pistol') {
      add(0.07, 0.09, 0.24, 0, 0, -0.1);
      add(0.06, 0.12, 0.07, 0, -0.09, 0.02, gripMat);
      add(0.02, 0.03, 0.02, 0, 0.06, -0.2, accentMat);
    } else if (kind === 'smg') {
      add(0.08, 0.1, 0.44, 0, 0, -0.12);
      add(0.05, 0.05, 0.3, 0, 0.03, -0.42);
      add(0.06, 0.14, 0.08, 0, -0.1, 0.05, gripMat);
      add(0.06, 0.06, 0.16, 0, -0.06, -0.2, gripMat);
      add(0.02, 0.03, 0.02, 0, 0.06, -0.3, accentMat);
    } else if (kind === 'sniper') {
      add(0.09, 0.11, 0.62, 0, 0, -0.16);
      add(0.05, 0.05, 0.42, 0, 0.03, -0.55);
      add(0.07, 0.09, 0.09, 0, 0.09, -0.12);
      add(0.07, 0.13, 0.1, 0, -0.09, 0.08, gripMat);
      add(0.1, 0.06, 0.2, 0, -0.03, 0.22, gripMat);
      add(0.02, 0.03, 0.02, 0, 0.07, -0.42, accentMat);
    } else {
      add(0.09, 0.11, 0.46, 0, 0, -0.14);
      add(0.05, 0.05, 0.36, 0, 0.03, -0.48);
      add(0.07, 0.14, 0.09, 0, -0.1, 0.04, gripMat);
      add(0.08, 0.05, 0.14, 0, 0.08, -0.08);
      add(0.02, 0.03, 0.02, 0, 0.06, -0.36, accentMat);
    }
    model.position.set(0.24, -0.2, -0.42);
    return model;
  }

  const models = {};
  for (const kind of Object.keys(WEAPONS)) {
    models[kind] = buildModel(kind);
    models[kind].visible = false;
    camera.add(models[kind]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Pooled tracers: thin lines from the muzzle to the hit point, fading fast.
  const tracers = [];
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;
  const muzzleWorld = new THREE.Vector3();
  const tracerFrom = new THREE.Vector3();

  const grenades = [];
  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3f35'), roughness: 0.5, metalness: 0.5 });
  const grenadeLightMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) });

  const owned = ['pistol'];
  let current = 'pistol';
  // Per-weapon magazines: switching guns mid-round keeps each one's ammo.
  const stock = {};
  for (const kind of Object.keys(WEAPONS)) {
    stock[kind] = { mag: WEAPONS[kind].mag, reserve: WEAPONS[kind].reserve };
  }
  const state = {
    mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
    grenades: 0, triggerHeld: false, triggerEdge: false,
  };
  models.pistol.visible = true;

  function equip(kind) {
    if (!owned.includes(kind)) return false;
    stock[current] = { mag: state.mag, reserve: state.reserve };
    models[current].visible = false;
    current = kind;
    models[current].visible = true;
    state.mag = stock[kind].mag;
    state.reserve = stock[kind].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    return true;
  }

  function step(dt, mover) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.05);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[current];
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 + state.kick * 0.35;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[current];
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        stock[current] = { mag: state.mag, reserve: state.reserve };
      }
    }
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    // Live grenades: gravity, a rough bounce off the world, then a fuse.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.velocity.y -= 14 * dt;
      const nx = g.mesh.position.x + g.velocity.x * dt;
      const ny = g.mesh.position.y + g.velocity.y * dt;
      const nz = g.mesh.position.z + g.velocity.z * dt;
      let bounced = false;
      if (mover && mover.overlaps(nx, ny - 0.09, nz, 0.18, 0)) {
        if (mover.overlaps(nx, g.mesh.position.y - 0.09, g.mesh.position.z, 0.18, 0)) { g.velocity.x *= -0.45; bounced = true; }
        if (mover.overlaps(g.mesh.position.x, g.mesh.position.y - 0.09, nz, 0.18, 0)) { g.velocity.z *= -0.45; bounced = true; }
        if (!bounced) { g.velocity.y = Math.abs(g.velocity.y) * 0.4; g.velocity.x *= 0.7; g.velocity.z *= 0.7; }
        if (Math.abs(g.velocity.y) < 0.8) g.velocity.y = 0;
      } else {
        g.mesh.position.set(nx, ny, nz);
      }
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) * 0.4;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      g.fuse -= dt;
      g.blink += dt;
      g.light.visible = g.blink % 0.24 < 0.12;
      if (g.fuse <= 0) {
        const done = g;
        grenades.splice(i, 1);
        scene.remove(done.mesh);
        scene.remove(done.light);
        if (done.onExplode) done.onExplode(done.mesh.position.clone(), done.owner);
      }
    }
    state.triggerEdge = false;
  }

  return {
    state,
    owned,
    current() { return current; },
    def() { return WEAPONS[current]; },
    step,
    equip,
    buy(kind) {
      if (owned.includes(kind)) return equip(kind) ? 'equipped' : 'fail';
      return 'not-owned';
    },
    addOwned(kind) {
      if (!owned.includes(kind)) owned.push(kind);
    },
    resetRound() {
      owned.length = 0;
      owned.push('pistol');
      for (const kind of Object.keys(WEAPONS)) {
        stock[kind] = { mag: WEAPONS[kind].mag, reserve: WEAPONS[kind].reserve };
      }
      equip('pistol');
      state.grenades = 0;
      for (const g of grenades) { scene.remove(g.mesh); scene.remove(g.light); }
      grenades.length = 0;
    },
    resetMatch() {
      this.resetRound();
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    canFire() {
      const def = WEAPONS[current];
      if (!def.auto) return state.triggerEdge && this.ready();
      return this.ready();
    },
    pullTrigger() {
      const def = WEAPONS[current];
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + 0.006);
      state.triggerEdge = false;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      stock[current].mag = state.mag;
      return true;
    },
    reload() {
      const def = WEAPONS[current];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      audio.reload();
      return true;
    },
    spread(speed, aiming) {
      const def = WEAPONS[current];
      const base = def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMove + state.bloom;
      return aiming ? base * 0.55 : base;
    },
    muzzleWorld(out) {
      models[current].updateWorldMatrix(true, false);
      muzzleWorld.set(0.24, -0.16, -0.95);
      camera.localToWorld(muzzleWorld);
      return out.copy(muzzleWorld);
    },
    fireTracer(from, to) {
      const tracer = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_MAX;
      const positions = tracer.line.geometry.attributes.position.array;
      positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
      positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
      tracer.line.geometry.attributes.position.needsUpdate = true;
      tracer.line.visible = true;
      tracer.line.material.opacity = 0.85;
      tracer.life = 0.09;
    },
    throwGrenade(origin, direction, owner, onExplode) {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
      mesh.position.copy(origin);
      mesh.castShadow = true;
      scene.add(mesh);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), grenadeLightMaterial);
      light.position.copy(origin);
      scene.add(light);
      const velocity = direction.clone().multiplyScalar(13);
      velocity.y += 4.5;
      grenades.push({ mesh, light, velocity, fuse: GRENADE.fuse, blink: 0, owner, onExplode });
      return true;
    },
    grenadeCount() { return state.grenades; },
    addGrenade() { state.grenades += 1; },
    setTriggerEdge() { state.triggerEdge = true; },
  };
}
