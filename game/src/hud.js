// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, team scores,
// kill feed, a top-down minimap, the buy menu and every overlay panel. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, GRENADE } from './weapons.js';

const BUY_COPY = {
  start: { title: 'EMBERLINE', copy: 'Five attackers, five defenders. Plant the Spark Charge at Site A or Site B — or clear the other team. Click to play.', action: 'Click to play' },
  paused: { title: 'EMBERLINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  dead: { title: 'You are down', copy: 'Spectating a teammate until the round ends.', action: '' },
  roundEnd: { title: '', copy: '', action: '' },
  matchEnd: { title: '', copy: '', action: 'Play again' },
};

export function createHud(map, callbacks) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playBtn = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageVignette = $('damage-vignette');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const healthBar = $('health-fill');
  const healthNum = $('health-num');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreEmber = $('score-ember');
  const scoreAsh = $('score-ash');
  const roundValue = $('round-value');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyGrid = $('buy-grid');
  const progress = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const chargeChip = $('charge-chip');
  const chargeTimer = $('charge-timer');
  const carryChip = $('carry-chip');
  const scoreboard = $('scoreboard');
  const scoreboardBody = $('scoreboard-body');
  const minimap = $('minimap');
  const minimapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = -1;

  // Build the buy menu buttons once.
  const buyButtons = {};
  function buyButton(key, title, detail, price) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${title}</span><span class="buy-detail">${detail}</span><span class="buy-price">$${price}</span>`;
    button.addEventListener('click', () => callbacks.onBuy(key));
    buyGrid.appendChild(button);
    buyButtons[key] = button;
    return button;
  }
  buyButton('1', WEAPONS.pistol.name, '12 / 36 · semi-auto', WEAPONS.pistol.price);
  buyButton('2', WEAPONS.smg.name, '32 / 96 · fast, close range', WEAPONS.smg.price);
  buyButton('3', WEAPONS.rifle.name, '30 / 90 · accurate, all-round', WEAPONS.rifle.price);
  buyButton('4', WEAPONS.sniper.name, '5 / 15 · one-shot headshot', WEAPONS.sniper.price);
  buyButton('5', GRENADE.name, 'fuse 1.8 s · area damage', GRENADE.price);
  const buyClose = document.createElement('button');
  buyClose.type = 'button';
  buyClose.className = 'buy-close';
  buyClose.textContent = 'Close [B]';
  buyClose.addEventListener('click', () => callbacks.onBuyClose());
  buyGrid.appendChild(buyClose);

  function refreshBuy(money, owned, grenades) {
    buyMoney.textContent = `$${money}`;
    for (const key of ['1', '2', '3', '4']) {
      const kind = { 1: 'pistol', 2: 'smg', 3: 'rifle', 4: 'sniper' }[key];
      const button = buyButtons[key];
      const price = WEAPONS[kind].price;
      button.classList.toggle('owned', owned.includes(kind));
      button.classList.toggle('cant', !owned.includes(kind) && money < price);
      button.querySelector('.buy-price').textContent = owned.includes(kind) ? 'OWNED' : `$${price}`;
    }
    const g = buyButtons['5'];
    g.classList.toggle('cant', money < GRENADE.price);
    g.querySelector('.buy-price').textContent = grenades > 0 ? `x${grenades} · $${GRENADE.price}` : `$${GRENADE.price}`;
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) { weaponName.textContent = name; },
    setGrenades(n) { $('grenade-count').textContent = n > 0 ? `◈ ${n}` : ''; },
    setHealth(hp) {
      if (hp === lastHealth) return;
      lastHealth = hp;
      healthBar.style.width = `${Math.max(0, hp)}%`;
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthBar.classList.toggle('low', hp <= 30);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      if (s === lastTimer) return;
      lastTimer = s;
      timerValue.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timerValue.classList.toggle('urgent', s <= 10);
    },
    setScore(ember, ash, round) {
      scoreEmber.textContent = String(ember);
      scoreAsh.textContent = String(ash);
      roundValue.textContent = `ROUND ${round}`;
    },
    setSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageVignette.classList.add('on');
      setTimeout(() => damageVignette.classList.remove('on'), 180);
    },
    killFeed(text, team) {
      const line = document.createElement('div');
      line.className = `feed-line ${team === 'EMBER' ? 'ember' : 'ash'}`;
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
    },
    showBanner(title, sub, holdMs = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    showOverlay(mode, data = {}) {
      const text = BUY_COPY[mode];
      if (mode === 'roundEnd') {
        overlayTitle.textContent = data.title ?? '';
        overlayCopy.textContent = data.copy ?? '';
        playBtn.textContent = '';
        playBtn.style.display = 'none';
      } else if (mode === 'matchEnd') {
        overlayTitle.textContent = data.title ?? '';
        overlayCopy.textContent = data.copy ?? '';
        playBtn.textContent = text.action;
        playBtn.style.display = '';
      } else {
        overlayTitle.textContent = text.title;
        overlayCopy.textContent = text.copy;
        playBtn.textContent = text.action;
        playBtn.style.display = mode === 'dead' ? 'none' : '';
      }
      overlay.hidden = false;
      if (mode !== 'dead' && mode !== 'roundEnd') playBtn.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { playBtn.addEventListener('click', handler); },
    showBuy(money, owned, grenades) {
      refreshBuy(money, owned, grenades);
      buyMenu.hidden = false;
    },
    hideBuy() { buyMenu.hidden = true; },
    updateBuy(money, owned, grenades) {
      if (!buyMenu.hidden) refreshBuy(money, owned, grenades);
    },
    isBuyOpen() { return !buyMenu.hidden; },
    setProgress(label, fraction) {
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    },
    hideProgress() { progress.hidden = true; },
    setCharge(site, fuse) {
      chargeChip.hidden = false;
      chargeChip.querySelector('.charge-site').textContent = `CHARGE AT SITE ${site}`;
      chargeTimer.textContent = `${Math.max(0, Math.ceil(fuse))}s`;
      chargeTimer.classList.toggle('urgent', fuse <= 10);
    },
    clearCharge() { chargeChip.hidden = true; },
    setCarry(has) { carryChip.hidden = !has; },
    showScoreboard(rows) {
      scoreboard.hidden = false;
      scoreboardBody.innerHTML = rows.map((r) => (
        `<tr class="${r.team === 'EMBER' ? 'ember' : 'ash'}${r.you ? ' you' : ''}"><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.team}</td></tr>`
      )).join('');
    },
    hideScoreboard() { scoreboard.hidden = true; },
    drawMinimap(player, bots, chargePos) {
      const w = minimap.width;
      const h = minimap.height;
      const { halfX, halfZ } = map.bounds;
      const toX = (x) => ((x + halfX) / (halfX * 2)) * w;
      const toY = (z) => ((z + halfZ) / (halfZ * 2)) * h;
      minimapCtx.clearRect(0, 0, w, h);
      minimapCtx.fillStyle = 'rgba(20,16,12,0.85)';
      minimapCtx.fillRect(0, 0, w, h);
      minimapCtx.fillStyle = '#5a4a38';
      for (const wall of map.minimapWalls) {
        minimapCtx.fillRect(toX(wall.x), toY(wall.z), Math.max(1, (wall.w / (halfX * 2)) * w), Math.max(1, (wall.d / (halfZ * 2)) * h));
      }
      minimapCtx.font = 'bold 11px system-ui, sans-serif';
      minimapCtx.textAlign = 'center';
      minimapCtx.textBaseline = 'middle';
      minimapCtx.fillStyle = '#ff7a2f';
      minimapCtx.fillText('A', toX(map.sites.A.center.x), toY(map.sites.A.center.z));
      minimapCtx.fillStyle = '#37c8c3';
      minimapCtx.fillText('B', toX(map.sites.B.center.x), toY(map.sites.B.center.z));
      if (chargePos) {
        minimapCtx.fillStyle = '#e5484d';
        minimapCtx.beginPath();
        minimapCtx.arc(toX(chargePos.x), toY(chargePos.z), 4, 0, Math.PI * 2);
        minimapCtx.fill();
      }
      const dot = (x, z, color, r = 3) => {
        minimapCtx.fillStyle = color;
        minimapCtx.beginPath();
        minimapCtx.arc(toX(x), toY(z), r, 0, Math.PI * 2);
        minimapCtx.fill();
      };
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.minimapVisible === false) continue;
        dot(bot.body.position.x, bot.body.position.z, bot.team === 'EMBER' ? '#ff7a2f' : '#37c8c3', bot.team === 'EMBER' ? 3 : 2.5);
      }
      // The player: a white wedge showing facing.
      const px = toX(player.position.x);
      const py = toY(player.position.z);
      minimapCtx.fillStyle = '#ffffff';
      minimapCtx.beginPath();
      minimapCtx.moveTo(px + Math.sin(-player.yaw) * 6, py + Math.cos(-player.yaw) * 6);
      minimapCtx.lineTo(px + Math.sin(-player.yaw + 2.5) * 5, py + Math.cos(-player.yaw + 2.5) * 5);
      minimapCtx.lineTo(px + Math.sin(-player.yaw - 2.5) * 5, py + Math.cos(-player.yaw - 2.5) * 5);
      minimapCtx.closePath();
      minimapCtx.fill();
    },
  };
}
