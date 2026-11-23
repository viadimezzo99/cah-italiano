// Nomi che gli script della pagina (tools/*.js) usano senza importarli: nel file finale
// sono tutti nello stesso <script type="module"> (vedi tools/build_web.py).
import type * as GameMod from "../src/game.js";
import type * as Agree from "../src/agreement.js";
import type { CardSet } from "./cah.js";

declare global {
  // Motore di gioco (src/game.js)
  const Game: typeof GameMod.Game;
  const JOLLY: typeof GameMod.JOLLY;
  const JOLLY_MAX: typeof GameMod.JOLLY_MAX;
  const BOT_JUDGE_VIEW_MS: typeof GameMod.BOT_JUDGE_VIEW_MS;
  const DEFAULTS: typeof GameMod.DEFAULTS;
  const seededRng: typeof GameMod.seededRng;
  const shuffle: typeof GameMod.shuffle;
  const segments: typeof GameMod.segments;
  const CUSTOM_MAX_WHITE: typeof GameMod.CUSTOM_MAX_WHITE;
  const CUSTOM_MAX_BLACK: typeof GameMod.CUSTOM_MAX_BLACK;
  const sanitizeCustom: typeof GameMod.sanitizeCustom;
  const mergeCustom: typeof GameMod.mergeCustom;
  const enabledCustom: typeof GameMod.enabledCustom;
  // Concordanza (src/agreement.js)
  const whiteAgreement: typeof Agree.whiteAgreement;
  const fixArticle: typeof Agree.fixArticle;
  const governedPrep: typeof Agree.governedPrep;
  const fillSentence: typeof Agree.fillSentence;
  const sentencePlain: typeof Agree.sentencePlain;
  const ALL_FAMILIES: typeof Agree.ALL_FAMILIES;
  const NOUN_FAMILIES: typeof Agree.NOUN_FAMILIES;
  const acceptsAt: typeof Agree.acceptsAt;
  const blankAccepts: typeof Agree.blankAccepts;
  // Dati incorporati dal build
  const CARDS: CardSet;
  // Firebase (script esterno, versione compat): solo per le stanze online.
  const firebase: any;
}
export {};

// Proprietà aggiunte a window dall'app Android (WebView) e da script esterni.
declare global {
  interface Window {
    /** Ponte verso l'app Android: presente solo nella WebView. */
    AndroidBridge?: any;
    /** Errori nativi segnalati dall'app Android. */
    onNativeError?: (message: string) => void;
    firebase?: any;
    /** Safari vecchi: AudioContext con il prefisso. */
    webkitAudioContext?: typeof AudioContext;
  }
}
