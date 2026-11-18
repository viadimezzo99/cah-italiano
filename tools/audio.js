// Suoni e musica. La musica sono due brani registrati (menu e partita), in loop, incorporati nella pagina.
// Gli effetti sono sintetizzati con Web Audio (nessun file): tutti sulle note della tonalità dei brani (do minore),
// tutti allo stesso livello di picco, così stanno insieme alla musica senza coprirla né sparire.
const Sound = (() => {
  let ctx = null, master = null, sfxBus = null;
  let musicOn = false, sfxOn = true;
  let gestureSeen = false, gestureArmed = false;
  let theme = "menu";                 // "menu" o "game": decide quale brano suona
  let musicLevel = 1;                 // volume musica scelto nelle impostazioni (0..1)
  let sfxLevel = 1;                   // volume effetti scelto nelle impostazioni (0..1)
  let pausedByApp = false;            // la pagina è in secondo piano o chiusa: la musica tace

  // Brani. Ogni file ha la sua sonorità misurata (LUFS integrati): il volume si regola su quella,
  // così menu e partita suonano allo stesso livello anche se uno è più dinamico dell'altro.
  const MUSIC_TARGET_LUFS = -19;      // sonorità di un brano con il cursore delle impostazioni al 100%
  const TRACKS = {
    menu: { src: "/*MENU_MP3*/", lufs: -14.9 },
    game: { src: "/*GAME_MP3*/", lufs: -18.8 },
  };
  const RAMP_SEC = 6;                 // quanto dura il crescendo all'inizio
  const audioEls = {};
  function track(name) {
    if (!audioEls[name]) {
      const a = new Audio(TRACKS[name].src);
      a.loop = true; a.preload = "auto";
      audioEls[name] = a;
    }
    return audioEls[name];
  }
  function trackTarget(name) {
    const gain = Math.pow(10, (MUSIC_TARGET_LUFS - TRACKS[name].lufs) / 20);
    return Math.max(0, Math.min(1, gain * musicLevel));
  }
  let rampT0 = 0, rampTimer = null, rampName = null;
  // Volume del brano in corso: sale da quasi zero fino al livello scelto in RAMP_SEC secondi.
  function rampTo(name) {
    clearInterval(rampTimer);
    rampName = name; rampT0 = Date.now();
    const a = track(name);
    const tick = () => {
      const k = Math.min(1, (Date.now() - rampT0) / (RAMP_SEC * 1000));
      const target = trackTarget(name);
      const start = Math.max(0.02, target * 0.2);
      try { a.volume = start + (target - start) * k; } catch (e) { /* alcuni browser non cambiano il volume */ }
      if (k >= 1) { clearInterval(rampTimer); rampTimer = null; }
    };
    tick();
    rampTimer = setInterval(tick, 150);
  }

  // Effetti: guadagno che porta il picco di ciascuno a -12 dB (effetti di gioco) o -18 dB (interfaccia).
  // Valori misurati renderizzando ogni effetto (vedi scratchpad/audio/measure.cjs); ricalcolare se cambia un suono.
  const TRIM_DB = {
    shuffle: 2.5, slam: -5.6, paper: 7.7, tick: -8.4, key: 6.4, boom: -8.6, pick: 6.0, deal: 12.1,
    flip: 14.3, tap: 10.5, error: -2.3, win: -0.9, confirm: -0.8, turn: 0.5, trumpet: 5.4, pair: 0.5,
  };
  // Vibrazione breve per ogni evento (millisecondi; liste = pausa, vibrazione, ...).
  const HAPTIC = {
    saved: [10, 40, 14], // carta salvata: solo vibrazione, nessun suono
    tap: 6, key: 3, pick: 10, confirm: [10, 40, 14], deal: 8, flip: 12, paper: 10, tick: 4,
    shuffle: [6, 30, 6, 30, 6, 30, 6], slam: 25, error: [30, 60, 30], win: [40, 80, 40, 80, 120],
    trumpet: [50, 60, 50, 60, 50, 60, 220],
    pair: [40, 50, 40],   // coppia trovata nel Memory: doppio colpo, più netto del flip
  };
  let hapticsOn = true;
  // Suoni d'interfaccia (tocchi, digitazione, scorrimento): si possono spegnere senza toccare quelli di gioco.
  const UI_SOUNDS = new Set(["tap", "key", "tick"]);
  let uiOn = true;

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

  // Rumore bianco riusato, filtrato per ottenere i suoni di carta, mazzo e scatti.
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

  // Scatto di un colpo: un'onda sinusoidale corta che scende, come un tocco sul tavolo.
  const tap = (t, f, peak, bus) => blip(f, t, 0.06, "sine", bus, peak, f * 0.5);

  // Ogni effetto riceve il suo bus (già regolato di livello) e l'istante di inizio.
  // Le note sono quelle del do minore dei brani: D3, Do6, Sol6, Sol1, Do5, Mib5, Sol5, Sol4.
  const SFX = {
    // Mazzo mescolato: una serie di scatti rapidi, come una mescolata.
    shuffle: (t, b) => { for (let i = 0; i < 10; i++) burst(t + i * 0.038 + Math.random() * 0.012, 0.03, 3800 + Math.random() * 800, 1.4, 0.2, b, "highpass"); },
    // Schiocco di una carta nera sul tavolo: attacco secco e corpo grave (re3, la nota più bassa del brano).
    slam: (t, b) => { burst(t, 0.035, 2600, 1, 0.5, b); tap(t, 146.83, 0.45, b); },
    // Foglio che si apre: fruscio di carta e qualche crepitio.
    paper: (t, b) => { burst(t, 0.24, 2400, 0.6, 0.18, b, "bandpass", 900); for (let k = 0; k < 5; k++) burst(t + 0.03 + k * 0.035 + Math.random() * 0.01, 0.02, 5000, 2, 0.12, b, "highpass"); },
    // Scatto a ogni carta che passa sotto il dito, come la rotella di una cassaforte.
    tick: (t, b) => { burst(t, 0.015, 4200, 3, 0.35, b, "highpass"); tap(t, 1046.5, 0.06, b); },
    key: (t, b) => burst(t, 0.012, 3000, 3, 0.07, b, "highpass"),
    // Colpo grave dell'apertura (sol1).
    boom: (t, b) => { blip(49, t, 0.7, "sine", b, 0.9, 24.5); burst(t, 0.12, 300, 0.7, 0.35, b, "lowpass"); },
    // Carta appoggiata sul tavolo: un fruscio e un tintinnio sol6.
    pick: (t, b) => { burst(t, 0.02, 3500, 2, 0.3, b); blip(1567.98, t, 0.02, "sine", b, 0.1); },
    deal: (t, b) => { for (let k = 0; k < 5; k++) burst(t + k * 0.07, 0.025, 2600, 2, 0.25, b); },
    flip: (t, b) => { burst(t, 0.03, 1500, 3, 0.3, b); burst(t + 0.07, 0.03, 1500, 3, 0.3, b); },
    tap: (t, b) => burst(t, 0.02, 1800, 2, 0.2, b),
    // Errore: una nota grave, sol2.
    error: (t, b) => blip(98, t, 0.15, "sine", b, 0.5),
    // Vittoria: sol5.
    win: (t, b) => blip(783.99, t, 0.8, "sine", b, 0.35),
    // Conferma: accordo di do minore (do5, mi bemolle5, sol5).
    confirm: (t, b) => { blip(523.25, t, 0.12, "sine", b, 0.35); blip(622.25, t + 0.05, 0.12, "sine", b, 0.35); blip(783.99, t + 0.1, 0.2, "sine", b, 0.35); },
    // Cambio turno: dal sol4 al do5, una quarta che sale.
    turn: (t, b) => { blip(392, t, 0.07, "sine", b, 0.3); blip(523.25, t + 0.11, 0.1, "sine", b, 0.3); },
    // Tromba del jolly: sol4, do5, mi bemolle5, sol5; l'ultima tenuta. Arpeggio minore.
    trumpet: (t, b) => { blip(392, t, 0.16, "sawtooth", b, 0.16); blip(523.25, t + 0.18, 0.16, "sawtooth", b, 0.16); blip(622.25, t + 0.36, 0.16, "sawtooth", b, 0.16); blip(783.99, t + 0.54, 0.7, "sawtooth", b, 0.18); },
    // Coppia trovata nel Memory: do5 poi sol5, un piccolo richiamo.
    pair: (t, b) => { blip(523.25, t, 0.12, "sine", b, 0.3); blip(783.99, t + 0.08, 0.25, "sine", b, 0.3); },
  };

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

  // Ferma i brani e il crescendo in corso.
  function stopAll() {
    clearInterval(rampTimer); rampTimer = null;
    for (const name in audioEls) audioEls[name].pause();
  }

  // Prima di un tocco il browser non fa partire l'audio: il brano parte al primo gesto, senza errori né doppioni.
  function armGesture() {
    if (gestureArmed || typeof document === "undefined") return;
    gestureArmed = true;
    const first = () => {
      gestureSeen = true;
      document.removeEventListener("pointerdown", first, true);
      document.removeEventListener("keydown", first, true);
      if (musicOn && !pausedByApp) startMusic();
    };
    document.addEventListener("pointerdown", first, true);
    document.addEventListener("keydown", first, true);
  }
  // Menu o partita: il brano del tema in loop, con crescendo; l'altro si ferma.
  function startMusic() {
    if (pausedByApp || !musicOn) return;
    if (!gestureSeen) { armGesture(); return; }
    const other = theme === "game" ? "menu" : "game";
    if (audioEls[other]) audioEls[other].pause();
    rampTo(theme);
    track(theme).play().catch(() => { /* il browser chiede prima un tocco */ });
  }

  return {
    unlock() { return ensure(); },
    play(name) {
      if (hapticsOn && HAPTIC[name] && navigator.vibrate) { try { navigator.vibrate(HAPTIC[name]); } catch { /* nessuna vibrazione */ } }
      if (!sfxOn || (!uiOn && UI_SOUNDS.has(name)) || !ensure()) return;
      const fx = SFX[name];
      if (!fx) return;   // alcuni eventi sono solo vibrazione (es. "saved")
      // Livello dell'effetto: il guadagno che porta il suo picco al riferimento (vedi TRIM_DB).
      const bus = ctx.createGain();
      bus.gain.value = Math.pow(10, (TRIM_DB[name] ?? 0) / 20);
      bus.connect(sfxBus);
      fx(ctx.currentTime + 0.01, bus);
    },
    setHaptics(on) { hapticsOn = !!on; },
    setTheme(name) {
      // La partita richiama questa funzione a ogni schermata: riavvia il brano solo se il tema cambia davvero.
      const next = name === "game" ? "game" : "menu";
      const changed = next !== theme;
      theme = next;
      if (changed && musicOn) { stopAll(); startMusic(); }
    },
    setSfx(on) { sfxOn = !!on; },
    setUiSounds(on) { uiOn = !!on; },
    setSfxVolume(v) { sfxLevel = Math.max(0, Math.min(1, v)); if (sfxBus) sfxBus.gain.value = sfxLevel; },
    setVolume(v) { musicLevel = v; if (musicOn && rampName && !rampTimer) track(rampName).volume = trackTarget(rampName); },
    setMusic(on) {
      musicOn = !!on;
      if (!musicOn) { stopAll(); return; }
      startMusic();
    },
  };
})();
