"""Crea data/cards.json da un unico file di testo: una carta per riga.

  data/carte.txt
    - riga con ____  -> carta nera (il ____ è lo spazio vuoto)
    - riga senza     -> carta bianca

Righe vuote e righe che iniziano con # vengono ignorate.
Le carte già presenti mantengono id e categoria; quelle nuove prendono
la categoria "Situazioni" (bianche) o "1 risposta" (nere).

Uso: python3 tools/import_cards.py [carte.txt] [cards.json]
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
BLANK = "____"


def read_lines(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = re.sub(r"\s+", " ", raw).strip()
            if line and not line.startswith("#"):
                out.append(line)
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(DATA, "carte.txt")
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(DATA, "cards.json")

    old = {}
    if os.path.exists(dst):
        with open(dst, encoding="utf-8") as f:
            old = json.load(f)
    old_white = {c["text"].lower(): c for c in old.get("white", [])}
    old_black = {c["text"].lower(): c for c in old.get("black", [])}
    next_w = max([int(c["id"][1:]) for c in old.get("white", [])] or [0]) + 1
    next_b = max([int(c["id"][1:]) for c in old.get("black", [])] or [0]) + 1

    whites, blacks, seen = [], [], set()
    for text in read_lines(src):
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        if BLANK in text:
            if key in old_black:
                card = dict(old_black[key])
            else:
                card = {"id": f"b{next_b:03d}", "text": text, "cat": "1 risposta"}
                next_b += 1
            card["text"] = text
            card["blanks"] = max(1, text.count(BLANK))
            blacks.append(card)
        else:
            if key in old_white:
                card = dict(old_white[key])
            else:
                card = {"id": f"w{next_w:03d}", "text": text, "cat": "Situazioni"}
                next_w += 1
            card["text"] = text
            whites.append(card)

    out = {"source": old.get("source", "carte.txt"), "white": whites, "black": blacks}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"bianche: {len(whites)}  nere: {len(blacks)}  -> {dst}")


if __name__ == "__main__":
    main()
