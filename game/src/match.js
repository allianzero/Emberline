// The match: five rounds to win, a buy phase between rounds, and a charge that
// decides rounds. Pure state and timers; main.js drives it and applies the
// outcomes (respawns, bot objectives, HUD). Money is the player's: kills, plants
// and round results pay into it, the buy menu spends it.
export const WIN_ROUNDS = 5;
export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const PLANT_FUSE = 35;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;

export function createMatch(onEvent) {
  const state = {
    phase: 'lobby',
    round: 0,
    score: { EMBER: 0, ASH: 0 },
    timer: 0,
    money: 800,
    site: null,
    planted: null, // { site, pos: Vector3, fuse }
    plantProgress: 0,
    defuseProgress: 0,
    lastReason: '',
    winner: null,
  };

  function emit(type, data) {
    if (onEvent) onEvent(type, data);
  }

  function pickSite(random) {
    return random() < 0.5 ? 'A' : 'B';
  }

  return {
    state,
    startMatch(random) {
      state.phase = 'buy';
      state.round = 1;
      state.score.EMBER = 0;
      state.score.ASH = 0;
      state.money = 800;
      state.planted = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.winner = null;
      state.timer = BUY_TIME;
      state.site = pickSite(random);
      emit('matchStart', { round: 1, site: state.site });
      emit('buyStart', { round: 1, site: state.site });
    },
    startRound() {
      state.phase = 'round';
      state.timer = ROUND_TIME;
      state.planted = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      emit('roundStart', { round: state.round, site: state.site });
    },
    endRound(winner, reason) {
      if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
      state.score[winner] += 1;
      state.lastReason = reason;
      state.money += winner === 'EMBER' ? WIN_REWARD : LOSS_REWARD;
      state.phase = 'roundEnd';
      state.timer = 4.5;
      emit('roundEnd', { winner, reason, score: { ...state.score }, round: state.round });
      if (state.score[winner] >= WIN_ROUNDS) {
        state.winner = winner;
        state.phase = 'matchEnd';
        state.timer = 8;
        emit('matchEnd', { winner, score: { ...state.score } });
      }
    },
    nextRound(random) {
      state.round += 1;
      state.phase = 'buy';
      state.timer = BUY_TIME;
      state.planted = null;
      state.plantProgress = 0;
      state.defuseProgress = 0;
      state.site = pickSite(random);
      emit('buyStart', { round: state.round, site: state.site });
    },
    plant(site, pos) {
      state.planted = { site, pos: pos.clone(), fuse: PLANT_FUSE };
      state.plantProgress = 0;
      state.money += PLANT_REWARD;
      emit('planted', { site, fuse: PLANT_FUSE });
    },
    defuse() {
      state.planted = null;
      state.defuseProgress = 0;
      state.money += DEFUSE_REWARD;
      emit('defused', {});
    },
    addKillReward() {
      state.money += KILL_REWARD;
    },
    spend(amount) {
      if (state.money < amount) return false;
      state.money -= amount;
      return true;
    },
    step(dt) {
      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) this.startRound();
      } else if (state.phase === 'round') {
        state.timer -= dt;
        if (state.planted) {
          state.planted.fuse -= dt;
          if (state.planted.fuse <= 0) {
            emit('exploded', { site: state.planted.site });
            this.endRound('EMBER', 'charge detonated');
          }
        } else if (state.timer <= 0) {
          this.endRound('ASH', 'time expired — site held');
        }
      } else if (state.phase === 'roundEnd') {
        state.timer -= dt;
        if (state.timer <= 0 && state.phase === 'roundEnd') {
          // main.js picks the next round up via the event below.
          emit('roundEndDone', { round: state.round });
        }
      } else if (state.phase === 'matchEnd') {
        state.timer -= dt;
      }
    },
  };
}
