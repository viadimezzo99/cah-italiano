"""Assembla la pagina: motore, accordi, audio, mazzo e interfaccia in un solo HTML."""
import base64
import json
import re
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
          + re.sub(r"^import .*\n", "", read("src/game.js"), flags=re.M) + "\n" + read("src/agreement.js"))
import base64
# Brano del menu, incorporato nella pagina (nessun file esterno).
menu_mp3 = "data:audio/mpeg;base64," + base64.b64encode((root / "tools/menu.mp3").read_bytes()).decode()
game_mp3 = "data:audio/mpeg;base64," + base64.b64encode((root / "tools/game.mp3").read_bytes()).decode()
audio = read("tools/audio.js").replace("/*MENU_MP3*/", menu_mp3).replace("/*GAME_MP3*/", game_mp3)
spell = read("tools/spell.js")
app = spell + "\n" + read("tools/room.js") + "\n" + read("tools/app.js")
# Immagini del Memory, incorporate come data URI (nessun file esterno).
mem_names = ["gatto", "cactus", "patata", "pinguino", "fantasma", "frigorifero", "ombrello", "vasca"]
mem_uris = ["data:image/jpeg;base64," + base64.b64encode((root / f"tools/memory/{n}.jpg").read_bytes()).decode() for n in mem_names]
app = app.replace("/*MEMORY_IMGS*/[]", json.dumps(mem_uris))
jolly_uri = "data:image/jpeg;base64," + base64.b64encode((root / "tools/memory/jolly.jpg").read_bytes()).decode()
app = app.replace('"/*JOLLY_IMG*/"', json.dumps(jolly_uri))
cards = json.loads(read("data/cards.json"))
# Evita che un testo contenga la sequenza di chiusura dello script.
payload = json.dumps({"white": cards["white"], "black": cards["black"]}, ensure_ascii=False).replace("</", "<\\/")

html = (tpl.replace("/*ENGINE*/", engine)
           .replace("/*AUDIO*/", audio)
           .replace("/*APP*/", f"const CARDS = {payload};\n\n{app}"))
out = root / "web" / "index.html"
out.write_text(html, encoding="utf-8")
print(out, f"{out.stat().st_size/1024:.0f} KB")
