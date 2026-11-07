// Suoni e musica generati con Web Audio: nessun file esterno.
// La musica è un loop di 4 battute: batteria, basso e versi sintetizzati (rutti, scorregge,
// starnuti, colpi di tosse) nei punti fissi del loop, così ogni giro suona uguale.
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let musicOn = false, sfxOn = true, timer = null, step = 0, nextTime = 0;
  let STEP = 60 / 100 / 4; // sedicesimi: cambia con il tema (menu più lento, partita più ritmata)
  let theme = "menu";
  let musicLevel = 1;                 // volume scelto nelle impostazioni (0..1)
  let sfxLevel = 1;                   // volume effetti scelto nelle impostazioni (0..1)
  let pausedByApp = false;            // la pagina è in secondo piano o chiusa: la musica tace
  // Brano del menu (file incorporato nella pagina). Il volume è più basso degli effetti, così non li copre.
  const MENU_MP3 = "/*MENU_MP3*/";
  const MENU_VOLUME = 0.4;
  let menuAudio = null;
  function menuTrack() {
    if (!menuAudio) { menuAudio = new Audio(MENU_MP3); menuAudio.loop = true; menuAudio.preload = "auto"; }
    return menuAudio;
  }
  const TEMPO = { menu: 66, game: 66 };   // notturno lento, uguale in menu e in partita
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
      sfxBus.gain.value = sfxLevel;
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
    saved: [10, 40, 14], // carta salvata: solo vibrazione, nessun suono
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
    // Suoni scelti nelle prove: sovrascrivono quelli sopra con lo stesso nome.
    pick: (t) => { burst(t, 0.02, 3500, 2, 0.3, sfxBus); blip(2000, t, 0.02, "sine", sfxBus, 0.1); },
    deal: (t) => { for (let k = 0; k < 5; k++) burst(t + k * 0.07, 0.025, 2600, 2, 0.25, sfxBus); },
    flip: (t) => { burst(t, 0.03, 1500, 3, 0.3, sfxBus); burst(t + 0.07, 0.03, 1500, 3, 0.3, sfxBus); },
    tap: (t) => burst(t, 0.02, 1800, 2, 0.2, sfxBus),
    error: (t) => blip(90, t, 0.15, "sine", sfxBus, 0.5),
    win: (t) => blip(784, t, 0.8, "sine", sfxBus, 0.35),
    confirm: (t) => { blip(523, t, 0.12, "sine", sfxBus, 0.35); blip(659, t + 0.05, 0.12, "sine", sfxBus, 0.35); blip(784, t + 0.1, 0.2, "sine", sfxBus, 0.35); },
    turn: (t) => { blip(440, t, 0.07, "sine", sfxBus, 0.3); blip(660, t + 0.11, 0.1, "sine", sfxBus, 0.3); },
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
  // Notturno al piano: un solo sottofondo, lento e dolce, in loop per tutta l'app (menu e partita).
  // Accordi morbidi, una melodia di pianoforte sul quarto e una risonanza lontana. Volume sotto i suoni del gioco.
  const NOCTURNE = [[57, 60, 64, 69], [53, 57, 60, 65], [50, 53, 57, 62], [52, 56, 59, 64]];
  const NOCT_MELODY = [0, 2, 1, 2];
  function menuStep(t, s) {
    const pos = s % 64;
    const bar = Math.floor(pos / 16), st = pos % 16;
    const chord = NOCTURNE[bar];
    if (st === 0) {
      blip(hz(chord[0] - 12), t, STEP * 14, "sine", musicBus, 0.06);
      chord.slice(1).forEach((n) => blip(hz(n - 12), t, STEP * 14, "sine", musicBus, 0.025));
    }
    if (st % 4 === 0) {
      const n = chord[NOCT_MELODY[(st / 4) % 4]] + 12;
      blip(hz(n), t, STEP * 6, "triangle", musicBus, 0.07);
    }
    if (st === 6 || st === 14) blip(hz(chord[0] + 24), t, STEP * 5, "sine", musicBus, 0.02);
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
    if (theme === "game") menuStep(t, s);   // in partita: notturno al piano; nel menu suona il brano
  }

  function pump() {
    while (nextTime < ctx.currentTime + 0.15) {
      musicStep(nextTime, step);
      nextTime += STEP;
      step += 1;
    }
  }

  // Musica solo con l'app in primo piano: in secondo piano o alla chiusura il brano si ferma.
  function hideMusic() {
    if (!musicOn || pausedByApp) return;
    pausedByApp = true;
    stopAll();
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => { /* nessun contesto attivo */ });
  }
  function showMusic() {
    if (!pausedByApp) return;
    pausedByApp = false;
    if (!musicOn) return;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => { /* il browser lo rifiuta: si riprova al prossimo tocco */ });
    startMusic();
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", () => (document.hidden ? hideMusic() : showMusic()));
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("pagehide", hideMusic);

  return {
    unlock() { return ensure(); },
    play(name) {
      if (hapticsOn && HAPTIC[name] && navigator.vibrate) { try { navigator.vibrate(HAPTIC[name]); } catch { /* nessuna vibrazione */ } }
      if (!sfxOn || !ensure()) return;
      SFX[name]?.(ctx.currentTime + 0.01);
    },
    setHaptics(on) { hapticsOn = !!on; },
    setTheme(name) { theme = name === "game" ? "game" : "menu"; STEP = 60 / TEMPO[theme] / 4; if (musicOn) { stopAll(); startMusic(); } },
    setSfx(on) { sfxOn = !!on; },
    setSfxVolume(v) { sfxLevel = Math.max(0, Math.min(1, v)); if (sfxBus) sfxBus.gain.value = sfxLevel; },
    setVolume(v) { musicLevel = v; if (musicOn) startMusic(); },
    setMusic(on) {
      musicOn = !!on;
      if (!musicOn) { stopAll(); return; }
      startMusic();
    },
  };

  // Ferma sia il brano sia il sintetizzatore.
  function stopAll() {
    clearInterval(timer); timer = null;
    if (menuAudio) menuAudio.pause();
    if (ctx) musicBus.gain.value = 0;
  }

  // Menu: il brano in loop. Partita: il notturno sintetizzato.
  function startMusic() {
    if (pausedByApp) return;
    if (theme === "menu") {
      if (ctx) musicBus.gain.value = 0;
      if (timer) { clearInterval(timer); timer = null; }
      const a = menuTrack();
      a.volume = Math.max(0, Math.min(1, MENU_VOLUME * musicLevel));
      a.play().catch(() => { /* il browser chiede prima un tocco */ });
      return;
    }
    if (menuAudio) menuAudio.pause();
    if (!ensure()) return;
    musicBus.gain.value = 0.18 * musicLevel;
    if (!timer) {
      nextTime = ctx.currentTime + 0.05;
      step = 0;
      timer = setInterval(pump, 60);
    }
  }
})();
