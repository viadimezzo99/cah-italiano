"""Assembla la pagina: motore, accordi, audio, mazzo e interfaccia in un solo HTML."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
read = lambda p: (root / p).read_text(encoding="utf-8")
tpl = read("tools/web_template.html")
engine = read("src/game.js") + "\n" + read("src/agreement.js")
audio = read("tools/audio.js")
app = read("tools/app.js")
cards = json.loads(read("data/cards.json"))
# Evita che un testo contenga la sequenza di chiusura dello script.
payload = json.dumps({"white": cards["white"], "black": cards["black"]}, ensure_ascii=False).replace("</", "<\\/")

html = (tpl.replace("/*ENGINE*/", engine)
           .replace("/*AUDIO*/", audio)
           .replace("/*APP*/", f"const CARDS = {payload};\n\n{app}"))
out = root / "web" / "index.html"
out.write_text(html, encoding="utf-8")
print(out, f"{out.stat().st_size/1024:.0f} KB")
