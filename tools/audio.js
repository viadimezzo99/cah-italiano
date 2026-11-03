// Suoni e musica generati con Web Audio: nessun file esterno.
// La musica è un loop di 4 battute: batteria, basso e versi sintetizzati (rutti, scorregge,
// starnuti, colpi di tosse) nei punti fissi del loop, così ogni giro suona uguale.
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let musicOn = false, sfxOn = true, timer = null, step = 0, nextTime = 0;
  const STEP = 60 / 100 / 4; // sedicesimi a 100 BPM
  // Basso: quattro note per battuta, una ogni quattro sedicesimi (MIDI).
  const BASS = [[33, 33, 36, 38], [31, 31, 34, 36], [33, 33, 29, 31], [28, 28, 31, 33]];
  // Versi nel loop: "battuta:sedicesimo" -> verso.
  const VERSI = { "0:15": "rutto", "1:7": "scoreggia", "2:3": "starnuto", "2:13": "tosse", "3:10": "rutto", "3:15": "scoreggia" };

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0.18;
      musicBus.connect(master);
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function blip(freq, t, dur, type, bus, peak, slideTo) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SFX = {
    pick: (t) => blip(880, t, 0.06, "square", sfxBus, 0.05),
    confirm: (t) => { blip(523, t, 0.12, "triangle", sfxBus, 0.25); blip(784, t + 0.09, 0.16, "triangle", sfxBus, 0.25); },
    deal: (t) => blip(320, t, 0.08, "triangle", sfxBus, 0.12, 520),
    flip: (t) => blip(1200, t, 0.09, "sine", sfxBus, 0.12, 600),
    win: (t) => [523, 659, 784, 1046].forEach((f, i) => blip(f, t + i * 0.09, 0.22, "triangle", sfxBus, 0.28)),
    slam: (t) => blip(150, t, 0.2, "sawtooth", sfxBus, 0.3, 40),
    error: (t) => blip(140, t, 0.22, "sawtooth", sfxBus, 0.18, 90),
  };

  // Rumore bianco riusato, filtrato per ottenere i vari versi.
  let noiseBuf = null;
  function noiseSrc() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  function burst(t, dur, freq, q, peak, bus, type = "bandpass", freqEnd = null) {
    const src = noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // Scoreggia: corpo grave con tremolo irregolare e crepitio.
  function scoreggia(t, bus) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(78, t);
    o.frequency.linearRampToValueAtTime(46, t + 0.9);
    f.type = "lowpass"; f.frequency.value = 420;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.04);
    g.gain.setValueAtTime(0.55, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    lfo.frequency.value = 26; lg.gain.value = 0.22;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(f); f.connect(g); g.connect(bus);
    o.start(t); lfo.start(t); o.stop(t + 1); lfo.stop(t + 1);
    burst(t + 0.05, 0.8, 900, 0.7, 0.18, bus);
  }

  // Rutto: onda a dente con vibrato, filtro che scende come una gola che si svuota.
  function rutto(t, bus) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), v = ctx.createOscillator(), vg = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(150, t);
    o.frequency.linearRampToValueAtTime(92, t + 0.75);
    v.frequency.value = 18; vg.gain.value = 14;
    v.connect(vg); vg.connect(o.frequency);
    f.type = "bandpass"; f.Q.value = 3;
    f.frequency.setValueAtTime(560, t);
    f.frequency.linearRampToValueAtTime(260, t + 0.75);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(f); f.connect(g); g.connect(bus);
    o.start(t); v.start(t); o.stop(t + 0.85); v.stop(t + 0.85);
  }

  // Starnuto: un "ha" di rumore, poi un "ciù" che sale.
  function starnuto(t, bus) {
    burst(t, 0.1, 2400, 1.2, 0.35, bus);
    burst(t + 0.12, 0.14, 900, 2, 0.3, bus);
    burst(t + 0.27, 0.22, 1400, 2.5, 0.4, bus, "bandpass", 2600);
  }

  // Colpo di tosse: due scoppi di rumore filtrato.
  function tosse(t, bus) {
    burst(t, 0.12, 1200, 1.5, 0.45, bus, "lowpass");
    burst(t + 0.22, 0.1, 1000, 1.5, 0.4, bus, "lowpass");
  }

  const VERSO = { rutto, scoreggia, starnuto, tosse };

  function musicStep(t, s) {
    const pos = s % 64;
    const bar = Math.floor(pos / 16), st = pos % 16;
    // Batteria: cassa sincopata, rullante sul 2 e sul 4, hi-hat continuo.
    if ([0, 6, 8, 14].includes(st)) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.2);
    }
    if (st === 4 || st === 12) burst(t, 0.12, 1800, 0.8, 0.35, musicBus);
    if (st % 2 === 0) burst(t, 0.035, 7000, 0.5, 0.07, musicBus, "highpass");
    // Basso: una nota ogni quattro sedicesimi.
    if (st % 4 === 0) {
      const n = BASS[bar][st / 4];
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = hz(n);
      f.type = "lowpass"; f.frequency.value = 500;
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 3.5);
      o.connect(f); f.connect(g); g.connect(musicBus);
      o.start(t); o.stop(t + STEP * 4);
    }
    // Versi fissi del loop.
    const verso = VERSI[`${bar}:${st}`];
    if (verso) VERSO[verso](t, musicBus);
  }

  function pump() {
    while (nextTime < ctx.currentTime + 0.15) {
      musicStep(nextTime, step);
      nextTime += STEP;
      step += 1;
    }
  }

  return {
    unlock() { return ensure(); },
    play(name) {
      if (!sfxOn || !ensure()) return;
      SFX[name]?.(ctx.currentTime + 0.01);
    },
    setSfx(on) { sfxOn = !!on; },
    setVolume(v) { if (ensure()) musicBus.gain.value = 0.18 * v; },
    setMusic(on) {
      musicOn = !!on;
      if (!musicOn) { clearInterval(timer); timer = null; if (ctx) musicBus.gain.value = 0; return; }
      if (!ensure()) return;
      musicBus.gain.value = 0.18;
      if (!timer) {
        nextTime = ctx.currentTime + 0.05;
        step = 0;
        timer = setInterval(pump, 60);
      }
    },
  };
})();
