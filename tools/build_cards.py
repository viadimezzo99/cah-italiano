"""Estrae le carte nere e bianche dal sorgente LaTeX del mazzo italiano.

Uso: python3 tools/build_cards.py <sorgente.tex> <output.json>
"""
import json
import re
import sys

BLANK = r"\puntini"
CARD_RE = re.compile(r"\\carta\{(.*?)\}\s*(?:&|\\\\|\\hline)", re.S)


def clean(raw: str, black: bool = False) -> str:
    text = raw.replace(BLANK, "____")
    text = text.replace("\\-", "")                  # sillabazione LaTeX
    text = text.replace("``", "\u201c").replace("''", "\u201d")
    text = re.sub(r"\\[a-zA-Z]+\s*", "", text)     # comandi LaTeX residui
    text = re.sub(r"[{}]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    # Carta nera senza spazi: la risposta va in fondo alla domanda.
    if black and "____" not in text:
        text = f"{text} ____"
    return text


def extract(tex: str):
    # Le bianche stanno prima della sezione mdframed, le nere dopo.
    split = tex.index(r"\begin{mdframed}")
    white_part, black_part = tex[:split], tex[split:]
    whites = [clean(m.group(1)) for m in CARD_RE.finditer(white_part)]
    blacks = [clean(m.group(1), black=True) for m in CARD_RE.finditer(black_part)]
    whites = [w for w in whites if w]
    blacks = [b for b in blacks if b]
    return whites, blacks


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        tex = f.read()
    whites, blacks = extract(tex)
    white_cards = [{"id": f"w{i:03d}", "text": t} for i, t in enumerate(whites, 1)]
    black_cards = []
    for i, t in enumerate(blacks, 1):
        blanks = t.count("____")
        black_cards.append({"id": f"b{i:03d}", "text": t, "blanks": max(1, blanks)})
    out = {
        "source": src.split("/")[-1],
        "white": white_cards,
        "black": black_cards,
    }
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"bianche: {len(white_cards)}  nere: {len(black_cards)}  "
          f"nere con 2 spazi: {sum(1 for b in black_cards if b['blanks'] == 2)}")


if __name__ == "__main__":
    main()
