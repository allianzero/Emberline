// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. EMBERLINE is a 5v5 round-based tactical FPS: the player leads
// the EMBER attackers against five ASH defenders, plants the Spark Charge at
// Site A or Site B, and spends the round's money in the buy menu.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './random.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createMap } from './map.js';
import { makeMover } from './physics.js';
import { createPlayer } from './player.js';
import { createWeaponSet, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';
import { stageShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 90);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const audio = createAudio();
const map = createMap(scene);
const mover = makeMover(map.colliders);
const player = createPlayer(mover, map.spawns.EMBER[2]);
const weapons = createWeaponSet(camera, scene, audio);
const hud = createHud(map, {
  onBuy: (key) => buyItem(key),
  onBuyClose: () => closeBuyMenu(),
});
const input = createInput(renderer.domElement, onLockChange);

// ---- match state -----------------------------------------------------------
const stats = new Map();
function statFor(name, team, you = false) {
  if (!stats.has(name)) stats.set(name, { name, team, you, kills: 0, deaths: 0 });
  return stats.get(name);
}
statFor('You', 'EMBER', true);

let playerCarrier = true;
let droppedChargePos = null;
let spectateBot = null;
let plantProgress = 0;
let chargeBeepTimer = 0;
let shakeTime = 0;
let shakeAmp = 0;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let lastWeaponName = '';
let fovCurrent = 74;

const match = createMatch(onMatchEvent);

const bots = createBots(scene, map, mover, random, {
  shoot: (shooter, origin, direction, spread, damage, headMult) => {
    shooter.lastFiredAt = elapsed;
    botShoot(shooter, origin, direction, spread, damage, headMult);
  },
  playerState: () => ({ position: player.body.position, alive: player.isAlive(), height: player.body.height }),
  onPlantDone: (site, bot) => {
    match.plant(site, bot.body.position);
    showPlantedCharge(bot.body.position);
    bots.assignObjectives(site, site);
    hud.killFeed(`${bot.name} planted the charge at Site ${site}`, 'EMBER');
    audio.plantBeep(true);
  },
  onDefuseDone: (bot) => {
    match.defuse();
    hidePlantedCharge();
    hud.killFeed(`${bot.name} defused the charge`, 'ASH');
    match.endRound('ASH', 'charge defused');
  },
  onRetrieve: (bot) => {
    bots.setCarrier(bot);
    droppedChargePos = null;
    hideDroppedCharge();
    hud.killFeed(`${bot.name} picked up the charge`, 'EMBER');
  },
});

// ---- charge meshes ---------------------------------------------------------
const chargeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a1410'), roughness: 0.6, emissive: new THREE.Color(PALETTE.danger), emissiveIntensity: 0.7 });
const chargeLightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.danger) });
let plantedCharge = null;
let plantedLight = null;
let droppedCharge = null;
const explosionFx = [];

function showPlantedCharge(position) {
  hidePlantedCharge();
  plantedCharge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.3), chargeMat);
  plantedCharge.position.set(position.x, 0.16, position.z);
  plantedCharge.castShadow = true;
  scene.add(plantedCharge);
  plantedLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), chargeLightMat);
  plantedLight.position.set(position.x, 0.36, position.z);
  scene.add(plantedLight);
}
function hidePlantedCharge() {
  if (plantedCharge) { scene.remove(plantedCharge); plantedCharge = null; }
  if (plantedLight) { scene.remove(plantedLight); plantedLight = null; }
}
function showDroppedCharge(position) {
  hideDroppedCharge();
  droppedCharge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.24), chargeMat);
  droppedCharge.position.set(position.x, 0.12, position.z);
  droppedCharge.castShadow = true;
  scene.add(droppedCharge);
}
function hideDroppedCharge() {
  if (droppedCharge) { scene.remove(droppedCharge); droppedCharge = null; }
}
function spawnExplosion(position) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb45e'), transparent: true, opacity: 0.85 }),
  );
  mesh.position.copy(position);
  mesh.position.y = 0.8;
  scene.add(mesh);
  explosionFx.push({ mesh, life: 0.6, max: 0.6 });
  audio.explosion();
  const dist = position.distanceTo(player.body.position);
  if (dist < 22) {
    shakeTime = 0.5;
    shakeAmp = Math.min(0.5, (22 - dist) / 22 * 0.6);
  }
}

// ---- shooting --------------------------------------------------------------
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const shootDirection = new THREE.Vector3();
const rayOrigin = new THREE.Vector3();
const playerBox = new THREE.Box3();
const hitPoint = new THREE.Vector3();
const muzzlePoint = new THREE.Vector3();

function shootRay(origin, direction, spread, shooterTeam, damage, headMult, shooter) {
  shootDirection.copy(direction);
  shootDirection.x += (random() * 2 - 1) * spread;
  shootDirection.y += (random() * 2 - 1) * spread;
  shootDirection.z += (random() * 2 - 1) * spread;
  shootDirection.normalize();
  raycaster.set(origin, shootDirection);
  raycaster.far = 120;

  let bestDist = Infinity;
  let best = null; // { kind: 'wall'|'bot'|'player', point, bot?, part? }

  const wallHit = raycaster.intersectObjects(map.shootables, false)[0];
  if (wallHit) {
    bestDist = wallHit.distance;
    best = { kind: 'wall', point: wallHit.point.clone() };
  }
  const botHits = raycaster.intersectObjects(bots.hitMeshes, false);
  for (const hit of botHits) {
    if (hit.distance >= bestDist) break;
    const bot = hit.object.userData.bot;
    if (!bot || !bot.alive || bot.team === shooterTeam) continue;
    bestDist = hit.distance;
    best = { kind: 'bot', point: hit.point.clone(), bot, part: hit.object.userData.part ?? 'torso' };
  }
  if (shooterTeam !== 'EMBER' && player.isAlive()) {
    const p = player.body.position;
    playerBox.min.set(p.x - 0.34, p.y, p.z - 0.34);
    playerBox.max.set(p.x + 0.34, p.y + p.height, p.z + 0.34);
    const t = raycaster.ray.intersectBox(playerBox, hitPoint);
    if (t) {
      const d = origin.distanceTo(t);
      if (d < bestDist) {
        bestDist = d;
        const head = t.y > p.y + p.height - 0.34;
        best = { kind: 'player', point: t.clone(), part: head ? 'head' : 'torso' };
      }
    }
  }

  const endPoint = best ? best.point : origin.clone().addScaledVector(shootDirection, 120);
  weapons.fireTracer(rayOrigin.copy(origin), endPoint);

  if (!best || best.kind === 'wall') return best;
  const amount = damage * (best.part === 'head' ? headMult : 1);
  if (best.kind === 'bot') {
    const killed = bots.damage(best.bot, amount, best.part);
    const shooterName = shooter && shooter.name ? shooter.name : 'You';
    if (killed) {
      statFor(best.bot.name, best.bot.team).deaths += 1;
      statFor(shooterName, shooterTeam, shooter === 'player').kills += 1;
      hud.killFeed(`${shooterName} ⌦ ${best.bot.name}${best.part === 'head' ? ' (headshot)' : ''}`, shooterTeam);
      if (shooter === 'player') {
        match.addKillReward();
        audio.hit(true);
        hud.hitMarker(true, shot ? 4000 : 120);
      }
      if (best.bot.isCarrier) onCarrierDown(best.bot);
    } else if (shooter === 'player') {
      audio.hit(false);
      hud.hitMarker(false, shot ? 4000 : 90);
    }
  } else if (best.kind === 'player') {
    const died = player.damage(amount);
    hud.damageFlash();
    audio.hurt();
    if (died) onPlayerDeath(shooter);
  }
  return best;
}

function shootPlayerOnce() {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return;
  }
  const def = weapons.def();
  camera.getWorldDirection(shootDirection);
  weapons.pullTrigger();
  audio.shoot(def.sound, false);
  bots.hearNoise(player.body.position, 'EMBER');
  shootRay(camera.position, shootDirection, weapons.spread(player.groundSpeed(), input.state.aiming), 'EMBER', def.damage, def.headMult, 'player');
  player.recoil(def.kick, (random() * 2 - 1) * def.kick * 0.35);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
}

function botShoot(bot, origin, direction, spread, damage, headMult) {
  audio.shoot('rifle', true);
  bots.hearNoise(bot.body.position, bot.team);
  shootRay(origin, direction, spread, bot.team, damage, headMult, bot);
}

// ---- deaths, charge handoff -------------------------------------------------
function onCarrierDown(bot) {
  bots.setCarrier(null);
  droppedChargePos = bot.body.position.clone();
  showDroppedCharge(droppedChargePos);
  const retriever = bots.nearestAlive('EMBER', droppedChargePos.x, droppedChargePos.z);
  if (retriever) bots.setRetrieve(retriever, droppedChargePos.x, droppedChargePos.z);
  hud.setCarry(false);
}

function onPlayerDeath(shooter) {
  statFor('You', 'EMBER', true).deaths += 1;
  const shooterName = shooter && shooter.name ? shooter.name : 'ASH';
  hud.killFeed(`${shooterName} ⌦ You`, 'ASH');
  if (playerCarrier) {
    playerCarrier = false;
    droppedChargePos = player.body.position.clone();
    showDroppedCharge(droppedChargePos);
    const retriever = bots.nearestAlive('EMBER', droppedChargePos.x, droppedChargePos.z);
    if (retriever) bots.setRetrieve(retriever, droppedChargePos.x, droppedChargePos.z);
    hud.setCarry(false);
  }
  input.exitLock();
  if (match.state.phase === 'round') {
    spectateBot = bots.bots.find((b) => b.team === 'EMBER' && b.alive) ?? null;
    hud.showOverlay('dead');
  }
}

function dropChargeCheck() {
  if (droppedChargePos && player.isAlive()) {
    const dx = player.body.position.x - droppedChargePos.x;
    const dz = player.body.position.z - droppedChargePos.z;
    if (dx * dx + dz * dz < 1.2 * 1.2) {
      droppedChargePos = null;
      hideDroppedCharge();
      playerCarrier = true;
      bots.setCarrier(null);
      hud.setCarry(true);
      hud.killFeed('You picked up the charge', 'EMBER');
    }
  }
}

// ---- buy menu ---------------------------------------------------------------
const SLOT_KEYS = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'rifle', Digit4: 'sniper' };

function buyItem(key) {
  if (match.state.phase !== 'buy') return;
  if (key === '5') {
    if (match.spend(GRENADE.price)) {
      weapons.addGrenade();
      audio.buy();
      hud.setGrenades(weapons.grenadeCount());
    } else {
      audio.denied();
    }
  } else {
    const kind = SLOT_KEYS[`Digit${key}`];
    if (!kind) return;
    const def = WEAPONS[kind];
    if (weapons.owned.includes(kind)) {
      weapons.equip(kind);
      hud.setWeapon(def.name);
      hud.setAmmo(weapons.state.mag, weapons.state.reserve);
    } else if (match.spend(def.price)) {
      weapons.addOwned(kind);
      weapons.equip(kind);
      audio.buy();
      hud.setWeapon(def.name);
      hud.setAmmo(weapons.state.mag, weapons.state.reserve);
    } else {
      audio.denied();
    }
  }
  hud.updateBuy(match.state.money, weapons.owned, weapons.grenadeCount());
  hud.setMoney(match.state.money);
}

function closeBuyMenu() {
  if (match.state.phase !== 'buy') return;
  hud.hideBuy();
  input.requestLock();
}

// ---- match events ------------------------------------------------------------
function resetRound() {
  player.reset(map.spawns.EMBER[2]);
  player.body.yaw = 0;
  weapons.resetRound();
  bots.resetRound(map.spawns, match.state.site);
  bots.setCarrier(null);
  playerCarrier = true;
  droppedChargePos = null;
  hideDroppedCharge();
  hidePlantedCharge();
  spectateBot = null;
  plantProgress = 0;
  hud.setCarry(true);
  hud.setHealth(100);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
  hud.setWeapon(weapons.def().name);
  hud.setGrenades(0);
  hud.setMoney(match.state.money);
}

function onMatchEvent(type, data) {
  if (type === 'matchStart') {
    stats.clear();
    statFor('You', 'EMBER', true);
    for (const bot of bots.bots) statFor(bot.name, bot.team);
  } else if (type === 'buyStart') {
    resetRound();
    hud.showBanner(`ROUND ${data.round}`, `Attack Site ${data.site} — plant the Spark Charge`, 3000);
    // Only pop the buy menu open once the player has started (clicked play at
    // least once): at boot the start overlay is up and the menu would stack
    // on top of it.
    if (!shot && started) {
      input.exitLock();
      hud.showBuy(match.state.money, weapons.owned, weapons.grenadeCount());
    }
    hud.setScore(match.state.score.EMBER, match.state.score.ASH, data.round);
  } else if (type === 'roundStart') {
    hud.hideBuy();
    hud.showBanner(`ROUND ${data.round}`, `Attack Site ${data.site}`, 2200);
  } else if (type === 'planted') {
    chargeBeepTimer = 0;
    hud.setCharge(data.site, data.fuse);
  } else if (type === 'defused') {
    hud.clearCharge();
  } else if (type === 'exploded') {
    const pos = match.state.planted ? match.state.planted.pos : null;
    spawnExplosion(pos ?? new THREE.Vector3(0, 0, 0));
    // The blast kills anyone still near the site.
    const blast = pos ?? new THREE.Vector3(0, 0, 0);
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      if (bot.body.position.distanceTo(blast) < 8) bots.damage(bot, 500, 'torso');
    }
    if (player.isAlive() && player.body.position.distanceTo(blast) < 8) {
      player.damage(500);
      if (!player.isAlive()) onPlayerDeath(null);
    }
    hidePlantedCharge();
    hud.clearCharge();
  } else if (type === 'roundEnd') {
    input.exitLock();
    hud.hideBuy();
    hud.hideProgress();
    spectateBot = null;
    const won = data.winner === 'EMBER';
    if (won) audio.roundWin(); else audio.roundLose();
    hud.showOverlay('roundEnd', {
      title: won ? 'EMBER takes the round' : 'ASH takes the round',
      copy: `${data.reason}. EMBER ${data.score.EMBER} — ASH ${data.score.ASH}.`,
    });
    hud.setScore(data.score.EMBER, data.score.ASH, data.round);
    hud.setMoney(match.state.money);
  } else if (type === 'roundEndDone') {
    hud.hideOverlay();
    if (match.state.phase === 'roundEnd') match.nextRound(random);
  } else if (type === 'matchEnd') {
    input.exitLock();
    hud.hideBuy();
    const won = data.winner === 'EMBER';
    if (won) audio.roundWin(); else audio.roundLose();
    hud.showOverlay('matchEnd', {
      title: won ? 'EMBERLINE — EMBER wins the match' : 'EMBERLINE — ASH wins the match',
      copy: `Final score EMBER ${data.score.EMBER} — ASH ${data.score.ASH}.`,
    });
  }
}

// ---- input / lock ------------------------------------------------------------
function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (match.state.phase === 'round' && player.isAlive() && !hud.isBuyOpen()) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  const phase = match.state.phase;
  if (phase === 'matchEnd') {
    hud.hideOverlay();
    match.startMatch(random);
    return;
  }
  if (phase === 'buy') {
    hud.hideOverlay();
    hud.showBuy(match.state.money, weapons.owned, weapons.grenadeCount());
    return;
  }
  hud.hideOverlay();
  input.requestLock();
});

// ---- per-frame input ---------------------------------------------------------
function handleInput() {
  const keys = input.state.keys;
  if (input.wasPressed('KeyR')) weapons.reload();
  if (input.wasPressed('KeyG') && player.isAlive() && match.state.phase === 'round') {
    if (weapons.state.grenades > 0) {
      camera.getWorldDirection(shootDirection);
      const origin = camera.position.clone().addScaledVector(shootDirection, 0.5);
      origin.y -= 0.1;
      if (weapons.throwGrenade(origin, shootDirection, 'player', (pos) => explodeGrenade(pos, 'player'))) {
        audio.grenadePin();
        hud.setGrenades(weapons.grenadeCount());
      }
    }
  }
  for (const code of Object.keys(SLOT_KEYS)) {
    if (input.wasPressed(code)) {
      const kind = SLOT_KEYS[code];
      if (hud.isBuyOpen()) buyItem(code.slice(-1));
      else if (weapons.owned.includes(kind)) {
        weapons.equip(kind);
        hud.setWeapon(weapons.def().name);
        hud.setAmmo(weapons.state.mag, weapons.state.reserve);
      }
    }
  }
  if (input.wasPressed('Digit5') && hud.isBuyOpen()) buyItem('5');
  if (input.wasPressed('KeyB')) {
    if (hud.isBuyOpen()) closeBuyMenu();
    else if (match.state.phase === 'buy') {
      input.exitLock();
      hud.showBuy(match.state.money, weapons.owned, weapons.grenadeCount());
    }
  }
  if (keys.has('Tab')) {
    const rows = [...stats.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    hud.showScoreboard(rows);
  } else {
    hud.hideScoreboard();
  }
  // Semi-auto trigger edge.
  if (input.state.firing && !prevFiring) weapons.setTriggerEdge();
  prevFiring = input.state.firing;
}

function explodeGrenade(position, owner) {
  spawnExplosion(position);
  const team = owner === 'player' ? 'EMBER' : owner.team;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.body.position.distanceTo(position);
    if (d < GRENADE.radius) {
      const amount = GRENADE.damage * (1 - d / GRENADE.radius) + 20;
      const killed = bots.damage(bot, amount, 'torso');
      if (killed) {
        statFor(bot.name, bot.team).deaths += 1;
        const shooterName = owner === 'player' ? 'You' : owner.name;
        statFor(shooterName, team, owner === 'player').kills += 1;
        hud.killFeed(`${shooterName} ⌦ ${bot.name} (frag)`, team);
        if (owner === 'player') match.addKillReward();
        if (bot.isCarrier) onCarrierDown(bot);
      }
    }
  }
  if (player.isAlive() && team !== 'EMBER') {
    const d = player.body.position.distanceTo(position);
    if (d < GRENADE.radius) {
      const died = player.damage(GRENADE.damage * (1 - d / GRENADE.radius) + 20);
      hud.damageFlash();
      audio.hurt();
      if (died) onPlayerDeath(owner);
    }
  }
}

// ---- plant channel -----------------------------------------------------------
const sitePoint = new THREE.Vector3();
function plantStep(dt) {
  if (!playerCarrier || match.state.phase !== 'round' || match.state.planted) {
    if (plantProgress > 0) {
      plantProgress = 0;
      hud.hideProgress();
    }
    return;
  }
  const site = map.sites[match.state.site];
  sitePoint.set(player.body.position.x, 1, player.body.position.z);
  const inZone = site.zone.containsPoint(sitePoint);
  const still = player.groundSpeed() < 1.0;
  if (inZone && still && input.state.keys.has('KeyE')) {
    plantProgress += dt;
    hud.setProgress('PLANTING THE CHARGE', plantProgress / 3);
    if (Math.floor(plantProgress * 2) !== Math.floor((plantProgress - dt) * 2)) audio.plantBeep(false);
    if (plantProgress >= 3) {
      plantProgress = 0;
      hud.hideProgress();
      match.plant(match.state.site, player.body.position);
      showPlantedCharge(player.body.position);
      bots.assignObjectives(match.state.site, match.state.site);
      hud.killFeed(`You planted the charge at Site ${match.state.site}`, 'EMBER');
      audio.plantBeep(true);
      playerCarrier = false;
      hud.setCarry(false);
    }
  } else if (plantProgress > 0) {
    plantProgress = 0;
    hud.hideProgress();
  }
}

// ---- the fixed step ------------------------------------------------------------
function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;

  if (!shot) {
    handleInput();
    const look = input.takeLook();
    if (player.isAlive() && (phase === 'round' || phase === 'buy')) {
      player.look(look.x, look.y);
    }
  }

  if (phase === 'round' || phase === 'buy') {
    if (player.isAlive()) {
      player.step(dt, input.state.keys, input.state.aiming, () => audio.step());
      if (phase === 'round' && input.state.firing && weapons.canFire() && !shot) {
        shootPlayerOnce();
      }
    }
  }
  weapons.step(dt, mover);
  bots.step(dt, elapsed, {
    phase,
    planted: !!match.state.planted,
    site: match.state.site,
    chargePos: match.state.planted ? match.state.planted.pos : null,
  });
  match.step(dt);
  dropChargeCheck();
  plantStep(dt);

  // Charge beeping while planted.
  if (match.state.planted) {
    chargeBeepTimer -= dt;
    const interval = match.state.planted.fuse <= 10 ? 0.4 : 0.85;
    if (chargeBeepTimer <= 0) {
      chargeBeepTimer = interval;
      audio.chargeBeep();
      if (plantedLight) plantedLight.visible = !plantedLight.visible;
    }
    hud.setCharge(match.state.planted.site, match.state.planted.fuse);
  }

  // Explosion FX.
  for (let i = explosionFx.length - 1; i >= 0; i -= 1) {
    const fx = explosionFx[i];
    fx.life -= dt;
    const t = 1 - fx.life / fx.max;
    fx.mesh.scale.setScalar(1 + t * 9);
    fx.mesh.material.opacity = Math.max(0, 0.85 * (1 - t));
    if (fx.life <= 0) {
      scene.remove(fx.mesh);
      explosionFx.splice(i, 1);
    }
  }
  if (shakeTime > 0) shakeTime -= dt;

  // Elimination check.
  if (phase === 'round' && !shot) {
    const counts = bots.aliveCounts();
    const emberAlive = (player.isAlive() ? 1 : 0) + counts.EMBER;
    const ashAlive = counts.ASH;
    if (ashAlive === 0) {
      match.endRound('EMBER', 'team eliminated');
    } else if (emberAlive === 0 && !match.state.planted) {
      match.endRound('ASH', 'team eliminated');
    }
  }

  syncHud();
  syncCamera();
}

function syncCamera() {
  if (!player.isAlive() && spectateBot && spectateBot.alive) {
    const b = spectateBot.body;
    camera.position.set(b.position.x, b.position.y + 1.5, b.position.z);
    camera.rotation.set(b.pitch, b.yaw, 0, 'YXZ');
  } else {
    const body = player.body;
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  }
  if (shakeTime > 0) {
    camera.position.x += (random() * 2 - 1) * shakeAmp * (shakeTime / 0.5);
    camera.position.y += (random() * 2 - 1) * shakeAmp * (shakeTime / 0.5);
  }
  // ADS zoom.
  const aiming = input.state.aiming && player.isAlive();
  const target = aiming ? (weapons.current() === 'sniper' ? 42 : 64) : 74;
  if (Math.abs(fovCurrent - target) > 0.05) {
    fovCurrent += (target - fovCurrent) * 0.25;
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
}

let lastSpreadPx = -1;
function syncHud() {
  hud.setHealth(player.health());
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
  hud.setMoney(match.state.money);
  hud.setTimer(match.state.timer);
  hud.setScore(match.state.score.EMBER, match.state.score.ASH, match.state.round);
  if (weapons.def().name !== lastWeaponName) {
    lastWeaponName = weapons.def().name;
    hud.setWeapon(lastWeaponName);
  }
  hud.setGrenades(weapons.grenadeCount());
  const spreadPx = 4 + weapons.spread(player.groundSpeed(), input.state.aiming) * 700;
  if (Math.abs(spreadPx - lastSpreadPx) > 0.4) {
    lastSpreadPx = spreadPx;
    hud.setSpread(spreadPx);
  }
  hud.setCarry(playerCarrier && match.state.phase === 'round' && !match.state.planted);
  // Minimap: ASH bots show only when seen or recently loud.
  const eye = new THREE.Vector3(player.body.position.x, player.body.position.y + 1.5, player.body.position.z);
  const chest = new THREE.Vector3();
  for (const bot of bots.bots) {
    if (bot.team === 'EMBER') { bot.minimapVisible = true; continue; }
    if (bot.lastFiredAt !== undefined && elapsed - bot.lastFiredAt < 3) { bot.minimapVisible = true; continue; }
    chest.set(bot.body.position.x, bot.body.position.y + 1.2, bot.body.position.z);
    bot.minimapVisible = mover.hasLineOfSight(eye, chest, map.blockers);
  }
  hud.drawMinimap(player.body, bots.bots, match.state.planted ? match.state.planted.pos : droppedChargePos);
}

// ---- helpers for ?shot= staging ------------------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}
function teleportPlayer(x, z, yaw, pitch) {
  player.body.position.set(x, 0, z);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = yaw;
  player.body.pitch = pitch;
  syncCamera();
}
function aimAtPoint(point) {
  const p = player.body.position;
  const dx = point.x - p.x;
  const dy = point.y - (p.y + player.body.eye);
  const dz = point.z - p.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.body.yaw = Math.atan2(-dx, -dz);
  player.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}
function nearestEnemyBot() {
  let best = null;
  let bestD = Infinity;
  for (const bot of bots.bots) {
    if (!bot.alive || bot.team !== 'ASH') continue;
    const d = bot.body.position.distanceTo(player.body.position);
    if (d < bestD) { bestD = d; best = bot; }
  }
  return best;
}
const shotEye = new THREE.Vector3();
const shotChest = new THREE.Vector3();
function visibleEnemyBot() {
  // The nearest ASH bot the player can actually see from where they stand.
  shotEye.set(player.body.position.x, player.body.position.y + 1.5, player.body.position.z);
  let best = null;
  let bestD = Infinity;
  for (const bot of bots.bots) {
    if (!bot.alive || bot.team !== 'ASH') continue;
    shotChest.set(bot.body.position.x, bot.body.position.y + 1.2, bot.body.position.z);
    if (!mover.hasLineOfSight(shotEye, shotChest, map.blockers)) continue;
    const d = bot.body.position.distanceTo(player.body.position);
    if (d < bestD) { bestD = d; best = bot; }
  }
  return best;
}
function firePlayerOnce() {
  if (!weapons.takeRound()) return;
  const def = weapons.def();
  camera.getWorldDirection(shootDirection);
  weapons.pullTrigger();
  shootRay(camera.position, shootDirection, 0, 'EMBER', def.damage, def.headMult, 'player');
  player.recoil(def.kick, 0);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
}

const game = {
  map, match, player, bots, weapons, hud, input, random,
  settle, teleportPlayer, aimAtPoint, nearestEnemyBot, visibleEnemyBot, firePlayerOnce,
};

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug hook for the local play-test (state only, no credentials).
window.__ember = {
  match, player, bots, weapons,
  state() {
    return {
      phase: match.state.phase,
      round: match.state.round,
      score: match.state.score,
      timer: match.state.timer,
      money: match.state.money,
      health: player.health(),
      alive: player.isAlive(),
      counts: bots.aliveCounts(),
      planted: !!match.state.planted,
      carrier: playerCarrier,
      weapon: weapons.current(),
      ammo: [weapons.state.mag, weapons.state.reserve],
    };
  },
};

syncCamera();
syncHud();
match.startMatch(random);
if (shot) {
  stageShot(shot, game);
  syncHud();
  paintTwiceThenReady();
} else {
  requestAnimationFrame(frame);
}
