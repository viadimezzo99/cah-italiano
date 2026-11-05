"""Assembla la pagina: motore, accordi, audio, mazzo e interfaccia in un solo HTML."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
read = lambda p: (root / p).read_text(encoding="utf-8")
tpl = read("tools/web_template.html")
# Lessico morfologico (Morph-it!, LGPL) e reggenze dei verbi: dati letti dal motore grammaticale.
lex = read("data/lexicon_it/lex.json").replace("</", "<\\/")
reggenze = read("data/reggenze.json").replace("</", "<\\/")
inflect = read("data/lexicon_it/inflect.json").replace("</", "<\\/")
verbs3 = read("data/lexicon_it/verbs3.json").replace("</", "<\\/")
engine = (f"const LEX = {lex};\nconst REGGENZE = {reggenze};\nconst INFLECT = {inflect};\nconst VERBS3 = {verbs3};\n"
          + read("src/game.js") + "\n" + read("src/agreement.js"))
audio = read("tools/audio.js")
spell = read("tools/spell.js")
app = spell + "\n" + read("tools/app.js")
cards = json.loads(read("data/cards.json"))
# Evita che un testo contenga la sequenza di chiusura dello script.
payload = json.dumps({"white": cards["white"], "black": cards["black"]}, ensure_ascii=False).replace("</", "<\\/")

html = (tpl.replace("/*ENGINE*/", engine)
           .replace("/*AUDIO*/", audio)
           .replace("/*APP*/", f"const CARDS = {payload};\n\n{app}"))
out = root / "web" / "index.html"
out.write_text(html, encoding="utf-8")
print(out, f"{out.stat().st_size/1024:.0f} KB")
