# Cards Against Humanity (italiano) — motore di gioco

Prototipo del gioco: regole, partite locali contro bot, test automatici.
Il client grafico e il server online verranno aggiunti dopo.

## Struttura

- `data/cards.json` — carte bianche e nere estratte dal sorgente LaTeX (generato).
- `tools/build_cards.py` — rigenera `data/cards.json` da un file `.tex`.
- `src/game.js` — regole: mani, pesca, Re che ruota, spazi, punteggi, timeout.
- `test/game.test.js` — test delle regole.
- `tools/play_local.js` — partita da terminale tra 4 bot.

## Comandi

```
python3 tools/build_cards.py <sorgente.tex> data/cards.json
npm test
npm run typecheck
npm run play
```

## Controllo dei tipi

Il codice resta JavaScript: nessuna compilazione, l'app non cambia. TypeScript legge i file e i commenti JSDoc
e segnala gli errori prima che arrivino nell'app (nomi sbagliati, argomenti mancanti, valori che possono essere null).

- `tsconfig.json` — motore (`src/`) e server: controllo anche dei valori null.
- `tsconfig.web.json` — script della pagina (`tools/app.js`, `room.js`, `audio.js`, `spell.js`), che nel file finale
  condividono lo stesso spazio di nomi.
- `types/` — forme condivise (carte, partita, lessico) e nomi globali della pagina.

Il controllo gira anche su GitHub prima di compilare l'APK.

## Mazzi: codice di condivisione

"Mazzi → Opzioni → Condividi o importa → Crea il codice" carica il mazzo su Firebase in `decks/<codice>` (6 caratteri, 14 giorni)
e "Mazzi → Ricevi mazzo" lo scarica come mazzo nuovo. Serve che le regole del Realtime Database lascino leggere e scrivere
quel percorso. Da aggiungere accanto alla regola già presente per `rooms` (console Firebase → Realtime Database → Regole):

```json
"decks": {
  "$code": { ".read": true, ".write": "!data.exists() || !newData.exists()" }
}
```

Si può creare o cancellare un codice, non sovrascriverlo; l'elenco di `decks` non è leggibile, solo il singolo codice.
Se le regole lo vietano l'app lo dice ("Il servizio dei codici non è attivo") e resta la copia delle frasi come testo.

## Decisioni aperte

- Punteggio per la vittoria: le regole non lo fissano; ora è 8 di default, configurabile.
- Timeout e scelta casuale: implementati come `autoPlay` e `autoPick`; i tempi li decide la stanza.
- Correzione di articoli e genere: non ancora implementata.
- Bot: al momento giocano a caso; una strategia migliore si può aggiungere senza cambiare il motore.

## Licenza

Il materiale delle carte è CC BY-NC-SA 2.0 IT: uso non commerciale, con attribuzione e stessa licenza.
