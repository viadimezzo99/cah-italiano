// Frasi di riferimento: per ogni difetto di grammatica trovato nella revisione a campione (lettura di 400 frasi costruite
// dal motore) c'è la frase corretta scritta a mano. Se un cambiamento al motore riporta un errore, qui si vede.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dataJson = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
globalThis.LEX = dataJson("data/lexicon_it/lex.json");
globalThis.REGGENZE = dataJson("data/reggenze.json");
globalThis.INFLECT = dataJson("data/lexicon_it/inflect.json");
for (const [sg, g, pl] of dataJson("data/lexicon_it/gaps.json").nomi) {
  if (sg in LEX) continue;
  LEX[sg] = [...(LEX[sg] || []), "N" + g + "s"];
  LEX[pl] = [...(LEX[pl] || []), ...(LEX[pl] || []).includes("N" + g + "p") ? [] : ["N" + g + "p"]];
  INFLECT[sg] = { N: { [g + "s"]: [sg], [g + "p"]: [pl] } };
}
globalThis.VERBS3 = dataJson("data/lexicon_it/verbs3.json");
globalThis.UD_NOMI = dataJson("data/lexicon_it/ud_nomi.json");
const { sentencePlain } = await import("../src/agreement.js");

/** [titolo, carta nera, risposte, frase attesa] */
const GOLD = [
  // --- Accordo di verbo, participio e aggettivo con il soggetto (risposta con articolo, numerale, partitivo)
  ["participio dopo soggetto con articolo (femminile)", "Da oggi, sugli aerei, ____ è vietato.", ["La mia collezione di giocattoli erotici high-tech."], "Da oggi, sugli aerei, la mia collezione di giocattoli erotici high-tech è vietata."],
  ["participio dopo soggetto con articolo (femminile, altra nera)", "Secondo il mio medico, ____ è sconsigliato.", ["Lo Schiaccianoci: la danza della Fata Confetto."], "Secondo il mio medico, lo Schiaccianoci: la danza della Fata Confetto è sconsigliata."],
  ["participio con 'va'", "Nel mio nuovo lavoro: ____ va inserito nel report trimestrale.", ["La mia vagina."], "Nel mio nuovo lavoro: la mia vagina va inserita nel report trimestrale."],
  ["avverbio tra ausiliare e participio", "Ho un sacco di problemi, ma ____ non è mai stato tra questi.", ["Pornostar."], "Ho un sacco di problemi, ma una pornostar non è mai stata tra questi."],
  ["soggetto plurale con articolo e copula", "____ è il modo in cui voglio morire!", ["Le mie tette."], "Le mie tette sono il modo in cui voglio morire!"],
  ["partitivo: il genere non si perde (verranno scolpite)", "Quando sarò milionario, ____ verrà scolpito in una statua di 30 metri.", ["Mestruazioni."], "Quando sarò milionario, le mestruazioni verranno scolpite in una statua di 30 metri."],
  ["partitivo: il genere non si perde (sono state)", "Per la festa di laurea: ____ è stato il regalo del mio amico.", ["Api?"], "Per la festa di laurea: le api sono state il regalo del mio amico."],
  ["numerale: soggetto plurale", "Per la festa di laurea: ____ è stato il regalo del mio amico.", ["Due nani che stanno cagando in un secchio."], "Per la festa di laurea: due nani che stanno cagando in un secchio sono stati il regalo del mio amico."],
  ["ausiliare e participio, partitivo", "Alla cena di famiglia, ____ è stato accolto con silenzio.", ["Api."], "Alla cena di famiglia, le api sono state accolte con silenzio."],
  ["soggetto plurale: verbo e pronome nel testo fisso", "____ dà un vantaggio ingiusto ai giocatori, per questo la Serie A lo ha vietato.", ["Anziani uomini giapponesi."], "Gli anziani uomini giapponesi danno un vantaggio ingiusto ai giocatori, per questo la Serie A li ha vietati."],
  ["pronome nel testo fisso: femminile singolare", "____ dà un vantaggio ingiusto ai giocatori, per questo la Serie A lo ha vietato.", ["Carestia."], "Una carestia dà un vantaggio ingiusto ai giocatori, per questo la Serie A l'ha vietata."],
  ["pronome nel testo fisso: nome proprio", "____ dà un vantaggio ingiusto ai giocatori, per questo la Serie A lo ha vietato.", ["Skeletor."], "Skeletor dà un vantaggio ingiusto ai giocatori, per questo la Serie A lo ha vietato."],
  ["verbo con soggetto plurale e verbo composto", "Alla Ruota della Fortuna: ____ mi ha portato alla rovina, la soluzione è ____.", ["Le mie zie.", "Caccole."], "Alla Ruota della Fortuna: le mie zie mi hanno portato alla rovina, la soluzione sono delle caccole."],
  ["verbo dopo ogni spazio", "Nel testamento ho scritto: ____ va a mio fratello e ____ va al gatto.", ["Il mio orologio.", "Le mie scarpe."], "Nel testamento ho scritto: il mio orologio va a mio fratello e le mie scarpe vanno al gatto."],
  ["verbo al futuro dopo ogni spazio", "Per il mio prossimo numero, ____ farà ridere e ____ farà piangere.", ["Il mio gatto.", "Le mie zie."], "Per il mio prossimo numero, il mio gatto farà ridere e le mie zie faranno piangere."],
  ["soggetti coordinati: participio al plurale", "La commissione d'esame ha chiesto: ____ e ____ vanno ritirati dal programma.", ["Carestia.", "Caccole."], "La commissione d'esame ha chiesto: una carestia e le caccole vanno ritirate dal programma."],
  ["soggetti coordinati di genere diverso", "Nel regolamento del condominio è scritto: ____, ____ e ____ sono vietati.", ["Cane.", "Carestia.", "Sandali."], "Nel regolamento del condominio è scritto: un cane, una carestia e i sandali sono vietati."],
  ["due participi dopo i soggetti", "Ho sbagliato la risposta facile: ____ e ____ sono andati persi davanti a tutta l'Italia.", ["Una carestia.", "Le caccole."], "Ho sbagliato la risposta facile: una carestia e le caccole sono andate perse davanti a tutta l'Italia."],
  ["participio subito dopo lo spazio", "La nuova moda di primavera: ____, abbinato a ____.", ["Calze.", "Sandali."], "La nuova moda di primavera: delle calze, abbinate ai sandali."],
  ["aggettivo dopo lo spazio, ellissi del verbo", "Il sindaco ha annunciato una legge: ____ sarà vietato, ____ obbligatorio.", ["Carestia.", "Zoo."], "Il sindaco ha annunciato una legge: una carestia sarà vietata, uno zoo obbligatorio."],
  ["aggettivo dopo lo spazio nel mezzo della frase", "Voci dicono che il piatto preferito di Vladimir Putin è ____ ripieno di ____", ["Torta.", "Caccole."], "Voci dicono che il piatto preferito di Vladimir Putin è una torta ripiena di caccole"],
  ["verbo riflessivo composto", "Mentre ero sotto gli effetti degli acidi, ____ si è trasformato in ____.", ["Le mie zie.", "Caccole."], "Mentre ero sotto gli effetti degli acidi, le mie zie si sono trasformate in caccole."],

  // --- Copula con predicato plurale
  ["copula con predicato plurale (soggetto singolare)", "Ma prima che la uccida, signor Bond, la mia unica richiesta è ____.", ["I miei demoni interiori."], "Ma prima che la uccida, signor Bond, la mia unica richiesta sono i miei demoni interiori."],
  ["copula con predicato partitivo", "Nel mio prossimo film il protagonista è ____.", ["Conati di vomito."], "Nel mio prossimo film il protagonista sono dei conati di vomito."],
  ["copula con predicato plurale nudo", "La mia password è ____.", ["Abusi infantili."], "La mia password sono degli abusi infantili."],

  // --- Pronomi e participi del testo fisso che si riferiscono alla risposta
  ["participi del testo fisso, plurale", "Ho provato: ____. Testato dai bambini, approvato dalle madri.", ["I miei demoni interiori."], "Ho provato: i miei demoni interiori. Testati dai bambini, approvati dalle madri."],
  ["participi del testo fisso, femminile", "Ho provato: ____. Testato dai bambini, approvato dalle madri.", ["Carestia."], "Ho provato: una carestia. Testata dai bambini, approvata dalle madri."],
  ["'uno' del testo fisso, femminile", "Ecco la mia offerta: ____. Scommetto che non ne desideri soltanto uno!", ["Allusione sul ceto sociale."], "Ecco la mia offerta: un'allusione sul ceto sociale. Scommetto che non ne desideri soltanto una!"],
  ["'uno' del testo fisso, maschile", "Ecco la mia offerta: ____. Scommetto che non ne desideri soltanto uno!", ["Neonati morti."], "Ecco la mia offerta: dei neonati morti. Scommetto che non ne desideri soltanto uno!"],
  ["'questo' del testo fisso, plurale", "Per il mio compleanno: ____, soltanto questo.", ["Centauri."], "Per il mio compleanno: dei centauri, soltanto questi."],
  ["'questo' del testo fisso, femminile", "Per il mio compleanno: ____, soltanto questo.", ["Stupidità incomprensibile."], "Per il mio compleanno: una stupidità incomprensibile, soltanto questa."],

  // --- Infinito: dopo preposizione serve l'articolo; con i pronomi attaccati resta un infinito
  ["infinito dopo 'contro'", "Nel nuovo film della Disney, Hannah Montana si scontra per la prima volta contro ____", ["Rimorchiare ragazze all'ospedale dopo un aborto."], "Nel nuovo film della Disney, Hannah Montana si scontra per la prima volta contro il rimorchiare ragazze all'ospedale dopo un aborto."],
  ["infinito dopo 'su' (il)", "Quest'anno a Broadway debutta un musical su ____.", ["Fare l'occhiolino a persone anziane."], "Quest'anno a Broadway debutta un musical sul fare l'occhiolino a persone anziane."],
  ["infinito dopo 'su' (lo)", "Quest'anno a Broadway debutta un musical su ____.", ["Scambiarsi le siringhe."], "Quest'anno a Broadway debutta un musical sullo scambiarsi le siringhe."],
  ["infinito dopo 'su' (l')", "Nel tentativo di attrarre nuove persone, il museo nazionale di Storia Naturale inaugurerà una mostra interattiva su ____", ["Essere sboccati."], "Nel tentativo di attrarre nuove persone, il museo nazionale di Storia Naturale inaugurerà una mostra interattiva sull'essere sboccati"],
  ["infinito con pronomi attaccati", "Durante il trascurato Periodo Marrone, Picasso ha prodotto centinaia di quadri su ____", ["Farsela addosso."], "Durante il trascurato Periodo Marrone, Picasso ha prodotto centinaia di quadri sul farsela addosso"],
  ["infinito riflessivo dopo 'su'", "Durante il trascurato Periodo Marrone, Picasso ha prodotto centinaia di quadri su ____", ["Rimangiarsi quello che si è detto."], "Durante il trascurato Periodo Marrone, Picasso ha prodotto centinaia di quadri sul rimangiarsi quello che si è detto"],
  ["infinito dopo 'di' resta com'è", "Sono Valerio Staffelli e sono qui per parlarvi di ____.", ["Rimangiarsi quello che si è detto."], "Sono Valerio Staffelli e sono qui per parlarvi di rimangiarsi quello che si è detto."],

  // --- Articoli, elisione, preposizioni
  ["h muta: l'herpes", "Qual è il mio potere segreto? ____", ["Herpes labiale."], "Qual è il mio potere segreto? L'herpes labiale."],
  ["genere dall'aggettivo che precede il nome", "Come faccio a mantenere la mia attuale relazione? ____", ["Un operoso cinese."], "Come faccio a mantenere la mia attuale relazione? Un operoso cinese."],
  ["elisione senza spazio dopo la preposizione della domanda", "A cosa rinuncio per la quaresima? ____", ["Obesità."], "A cosa rinuncio per la quaresima? All'obesità."],
  ["maiuscola dopo il punto interrogativo", "Di cosa odorano le persone anziane? ____", ["Una sorpresa salata."], "Di cosa odorano le persone anziane? Di una sorpresa salata."],
  ["nome proprio in domanda con preposizione", "A cosa rinuncio per la quaresima? ____", ["Dio."], "A cosa rinuncio per la quaresima? A Dio."],
  ["nome invariabile plurale dopo preposizione", "Quando il faraone rimase impassibile, Mosè scatenò la piaga di ____", ["Gay."], "Quando il faraone rimase impassibile, Mosè scatenò la piaga dei gay"],
  ["nome invariabile plurale dopo 'a'", "La vita degli indiani d'America cambiò per sempre quando gli uomini bianchi li introdussero a ____", ["Gay."], "La vita degli indiani d'America cambiò per sempre quando gli uomini bianchi li introdussero ai gay"],
  ["nome femminile con complemento dopo 'di'", "La medicina alternativa sta ora adottando i poteri curativi di ____", ["Cena a buffet per 5 euro."], "La medicina alternativa sta ora adottando i poteri curativi della cena a buffet per 5 euro"],
  ["nome femminile con complemento dopo 'a'", "Recenti studi hanno mostrato che topi di laboratorio impiegano il 50% in meno per uscire da un labirinto se sono stati esposti a ____", ["Cena a buffet per 5 euro."], "Recenti studi hanno mostrato che topi di laboratorio impiegano il 50% in meno per uscire da un labirinto se sono stati esposti alla cena a buffet per 5 euro"],
  ["nome ambiguo aggettivo/plurale (molle)", "Cosa aiuterebbe Monti a rilassarsi? ____", ["Molle Slinky attorcigliate."], "Cosa aiuterebbe Monti a rilassarsi? Delle molle Slinky attorcigliate."],

  // --- Maiuscole e minuscole
  ["nome proprio sconosciuto resta maiuscolo", "Inventa un haiku: ____.", ["Auschwitz."], "Inventa un haiku: Auschwitz."],
  ["marchio sconosciuto resta maiuscolo", "La mia password è ____.", ["Mac."], "La mia password è Mac."],
  ["verbo all'infinito con nome proprio dopo", "La mia password è ____.", ["Imboccare Platinette."], "La mia password è imboccare Platinette."],
  ["aggettivo di nazionalità in maiuscolo nella carta", "Cosa mi crea flatulenze incontrollabili? ____", ["1 kg di eroina Messicana di scarsa qualità."], "Cosa mi crea flatulenze incontrollabili? 1 kg di eroina messicana di scarsa qualità."],
  ["titolo a maiuscole: nome e aggettivo", "Quando il faraone rimase impassibile, Mosè scatenò la piaga di ____", ["Scuole Superiori."], "Quando il faraone rimase impassibile, Mosè scatenò la piaga delle scuole superiori"],
  ["nome proprio composto (istituzione)", "È un peccato che i ragazzini al giorno d'oggi partecipino a ____", ["Popolo delle Libertà."], "È un peccato che i ragazzini al giorno d'oggi partecipino al Popolo delle Libertà"],

  // --- Coordinazioni
  ["nomi coordinati senza articolo", "Cos'è questo odore? ____", ["Sole e arcobaleni."], "Cos'è questo odore? Sole e arcobaleni."],
  ["nomi coordinati maiuscoli", "Il tema della prossima maturità è ____.", ["Stupro e Saccheggio."], "Il tema della prossima maturità sono stupro e saccheggio."],

  // --- Casi che oggi vanno già bene: non devono peggiorare
  ["articolo indeterminativo, soggetto singolare maschile", "Da oggi, sugli aerei, ____ è vietato.", ["Un momento di silenzio."], "Da oggi, sugli aerei, un momento di silenzio è vietato."],
  ["soggetto femminile con participio già giusto", "Da oggi, sugli aerei, ____ è vietato.", ["Carestia."], "Da oggi, sugli aerei, una carestia è vietata."],
  ["soggetto plurale nudo", "Da oggi, sugli aerei, ____ è vietato.", ["Batteri Mangia-Carne."], "Da oggi, sugli aerei, i batteri Mangia-Carne sono vietati."],
  ["copula con plurale già giusta", "Non so con che armi sarà combattuta la terza guerra mondiale. Ma nella quarta, ____ sarà l'arma.", ["Cristalli di metanfetamina."], "Non so con che armi sarà combattuta la terza guerra mondiale. Ma nella quarta, i cristalli di metanfetamina saranno l'arma."],
  ["preposizione articolata davanti a vocale", "Sono Valerio Staffelli e sono qui per parlarvi di ____.", ["Invidia per il pene."], "Sono Valerio Staffelli e sono qui per parlarvi dell'invidia per il pene."],
  ["infinito dopo 'a' (verbo che regge a)", "È un peccato che i ragazzini al giorno d'oggi partecipino a ____", ["Barare alle Paraolimpiadi."], "È un peccato che i ragazzini al giorno d'oggi partecipino a barare alle Paraolimpiadi"],

  // --- Secondo giro di revisione (campione a occhio cieco): difetti trovati e corretti
  ["nome proprio inglese con 'of' resta maiuscolo", "Per il mio prossimo numero, ____ farà ridere e ____ farà piangere.", ["World of Warcraft.", "Sesso a sorpresa."], "Per il mio prossimo numero, World of Warcraft farà ridere e un sesso a sorpresa farà piangere."],
  ["intestazione 'Passo 2:' non è un aggettivo", "Passo 1: ____ Passo 2: ____ Passo 3: Guadagno!", ["Selezione naturale.", "Spassarsela."], "Passo 1: una selezione naturale Passo 2: spassarsela Passo 3: Guadagno!"],
  ["'fino' non concorda", "Ho bevuto ____ fino all'ultima goccia.", ["Un'antilope che soffre di flatulenza."], "Ho bevuto un'antilope che soffre di flatulenza fino all'ultima goccia."],
  ["sigla in maiuscolo dopo 'a'", "Hai mai pensato a ____? C'è un'app per quello.", ["AIDS."], "Hai mai pensato ad AIDS? C'è un'app per quello."],
  ["sigla in maiuscolo con l'articolo", "Sul curriculum, alla voce hobby: ____.", ["AIDS."], "Sul curriculum, alla voce hobby: l'AIDS."],
  ["niente partitivo dopo 'senza'", "Una romantica cena a lume di candela è incompleta senza ____", ["Carte contro l'umanità."], "Una romantica cena a lume di candela è incompleta senza le carte contro l'umanità."],
  ["nome comune con complemento in maiuscolo non è un'istituzione", "Al primo appuntamento: ____ è il regalo che ho portato.", ["Video di Barbara D'Urso in lacrime mentre ascolta una storia triste."], "Al primo appuntamento: un video di Barbara D'Urso in lacrime mentre ascolta una storia triste è il regalo che ho portato."],
  ["participio dopo il soggetto plurale (nome sconosciuto al lessico come aggettivo)", "L'ultima frontiera della tecnologia: ____ collegato a ____.", ["Batteri Mangia-Carne.", "Lunchables."], "L'ultima frontiera della tecnologia: dei batteri Mangia-Carne collegati a Lunchables."],
  ["'trasformato in' con nome singolare: articolo indeterminativo", "Ho visto il gatto che si è trasformato in ____.", ["Metodo naturale."], "Ho visto il gatto che si è trasformato in un metodo naturale."],
  ["'trasformato in' con plurale: nome nudo", "Ho visto il gatto che si è trasformato in ____.", ["Caccole."], "Ho visto il gatto che si è trasformato in caccole."],
  ["'trasformato in un' non si contrae", "Mentre ero sotto gli effetti degli acidi, ____ si è trasformato in ____.", ["Il sangue di Cristo.", "Un robusto mongoloide."], "Mentre ero sotto gli effetti degli acidi, il sangue di Cristo si è trasformato in un robusto mongoloide."],
  ["seconda copula senza soggetto: plurale", "La lezione di oggi: ____ non è ____, è un'opinione.", ["Gli psicofarmaci.", "Un consulente."], "La lezione di oggi: gli psicofarmaci non sono un consulente, sono un'opinione."],
  ["'un po' di': il nome resta nudo", "Il segreto del successo? Un po' di ____ e un pizzico di ____.", ["Faccia tosta.", "Tetano."], "Il segreto del successo? Un po' di faccia tosta e un pizzico di tetano."],
  ["plurale che il lessico non ha (capre)", "Il rischiatutto: ____ vale 10 punti, ____ vale 20 e ____ vale il jackpot!", ["Gli untori.", "Una nonna.", "Capre che si stanno mangiando lattine."], "Il rischiatutto: gli untori valgono 10 punti, una nonna vale 20 e le capre che si stanno mangiando lattine valgono il jackpot!"],
  ["nome comune scritto con le maiuscole della carta, con trattino", "Da oggi, sugli aerei, ____ è vietato.", ["Lecca-Lecca gigante."], "Da oggi, sugli aerei, un lecca-lecca gigante è vietato."],
  ["nome proprio con trattino resta com'è", "Il mio hobby preferito è ____.", ["Pac-Man."], "Il mio hobby preferito è Pac-Man."],
  ["nome che il lessico ha solo come aggettivo", "Il regalo perfetto per il mio capo è ____.", ["Preadolescente."], "Il regalo perfetto per il mio capo è un preadolescente."],
  ["misura + 'di': il contenuto perde l'articolo", "Ingredienti: ____ e una spruzzata di ____.", ["L'AIDS.", "La selezione naturale."], "Ingredienti: l'AIDS e una spruzzata di selezione naturale."],
  ["misura + 'di': resta il possessivo", "Il segreto è un pizzico di ____.", ["La mia vagina."], "Il segreto è un pizzico della mia vagina."],
  ["quantificatore singolare senza articolo (troppo gel)", "Ieri ho bevuto troppo ____ per capelli.", ["Il gel."], "Ieri ho bevuto troppo gel per capelli."],
  ["plurale per natura (Amish): verbo plurale", "____ sono stati il mio regalo.", ["Amish."], "Gli amish sono stati il mio regalo."],
  ["nome che il lessico dà come aggettivo (mutilati)", "Nel regolamento è scritto: ____ è vietato.", ["Mutilati."], "Nel regolamento è scritto: i mutilati sono vietati."],
];

for (const [title, black, whites, expected] of GOLD) {
  test(`grammatica: ${title}`, () => {
    // Il confronto ignora il punto o il testo finale lasciato com'è dalla carta nera quando l'atteso non lo riporta.
    const got = sentencePlain(black, whites);
    // Se la carta nera finisce con lo spazio (senza punto), la frase finisce con il punto della carta bianca.
    const want = /____\s*$/.test(black) && !/[.!?]$/.test(expected.trim()) ? expected.trim() + "." : expected.trim();
    assert.equal(got.trim(), want);
  });
}
