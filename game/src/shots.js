// Deterministic captures: stage a real frame of the game, then freeze it.
// Each scene runs the real simulation (bots walk their routes, the round state is
// real), then the player is placed, aims and — for the play scene — fires once,
// so the screenshot shows the game as it actually plays.
import * as THREE from 'three';

export function stageShot(name, G) {
  const { hud, match, player, bots, weapons } = G;
  hud.hideOverlay();
  hud.hideBuy();
  hud.hideProgress();
  hud.clearCharge();
  hud.setCarry(false);

  if (name === 'start') {
    // Title screen: the player at the EMBER spawn, looking up mid toward the
    // silo and the two sites, the start panel on top.
    match.state.phase = 'lobby';
    match.state.round = 1;
    match.state.score.EMBER = 0;
    match.state.score.ASH = 0;
    match.state.money = 800;
    bots.resetRound(G.map.spawns, 'A');
    G.teleportPlayer(0, 14.5, 0, 0.02);
    G.settle(30);
    hud.setScore(0, 0, 1);
    hud.setTimer(100);
    hud.setMoney(800);
    hud.setHealth(100);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve);
    hud.setWeapon(weapons.def().name);
    hud.showOverlay('start');
  } else if (name === 'play') {
    // Mid-round, round 2, 1-0: six seconds of real combat first, then the
    // player steps out near mid and fires at the nearest ASH bot.
    match.state.phase = 'round';
    match.state.round = 2;
    match.state.score.EMBER = 1;
    match.state.score.ASH = 0;
    match.state.timer = 72;
    match.state.money = 2400;
    match.state.site = 'A';
    bots.resetRound(G.map.spawns, 'A');
    weapons.addOwned('rifle');
    weapons.equip('rifle');
    G.teleportPlayer(0, 14.5, 0, 0);
    G.settle(360);
    // Find a firing position with a real line of sight to an ASH bot: try the
    // mid lane first, then the flanks, so the shot shows the enemy, not a wall.
    let target = null;
    for (const [x, z] of [[0, 9], [0, 6], [-8, 2], [8, 2], [2, 4], [0, 14.5]]) {
      G.teleportPlayer(x, z, 0, 0);
      target = G.visibleEnemyBot();
      if (target) break;
    }
    if (!target) {
      G.teleportPlayer(2, 4, 0, 0);
      target = G.nearestEnemyBot();
    }
    if (target) {
      G.aimAtPoint(new THREE.Vector3(target.body.position.x, target.body.position.y + 1.2, target.body.position.z));
      G.firePlayerOnce();
    }
    G.settle(2);
    hud.setScore(1, 0, 2);
    hud.setMoney(2400);
    hud.setHealth(Math.max(1, Math.round(player.health())));
  } else if (name === 'buy') {
    // Buy phase before round 3, 2-0: the buy menu open, rifle owned, $4100 left.
    match.state.phase = 'buy';
    match.state.round = 3;
    match.state.score.EMBER = 2;
    match.state.score.ASH = 0;
    match.state.timer = 12;
    match.state.money = 4100;
    match.state.site = 'B';
    bots.resetRound(G.map.spawns, 'B');
    weapons.addOwned('rifle');
    weapons.addOwned('smg');
    weapons.equip('rifle');
    weapons.addGrenade();
    G.teleportPlayer(0, 14.5, 0, 0);
    G.settle(20);
    hud.setScore(2, 0, 3);
    hud.setTimer(12);
    hud.setMoney(4100);
    hud.setHealth(100);
    hud.setAmmo(weapons.state.mag, weapons.state.reserve);
    hud.setWeapon(weapons.def().name);
    hud.setGrenades(weapons.grenadeCount());
    hud.showBuy(4100, weapons.owned, weapons.grenadeCount());
  } else {
    // Round end: EMBER takes round 4, 3-1, the charge went off at Site A.
    match.state.phase = 'roundEnd';
    match.state.round = 4;
    match.state.score.EMBER = 3;
    match.state.score.ASH = 1;
    match.state.timer = 4;
    match.state.money = 5650;
    match.state.site = 'A';
    bots.resetRound(G.map.spawns, 'A');
    G.teleportPlayer(-2, -2, 0, 0);
    G.settle(20);
    // The round was hard-fought: the warden really is at 64 HP here.
    player.damage(36);
    G.aimAtPoint(new THREE.Vector3(-13, 1.5, -11));
    hud.setScore(3, 1, 4);
    hud.setMoney(5650);
    hud.showOverlay('roundEnd', {
      title: 'EMBER takes the round',
      copy: 'The charge detonated at Site A. EMBER 3 — ASH 1.',
    });
  }
}
