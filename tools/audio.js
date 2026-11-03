// Suoni e musica generati con Web Audio: nessun file esterno.
// La musica è un loop semplice (accordi Am–F–C–G, arpeggio e basso).
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let musicOn = false, sfxOn = true, timer = null, step = 0, nextTime = 0;
  const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (MIDI)
  const STEP = 60 / 100 / 2; // ottavi a 100 BPM

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

  function musicStep(t, s) {
    const chord = PROG[Math.floor(s / 8) % PROG.length];
    const n = chord[s % 3] + (s % 4 === 3 ? 12 : 0);
    blip(hz(n), t, STEP * 0.9, "triangle", musicBus, 0.5);
    if (s % 8 === 0) blip(hz(chord[0] - 24), t, STEP * 3.5, "sine", musicBus, 0.8);
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
