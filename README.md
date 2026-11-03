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
npm run play
```

## Decisioni aperte

- Punteggio per la vittoria: le regole non lo fissano; ora è 8 di default, configurabile.
- Timeout e scelta casuale: implementati come `autoPlay` e `autoPick`; i tempi li decide la stanza.
- Correzione di articoli e genere: non ancora implementata.
- Bot: al momento giocano a caso; una strategia migliore si può aggiungere senza cambiare il motore.

## Licenza

Il materiale delle carte è CC BY-NC-SA 2.0 IT: uso non commerciale, con attribuzione e stessa licenza.
