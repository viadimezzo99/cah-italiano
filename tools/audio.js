// Suoni e musica. La musica sono brani registrati incorporati nella pagina: quattro per la home (alternati con dissolvenza), uno per la partita.
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

  // Brani. Ogni brano ha la sua sonorità misurata (LUFS integrati, vedi tools/music/prepare_tracks.py): il volume si regola
  // su quella, così tutti arrivano allo stesso livello anche se uno è più forte o più dinamico di un altro.
  const MUSIC_TARGET_LUFS = -19;      // sonorità di un brano con il cursore delle impostazioni al 100%
  /** @type {Record<string, {src: string, lufs: number}>} */
  const TRACKS = /*TRACKS*/{};
  // Home e menu: quattro brani che si alternano. Partita: un brano solo, in loop.
  /** @type {Record<string, string[]>} */
  const LISTS = { menu: ["menu-1", "menu-2", "menu-3", "menu-4"], game: ["game"] };
  const START_FADE_SEC = 6;           // crescendo quando la musica parte
  const XFADE_SEC = 5;                // dissolvenza incrociata tra un brano della home e il successivo
  const THEME_FADE_SEC = 1.4;         // passaggio tra home e partita
  const LAST_KEY = "cah-music-last";  // l'ultimo brano della home: alla prossima apertura se ne sceglie un altro
  /** @type {Record<string, HTMLAudioElement>} */
  const audioEls = {};
  /** @type {Record<string, number>} */
  const level = {};                   // dissolvenza di ogni brano, da 0 a 1
  /** @type {Map<string, {from: number, to: number, t0: number, ms: number, done?: () => void}>} */
  const fades = new Map();
  /** @type {string|null} */
  let current = null;                 // il brano in corso (o in pausa, se l'app è in secondo piano)
  let crossing = false;               // una dissolvenza incrociata è già partita
  /** @type {string[]} */
  let queue = [];                     // i brani della home ancora da suonare, in ordine mescolato
  let musicTimer = null;
  /** @type {string|null} */
  let lastMenu = (() => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } })();

  const isMenu = (name) => LISTS.menu.includes(name);
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // Il prossimo brano della home. La coda si rimescola quando finisce e non ricomincia mai dal brano appena suonato.
  function peekNext() {
    if (!queue.length) {
      queue = shuffled(LISTS.menu);
      const last = current && isMenu(current) ? current : lastMenu;
      if (queue.length > 1 && queue[0] === last) queue.push(/** @type {string} */ (queue.shift()));
    }
    return queue[0];
  }
  const takeNext = () => { const n = peekNext(); queue.shift(); return n; };

  function track(name) {
    if (!audioEls[name]) {
      const a = new Audio(TRACKS[name].src);
      a.preload = "auto";
      a.loop = !isMenu(name);
      // Se il brano finisce prima che la dissolvenza sia partita (pagina rallentata in secondo piano), passa lo stesso al successivo.
      a.addEventListener("ended", () => { if (!a.loop && current === name && theme === "menu" && musicOn && !pausedByApp) startTrack(takeNext(), 1.5, 0); });
      audioEls[name] = a;
    }
    return audioEls[name];
  }
  function trackTarget(name) {
    const gain = Math.pow(10, (MUSIC_TARGET_LUFS - TRACKS[name].lufs) / 20);
    return Math.max(0, Math.min(1, gain * musicLevel));
  }
  // Volume finale = livello di sonorità del brano x dissolvenza. La dissolvenza è a potenza costante (seno), così
  // incrociando due brani il volume non cala a metà.
  function applyVolume(name) {
    const a = audioEls[name];
    if (!a) return;
    const k = Math.max(0, Math.min(1, level[name] ?? 0));
    try { a.volume = Math.max(0, Math.min(1, trackTarget(name) * Math.sin(k * Math.PI / 2))); } catch (e) { /* alcuni browser non cambiano il volume */ }
  }
  function fade(name, to, sec, done) {
    fades.set(name, { from: level[name] ?? 0, to, t0: Date.now(), ms: sec * 1000, done });
  }
  function tickMusic() {
    for (const [name, f] of [...fades]) {
      const k = f.ms <= 0 ? 1 : Math.min(1, (Date.now() - f.t0) / f.ms);
      level[name] = f.from + (f.to - f.from) * k;
      applyVolume(name);
      if (k >= 1) { fades.delete(name); if (f.done) f.done(); }
    }
    // Il brano della home sta per finire: parte il successivo, con dissolvenza incrociata.
    if (theme === "menu" && current && !crossing) {
      const a = audioEls[current];
      if (a && !a.paused && isFinite(a.duration) && a.duration > 0 && a.duration - a.currentTime <= XFADE_SEC) crossTo(takeNext(), XFADE_SEC);
    }
  }
  // Fa partire un brano dall'inizio con un crescendo (da `from` a 1).
  function startTrack(name, sec, from) {
    const a = track(name);
    current = name;
    if (isMenu(name)) {
      lastMenu = name;
      try { localStorage.setItem(LAST_KEY, name); } catch { /* nessuno storage: alla prossima apertura può ripetersi */ }
    }
    try { a.currentTime = 0; } catch (e) { /* brano non ancora caricato: parte dall'inizio comunque */ }
    level[name] = from;
    applyVolume(name);
    fade(name, 1, sec);
    a.play().catch(() => { /* il browser chiede prima un tocco */ });
    if (isMenu(name)) track(peekNext());   // il prossimo si prepara in anticipo, così la dissolvenza è senza attese
  }
  // Il brano in corso sfuma mentre il successivo sale.
  function crossTo(name, sec) {
    const old = current;
    crossing = true;
    startTrack(name, sec, 0);
    if (old && old !== name) fade(old, 0, sec, () => { if (audioEls[old]) audioEls[old].pause(); level[old] = 0; crossing = false; });
    else crossing = false;
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

  // Ferma i brani e le dissolvenze in corso. Il brano resta "in corso": alla ripresa continua da dov'era.
  function stopAll() {
    clearInterval(musicTimer); musicTimer = null;
    fades.clear(); crossing = false;
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
  // Menu o partita. Partita: il brano in loop. Home: i quattro brani in ordine mescolato, uno dopo l'altro.
  function startMusic() {
    if (pausedByApp || !musicOn) return;
    if (!gestureSeen) { armGesture(); return; }
    if (!musicTimer) musicTimer = setInterval(tickMusic, 120);
    const cur = current ? audioEls[current] : null;
    if (cur && !cur.paused) return;                                       // già in corso, con la sua dissolvenza
    if (current && cur && (theme === "game") === !isMenu(current)) {      // era in pausa (app in secondo piano): riprende da dov'era
      fade(current, 1, 2);
      cur.play().catch(() => { /* il browser chiede prima un tocco */ });
      return;
    }
    startTrack(theme === "game" ? "game" : takeNext(), START_FADE_SEC, 0.2);
  }
  // Home <-> partita: il brano di prima sfuma mentre parte quello nuovo.
  function switchTheme() {
    const old = current;
    if (old && audioEls[old] && !audioEls[old].paused) fade(old, 0, THEME_FADE_SEC, () => { if (audioEls[old]) audioEls[old].pause(); level[old] = 0; });
    crossing = false;
    startTrack(theme === "game" ? "game" : takeNext(), START_FADE_SEC, 0.2);
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
      if (!changed) return;
      if (musicOn && !pausedByApp && gestureSeen) switchTheme();
      else { stopAll(); current = null; }   // musica spenta o app in secondo piano: al ritorno parte il brano del nuovo tema
    },
    // Il brano successivo della home, subito (dissolvenza breve). Vale solo in home e con la musica accesa.
    skip() {
      if (!musicOn || pausedByApp || !gestureSeen || theme !== "menu") return false;
      crossTo(takeNext(), 1.5);
      return true;
    },
    /** Quale brano della home suona ("Brano 2 di 4"), oppure null. */
    info() {
      if (!musicOn || theme !== "menu" || !current || !isMenu(current)) return null;
      return { index: LISTS.menu.indexOf(current) + 1, total: LISTS.menu.length };
    },
    setSfx(on) { sfxOn = !!on; },
    setUiSounds(on) { uiOn = !!on; },
    setSfxVolume(v) { sfxLevel = Math.max(0, Math.min(1, v)); if (sfxBus) sfxBus.gain.value = sfxLevel; },
    setVolume(v) { musicLevel = v; for (const name in audioEls) applyVolume(name); },
    setMusic(on) {
      musicOn = !!on;
      if (!musicOn) { stopAll(); return; }
      startMusic();
    },
  };
})();
