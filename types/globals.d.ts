// Variabili globali che la pagina definisce prima degli script (vedi tools/build_web.py).
import type { Lexicon, Inflections, Verbs3, UdNouns, Governments } from "./cah";
declare global {
  var LEX: Lexicon;
  var INFLECT: Inflections;
  var VERBS3: Verbs3;
  var UD_NOMI: UdNouns;
  var REGGENZE: Governments;
}
export {};
