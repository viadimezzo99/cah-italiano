// Suoni e musica generati con Web Audio: nessun file esterno.
// La musica è un loop di 4 battute: batteria, basso e versi sintetizzati (rutti, scorregge,
// starnuti, colpi di tosse) nei punti fissi del loop, così ogni giro suona uguale.
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let musicOn = false, sfxOn = true, timer = null, step = 0, nextTime = 0;
  let STEP = 60 / 100 / 4; // sedicesimi: cambia con il tema (menu più lento, partita più ritmata)
  let theme = "menu";
  const TEMPO = { menu: 92, game: 110 };
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

  // Effetti che imitano le carte: strisciate, schiocchi sul tavolo, fruscio di mazzo.
  // Tutti basati sul rumore filtrato, così suonano come carta e non come bip.
  const tap = (t, f, peak) => blip(f, t, 0.06, "sine", sfxBus, peak, f * 0.5);
  // Vibrazione breve per ogni evento (millisecondi; liste = pausa, vibrazione, ...).
  const HAPTIC = {
    tap: 6, key: 3, pick: 10, confirm: [10, 40, 14], deal: 8, flip: 12, paper: 10, tick: 4,
    shuffle: [6, 30, 6, 30, 6, 30, 6], slam: 25, error: [30, 60, 30], win: [40, 80, 40, 80, 120],
  };
  let hapticsOn = true;
  const SFX = {
    pick: (t) => { burst(t, 0.03, 3200, 2, 0.14, sfxBus, "highpass"); tap(t, 260, 0.08); },
    confirm: (t) => { burst(t, 0.05, 2600, 1.5, 0.2, sfxBus, "highpass"); tap(t, 200, 0.14); },
    // Carta appoggiata sul tavolo: strisciata corta e un colpetto secco.
    deal: (t) => { burst(t, 0.14, 2200, 1.1, 0.22, sfxBus, "bandpass", 700); tap(t + 0.12, 180, 0.12); },
    // Carta girata: fruscio che sale.
    flip: (t) => burst(t, 0.2, 900, 0.8, 0.28, sfxBus, "bandpass", 2600),
    // Mazzo mescolato: una serie di scatti rapidi, come una mescolata.
    shuffle: (t) => { for (let i = 0; i < 10; i++) burst(t + i * 0.038 + Math.random() * 0.012, 0.03, 3800 + Math.random() * 800, 1.4, 0.2, sfxBus, "highpass"); },
    // Schiocco di una carta nera sul tavolo: attacco secco e corpo grave.
    slam: (t) => { burst(t, 0.035, 2600, 1, 0.5, sfxBus); tap(t, 150, 0.45); },
    error: (t) => { tap(t, 150, 0.2); burst(t, 0.06, 500, 1, 0.1, sfxBus); },
    // Foglio che si apre: fruscio di carta e qualche crepitio.
    paper: (t) => { burst(t, 0.24, 2400, 0.6, 0.18, sfxBus, "bandpass", 900); for (let k = 0; k < 5; k++) burst(t + 0.03 + k * 0.035 + Math.random() * 0.01, 0.02, 5000, 2, 0.12, sfxBus, "highpass"); },
    // Scatto a ogni carta che passa sotto il dito, come la rotella di una cassaforte.
    tick: (t) => { burst(t, 0.015, 4200, 3, 0.35, sfxBus, "highpass"); tap(t, 1100, 0.06); },
    // Suoni d'interfaccia: un tocco leggero sui pulsanti e un ticchettio per ogni lettera.
    tap: (t) => { burst(t, 0.02, 1800, 2, 0.12, sfxBus, "highpass"); tap(t, 520, 0.04); },
    key: (t) => burst(t, 0.012, 3000, 3, 0.07, sfxBus, "highpass"),
    // Colpo grave dell'apertura, come quello che accompagna il titolo nei giochi di combattimento.
    boom: (t) => { blip(55, t, 0.7, "sine", sfxBus, 0.9, 28); burst(t, 0.12, 300, 0.7, 0.35, sfxBus, "lowpass"); },
    // Vittoria: un applauso di tavolo, diverso dagli altri suoni.
    win: (t) => {
      for (let i = 0; i < 26; i++) {
        const k = i / 26;
        burst(t + k * 0.9 + Math.random() * 0.04, 0.07, 1500 + Math.random() * 1400, 0.8, 0.12 + 0.12 * Math.sin(Math.PI * k), sfxBus);
      }
    },
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

  // Tema dei menu: musica d'attesa, accordi morbidi e arpeggio, come in un ascensore elegante.
  const MENU_CHORDS = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];
  function menuStep(t, s) {
    const pos = s % 64;
    const bar = Math.floor(pos / 16), st = pos % 16;
    const chord = MENU_CHORDS[bar];
    if (st === 0) chord.forEach((n) => blip(hz(n - 12), t, STEP * 15, "sine", musicBus, 0.035));
    if (st % 2 === 0) blip(hz(chord[(st / 2) % 4] + 12), t, STEP * 1.6, "triangle", musicBus, 0.07);
  }

  // Tema della partita: musica da quiz, con l'orologio che ticchetta e un basso che pulsa.
  function gameStep(t, s) {
    const pos = s % 64;
    const bar = Math.floor(pos / 16), st = pos % 16;
    if (st % 4 === 0) burst(t, 0.02, 6000, 3, 0.1, musicBus, "highpass");
    if (st % 4 === 2) burst(t, 0.03, 2600, 2, 0.05, musicBus, "bandpass");
    if (st % 8 === 0) {
      const n = BASS[bar][(st / 4) % 4];
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "sawtooth"; o.frequency.value = hz(n);
      f.type = "lowpass"; f.frequency.value = 420;
      g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 6);
      o.connect(f); f.connect(g); g.connect(musicBus);
      o.start(t); o.stop(t + STEP * 7);
    }
    if (st === 0) blip(hz(84), t, 0.25, "sine", musicBus, 0.05);
  }

  function musicStep(t, s) {
    if (theme === "menu") menuStep(t, s); else gameStep(t, s);
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
      if (hapticsOn && HAPTIC[name] && navigator.vibrate) { try { navigator.vibrate(HAPTIC[name]); } catch { /* nessuna vibrazione */ } }
      if (!sfxOn || !ensure()) return;
      SFX[name]?.(ctx.currentTime + 0.01);
    },
    setHaptics(on) { hapticsOn = !!on; },
    setTheme(name) { theme = name === "game" ? "game" : "menu"; STEP = 60 / TEMPO[theme] / 4; },
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
