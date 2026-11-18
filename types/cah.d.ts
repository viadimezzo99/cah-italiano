// Tipi condivisi del gioco, usati solo per il controllo (npm run typecheck): non entrano nell'app.
// Il codice resta JavaScript; questi tipi si richiamano nei commenti JSDoc con import("../types/cah").

// ---- Lessico (Morph-it!, Universal Dependencies): variabili globali in pagina, caricate da file nei test.

/** Etichette morfologiche di una forma, es. ["Nms", "Afp"]: categoria (N/A), genere (m/f), numero (s/p). */
export type LexTags = string[];
/** forma -> etichette */
export type Lexicon = Record<string, LexTags>;
/** lemma -> categoria (N/A) -> "ms"|"mp"|"fs"|"fp" -> forme */
export type Inflections = Record<string, Partial<Record<"N" | "A", Partial<Record<"ms" | "mp" | "fs" | "fp", string[]>>>>>;
/** forma verbale -> [lemma, modo, tempo, numero] */
export type Verbs3 = Record<string, [string, string, string, string][]>;
/** forma -> conteggi per genere e numero nei corpora, es. { ms: 12, fs: 1 } */
export type UdNouns = Record<string, Partial<Record<"ms" | "mp" | "fs" | "fp", number>>>;
/** verbo o espressione -> preposizione retta */
export type Governments = Record<string, string>;

// ---- Carte

export interface WhiteCard { id: string; text: string; cat?: string; family?: string; }
export interface BlackCard { id: string; text: string; blanks: number; cat?: string; }
export interface CardSet { white: WhiteCard[]; black: BlackCard[]; }

// ---- Partita

export interface PlayerInput { id: string; name: string; isBot?: boolean; }
/** Carte già uscite nella stanza: sopravvive alle partite. */
export interface CardPool { white: Set<string>; black: Set<string>; }
export interface GameOptions {
  handSize?: number;
  winScore?: number | null;
  jolly?: boolean;
  rng?: () => number;
  pool?: CardPool;
}
/** Segmento di una carta nera: testo, oppure spazio da riempire. */
export type Segment = { type: "text"; value: string } | { type: "blank"; index: number };
/** Evento restituito dalle mutazioni della partita (serve alla UI per animare). */
export type GameEvent = { type: string; [key: string]: unknown };
