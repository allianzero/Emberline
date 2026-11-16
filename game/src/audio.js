// Synthesized sound, no audio files: every effect is built from oscillators and
// filtered noise through WebAudio, so the game ships zero assets. The context is
// created on the first user gesture; in ?shot= captures it stays silent.
export function createAudio() {
  let ctx = null;
  let master = null;
  let windGain = null;
  let enabled = true;

  function ensure() {
    if (ctx) return ctx;
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // A faint wind bed: looped brown-ish noise through a lowpass, very quiet.
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.98;
      data[i] = last * 0.6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    source.connect(filter).connect(windGain).connect(master);
    source.start();
    return ctx;
  }

  function noiseBurst({ duration, filterType, frequency, gain, decay }) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const nodeGain = ctx.createGain();
    nodeGain.gain.setValueAtTime(gain, t);
    nodeGain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    source.connect(filter).connect(nodeGain).connect(master);
    source.start(t);
  }

  function tone({ type, from, to, duration, gain, when = 0 }) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    const nodeGain = ctx.createGain();
    nodeGain.gain.setValueAtTime(gain, t);
    nodeGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(nodeGain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const WEAPON_SOUND = {
    pistol: { noise: 0.5, freq: 1400, thump: 130, dur: 0.09 },
    smg: { noise: 0.42, freq: 1800, thump: 150, dur: 0.07 },
    rifle: { noise: 0.7, freq: 1100, thump: 95, dur: 0.12 },
    sniper: { noise: 1.0, freq: 800, thump: 60, dur: 0.22 },
  };

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEnabled(value) { enabled = value; if (master) master.gain.value = value ? 0.5 : 0; },
    shoot(kind, far = false) {
      const s = WEAPON_SOUND[kind] ?? WEAPON_SOUND.rifle;
      const scale = far ? 0.35 : 1;
      noiseBurst({ duration: s.dur, filterType: 'bandpass', frequency: s.freq, gain: s.noise * scale, decay: s.dur });
      tone({ type: 'sine', from: s.thump, to: 45, duration: s.dur * 1.4, gain: 0.5 * scale });
    },
    dryFire() { tone({ type: 'square', from: 900, to: 700, duration: 0.04, gain: 0.12 }); },
    reload() {
      tone({ type: 'square', from: 500, to: 380, duration: 0.05, gain: 0.14 });
      tone({ type: 'square', from: 620, to: 480, duration: 0.05, gain: 0.14, when: 0.28 });
      tone({ type: 'square', from: 760, to: 640, duration: 0.06, gain: 0.16, when: 0.62 });
    },
    hit(kill) {
      tone({ type: 'sine', from: kill ? 1320 : 990, to: kill ? 990 : 880, duration: 0.07, gain: 0.2 });
      if (kill) tone({ type: 'sine', from: 1760, to: 1760, duration: 0.12, gain: 0.18, when: 0.08 });
    },
    hurt() {
      tone({ type: 'sawtooth', from: 160, to: 70, duration: 0.18, gain: 0.25 });
      noiseBurst({ duration: 0.12, filterType: 'lowpass', frequency: 500, gain: 0.3, decay: 0.12 });
    },
    step() { noiseBurst({ duration: 0.05, filterType: 'lowpass', frequency: 300, gain: 0.06, decay: 0.05 }); },
    buy() {
      tone({ type: 'sine', from: 880, to: 880, duration: 0.08, gain: 0.16 });
      tone({ type: 'sine', from: 1320, to: 1320, duration: 0.14, gain: 0.16, when: 0.09 });
    },
    denied() { tone({ type: 'square', from: 220, to: 180, duration: 0.12, gain: 0.14 }); },
    plantBeep(final) {
      tone({ type: 'sine', from: final ? 1500 : 1150, to: final ? 1500 : 1150, duration: 0.06, gain: 0.2 });
    },
    chargeBeep() { tone({ type: 'sine', from: 1800, to: 1800, duration: 0.05, gain: 0.12 }); },
    explosion() {
      noiseBurst({ duration: 0.7, filterType: 'lowpass', frequency: 400, gain: 1.0, decay: 0.7 });
      tone({ type: 'sine', from: 90, to: 28, duration: 0.8, gain: 0.9 });
    },
    grenadePin() { tone({ type: 'square', from: 700, to: 500, duration: 0.05, gain: 0.12 }); },
    roundWin() {
      tone({ type: 'sine', from: 523, to: 523, duration: 0.14, gain: 0.2 });
      tone({ type: 'sine', from: 659, to: 659, duration: 0.14, gain: 0.2, when: 0.14 });
      tone({ type: 'sine', from: 784, to: 784, duration: 0.26, gain: 0.22, when: 0.28 });
    },
    roundLose() {
      tone({ type: 'sine', from: 392, to: 392, duration: 0.16, gain: 0.2 });
      tone({ type: 'sine', from: 330, to: 330, duration: 0.16, gain: 0.2, when: 0.16 });
      tone({ type: 'sine', from: 262, to: 240, duration: 0.34, gain: 0.22, when: 0.32 });
    },
  };
}
