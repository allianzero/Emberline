// The bots: nine of them, four EMBER attackers beside the player and five ASH
// defenders. Each one walks a waypoint graph with BFS, holds a site, advances on
// a call, and fights when it sees an enemy: a reaction delay, aimed bursts with
// spread, and a pause between bursts. They hear shots nearby and come to look.
// The carrier plants the charge; a defender defuses it. Bots never see through
// walls: every sight check is a real line-of-sight test against the world.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './physics.js';
import { range, pick } from './random.js';

const BOT_SPEED = 4.1;
const BOT_HEALTH = 100;
const BOT_DAMAGE = 14;
const BOT_HEAD_MULT = 3;
const SEE_RANGE = 42;
const SEE_HALF_FOV = 1.05; // ~60 degrees each side
const BURST_MIN = 3;
const BURST_MAX = 5;

const EMBER_NAMES = ['Vex', 'Sable', 'Rook', 'Flint'];
const ASH_NAMES = ['Hollow', 'Mira', 'Slate', 'Dusk', 'Wren'];

function bfsPath(graph, from, to) {
  if (from === to) return [to];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const node = queue.shift();
    for (const next of graph[node].links) {
      if (prev[next] !== undefined) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let at = to;
        while (prev[at] !== null) {
          at = prev[at];
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

function nearestNode(graph, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const id of Object.keys(graph)) {
    const node = graph[id];
    const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

export function createBots(scene, map, mover, random, api) {
  // api: { shoot(shooter, origin, direction, spread, damage, headMult),
  //        onBotDown(bot, killer), onPlantDone(site), onDefuseDone(site),
  //        playerVisible: () => ({position, alive, height}) }
  const emberMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.1 });
  const emberDark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a3512'), roughness: 0.7 });
  const ashMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.cyan), roughness: 0.6, metalness: 0.1 });
  const ashDark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14524f'), roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22252a'), roughness: 0.45, metalness: 0.6 });
  const torsoGeo = new THREE.BoxGeometry(0.56, 0.78, 0.32);
  const headGeo = new THREE.BoxGeometry(0.3, 0.28, 0.3);
  const legGeo = new THREE.BoxGeometry(0.2, 0.55, 0.24);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.5);

  const bots = [];
  const hitMeshes = [];

  function makeBot(team, name, index) {
    const body = createBody(new THREE.Vector3(0, 0, 0));
    const group = new THREE.Group();
    const mat = team === 'EMBER' ? emberMat : ashMat;
    const dark = team === 'EMBER' ? emberDark : ashDark;
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 1.02;
    const head = new THREE.Mesh(headGeo, dark);
    head.position.y = 1.58;
    const legL = new THREE.Mesh(legGeo, dark);
    legL.position.set(-0.14, 0.28, 0);
    const legR = new THREE.Mesh(legGeo, dark);
    legR.position.set(0.14, 0.28, 0);
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; } });
    scene.add(group);
    const bot = {
      team, name, index, body, group, torso, head,
      health: BOT_HEALTH, alive: true,
      route: [], routeIndex: 0, target: null,
      objective: null, holdNode: null,
      isCarrier: false, planting: 0, defusing: 0, retrieve: null,
      engage: null, reaction: 0, burstLeft: 0, burstGap: 0, aimError: 0,
      seeTimer: 0, investigate: null, strafeDir: 1, strafeTimer: 0,
      walkPhase: random() * 6,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 4; i += 1) makeBot('EMBER', EMBER_NAMES[i], i);
  for (let i = 0; i < 5; i += 1) makeBot('ASH', ASH_NAMES[i], i);

  const eyePos = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  function botEye(bot, out) {
    return out.set(bot.body.position.x, bot.body.position.y + 1.5, bot.body.position.z);
  }

  function canSee(bot, enemy) {
    botEye(bot, eyePos);
    if (enemy.isPlayer) {
      const p = api.playerState();
      if (!p.alive) return null;
      targetPos.set(p.position.x, p.position.y + p.height * 0.7, p.position.z);
    } else {
      if (!enemy.alive) return null;
      targetPos.set(enemy.body.position.x, enemy.body.position.y + 1.2, enemy.body.position.z);
    }
    toTarget.copy(targetPos).sub(eyePos);
    const dist = toTarget.length();
    if (dist > SEE_RANGE) return null;
    toTarget.divideScalar(dist || 1);
    const facing = new THREE.Vector3(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
    if (facing.dot(toTarget) < Math.cos(SEE_HALF_FOV) && dist > 3) return null;
    if (!mover.hasLineOfSight(eyePos, targetPos, map.blockers)) return null;
    return { target: enemy, dist, point: targetPos.clone() };
  }

  function pickRoute(bot, targetNode) {
    const from = nearestNode(map.waypoints, bot.body.position.x, bot.body.position.z);
    bot.route = bfsPath(map.waypoints, from, targetNode);
    bot.routeIndex = 0;
  }

  function assignObjectives(site, plantedSite) {
    const ash = bots.filter((b) => b.team === 'ASH');
    const ember = bots.filter((b) => b.team === 'EMBER');
    if (plantedSite) {
      for (const b of ash) { b.objective = 'retake'; pickRoute(b, plantedSite === 'A' ? 'aSite' : 'bSite'); }
      for (const b of ember) { b.objective = 'guard'; pickRoute(b, plantedSite === 'A' ? 'aSite' : 'bSite'); }
      return;
    }
    // Defenders hold: two at A, two at B, one mid.
    const holds = ['aSite', 'aDoor', 'bSite', 'bDoor', 'midNorth'];
    ash.forEach((b, i) => {
      b.objective = 'hold';
      b.holdNode = holds[i % holds.length];
      pickRoute(b, b.holdNode);
    });
    // Attackers split toward the called site, carrier with the main group.
    const main = site === 'A' ? 'aSite' : 'bSite';
    const other = site === 'A' ? 'bSite' : 'aSite';
    ember.forEach((b, i) => {
      b.objective = 'attack';
      pickRoute(b, i < 3 ? main : other);
    });
  }

  function resetRound(spawns, site) {
    const emberSpawns = spawns.EMBER;
    const ashSpawns = spawns.ASH;
    bots.forEach((bot) => {
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.isCarrier = false;
      bot.planting = 0;
      bot.defusing = 0;
      bot.retrieve = null;
      bot.engage = null;
      bot.reaction = 0;
      bot.burstLeft = 0;
      bot.investigate = null;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.y = 0;
      bot.group.visible = true;
      if (bot.team === 'EMBER') {
        const s = emberSpawns[bot.index % emberSpawns.length];
        bot.body.position.set(s.x + range(random, -0.4, 0.4), 0, s.z + range(random, -0.4, 0.4));
        bot.body.yaw = 0; // face north, toward the sites
      } else {
        const s = ashSpawns[bot.index % ashSpawns.length];
        bot.body.position.set(s.x + range(random, -0.4, 0.4), 0, s.z + range(random, -0.4, 0.4));
        bot.body.yaw = Math.PI; // face south, toward the attackers
      }
      bot.body.velocity.set(0, 0, 0);
      bot.body.pitch = 0;
    });
    // The carrier is set by main.js (the player carries it first; a bot takes
    // it over only after the player drops it). No bot starts as carrier.
    assignObjectives(site, null);
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.health = 0;
    bot.alive = false;
    bot.planting = 0;
    bot.defusing = 0;
    bot.group.rotation.x = -Math.PI / 2;
    bot.group.position.y = 0.15;
    return true;
  }

  function hearNoise(position, byTeam) {
    for (const bot of bots) {
      if (!bot.alive || bot.team === byTeam || bot.engage) continue;
      const dx = bot.body.position.x - position.x;
      const dz = bot.body.position.z - position.z;
      if (dx * dx + dz * dz < 18 * 18) {
        bot.investigate = { x: position.x, z: position.z, until: 6 };
      }
    }
  }

  function stepBot(bot, dt, time, ctx) {
    if (!bot.alive) return;
    const pos = bot.body.position;

    // Perception, staggered: each bot looks every 0.15 s. Only in the round:
    // the buy phase is for positioning, not shooting.
    bot.seeTimer -= dt;
    if (ctx.phase === 'round' && bot.seeTimer <= 0) {
      bot.seeTimer = 0.15;
      let best = null;
      const enemies = [];
      if (api.playerState().alive) enemies.push({ isPlayer: true });
      for (const other of bots) if (other.team !== bot.team && other.alive) enemies.push(other);
      for (const enemy of enemies) {
        const seen = canSee(bot, enemy);
        if (seen && (!best || seen.dist < best.dist)) best = seen;
      }
      if (best) {
        if (!bot.engage || bot.engage.target !== best.target) {
          bot.engage = best;
          bot.reaction = range(random, 0.35, 0.7);
          bot.burstLeft = 0;
        } else {
          bot.engage = best;
        }
      } else if (bot.engage) {
        bot.engage = null;
        bot.burstLeft = 0;
      }
    } else if (ctx.phase !== 'round' && bot.engage) {
      bot.engage = null;
      bot.burstLeft = 0;
    }

    // Planting: the carrier channels in the site zone (and not while retrieving).
    if (bot.isCarrier && !bot.retrieve && ctx.phase === 'round' && !ctx.planted && ctx.site) {
      const site = map.sites[ctx.site];
      if (site.zone.containsPoint(new THREE.Vector3(pos.x, 1, pos.z)) && !bot.engage) {
        bot.planting += dt;
        if (bot.planting >= 3) {
          bot.planting = 0;
          api.onPlantDone(ctx.site, bot);
          return;
        }
      } else {
        bot.planting = 0;
      }
    }
    // Defusing: a defender channels at the planted charge.
    if (bot.team === 'ASH' && ctx.planted && ctx.chargePos) {
      const dx = pos.x - ctx.chargePos.x;
      const dz = pos.z - ctx.chargePos.z;
      if (dx * dx + dz * dz < 2.2 * 2.2 && !bot.engage) {
        bot.defusing += dt;
        if (bot.defusing >= 5) {
          bot.defusing = 0;
          api.onDefuseDone(bot);
          return;
        }
      } else {
        bot.defusing = 0;
      }
    }

    // Combat: aim, react, then fire in bursts.
    if (bot.engage && ctx.phase === 'round') {
      const target = bot.engage.target;
      const aim = bot.engage.point;
      const dx = aim.x - pos.x;
      const dy = aim.y - (pos.y + 1.5);
      const dz = aim.z - pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
      let dyaw = wantYaw - bot.body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.body.yaw += dyaw * Math.min(1, dt * 7);
      bot.body.pitch += (wantPitch - bot.body.pitch) * Math.min(1, dt * 7);
      bot.reaction -= dt;
      if (bot.reaction <= 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
          bot.burstGap = 0;
          bot.aimError = range(random, 0.02, 0.06);
        }
        bot.burstGap -= dt;
        if (bot.burstLeft > 0 && bot.burstGap <= 0) {
          bot.burstLeft -= 1;
          bot.burstGap = 0.13;
          botEye(bot, eyePos);
          toTarget.set(-Math.sin(bot.body.yaw) * Math.cos(bot.body.pitch), Math.sin(bot.body.pitch), -Math.cos(bot.body.yaw) * Math.cos(bot.body.pitch));
          api.shoot(bot, eyePos, toTarget, bot.aimError, BOT_DAMAGE, BOT_HEAD_MULT);
          if (bot.burstLeft === 0) bot.reaction = range(random, 0.45, 0.95);
        }
      }
      // Strafe a little while engaging so they are not standing targets.
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = range(random, 0.7, 1.4);
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const side = bot.strafeDir;
      const sin = Math.sin(bot.body.yaw);
      const cos = Math.cos(bot.body.yaw);
      bot.body.velocity.x = cos * side * 1.1;
      bot.body.velocity.z = -sin * side * 1.1;
      mover.move(bot.body, dt);
      syncMesh(bot, time, dt);
      return;
    }

    // Retrieving a dropped charge: walk to it, then take it.
    if (bot.retrieve) {
      const rx = bot.retrieve.x - pos.x;
      const rz = bot.retrieve.z - pos.z;
      if (rx * rx + rz * rz < 1.5 * 1.5) {
        bot.retrieve = null;
        bot.route = [];
        api.onRetrieve(bot);
        // With the charge in hand, walk to the called site and plant it.
        if (ctx.site) pickRoute(bot, ctx.site === 'A' ? 'aSite' : 'bSite');
      } else if (bot.route.length === 0) {
        pickRoute(bot, nearestNode(map.waypoints, bot.retrieve.x, bot.retrieve.z));
      }
    }

    // Movement: follow the route, or hold position.
    let dest = null;
    if (bot.retrieve) {
      // Close to the drop: walk straight at it instead of via waypoints.
      const rx = bot.retrieve.x - pos.x;
      const rz = bot.retrieve.z - pos.z;
      if (rx * rx + rz * rz < 4 * 4) dest = bot.retrieve;
    }
    if (!dest && bot.investigate) {
      dest = bot.investigate;
      bot.investigate.until -= dt;
      if (bot.investigate.until <= 0) bot.investigate = null;
      const dx = dest.x - pos.x;
      const dz = dest.z - pos.z;
      if (dx * dx + dz * dz < 1) bot.investigate = null;
    } else if (bot.route.length > 0) {
      const node = map.waypoints[bot.route[bot.routeIndex]];
      if (node) {
        const dx = node.x - pos.x;
        const dz = node.z - pos.z;
        if (dx * dx + dz * dz < 0.7 * 0.7) {
          bot.routeIndex += 1;
          if (bot.routeIndex >= bot.route.length) {
            bot.route = [];
            if (bot.objective === 'hold') {
              // Face the likely approach: defenders look south.
              bot.body.yaw = bot.team === 'ASH' ? Math.PI : 0;
            }
          }
        } else {
          dest = node;
        }
      }
    }
    if (dest) {
      const dx = dest.x - pos.x;
      const dz = dest.z - pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const wantYaw = Math.atan2(-dx, -dz);
      let dyaw = wantYaw - bot.body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.body.yaw += dyaw * Math.min(1, dt * 5);
      bot.body.velocity.x = (dx / len) * BOT_SPEED;
      bot.body.velocity.z = (dz / len) * BOT_SPEED;
      mover.move(bot.body, dt);
    } else {
      bot.body.velocity.x *= Math.max(0, 1 - 10 * dt);
      bot.body.velocity.z *= Math.max(0, 1 - 10 * dt);
      mover.move(bot.body, dt);
    }
    syncMesh(bot, time, dt);
  }

  function syncMesh(bot, time, dt) {
    bot.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
    bot.group.rotation.y = bot.body.yaw;
    // A simple walk cycle: legs swing with distance travelled.
    const speed = Math.hypot(bot.body.velocity.x, bot.body.velocity.z);
    bot.walkPhase += dt * speed * 2.4;
    const swing = Math.min(0.5, speed * 0.09) * Math.sin(bot.walkPhase);
    bot.group.children[2].rotation.x = swing;
    bot.group.children[3].rotation.x = -swing;
  }

  function step(dt, time, ctx) {
    for (const bot of bots) stepBot(bot, dt, time, ctx);
    // Gentle separation so bots do not stack on one waypoint.
    for (let i = 0; i < bots.length; i += 1) {
      for (let j = i + 1; j < bots.length; j += 1) {
        const a = bots[i];
        const b = bots[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.body.position.x - a.body.position.x;
        const dz = b.body.position.z - a.body.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.64 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (0.8 - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.body.position.x -= nx * push;
          a.body.position.z -= nz * push;
          b.body.position.x += nx * push;
          b.body.position.z += nz * push;
        }
      }
    }
  }

  return {
    bots,
    hitMeshes,
    step,
    resetRound,
    damage,
    hearNoise,
    assignObjectives,
    aliveCounts() {
      let ember = 0;
      let ash = 0;
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.team === 'EMBER') ember += 1;
        else ash += 1;
      }
      return { EMBER: ember, ASH: ash };
    },
    carrier() {
      return bots.find((b) => b.isCarrier) ?? null;
    },
    setCarrier(bot) {
      for (const b of bots) b.isCarrier = false;
      if (bot) bot.isCarrier = true;
    },
    setRetrieve(bot, x, z) {
      if (bot) bot.retrieve = { x, z };
    },
    nearestAlive(team, x, z) {
      let best = null;
      let bestD = Infinity;
      for (const b of bots) {
        if (!b.alive || b.team !== team) continue;
        const dx = b.body.position.x - x;
        const dz = b.body.position.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    },
  };
}
