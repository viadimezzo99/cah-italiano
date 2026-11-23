"""Assembla la pagina: motore, accordi, audio, mazzo e interfaccia in un solo HTML."""
import base64
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
read = lambda p: (root / p).read_text(encoding="utf-8")
tpl = read("tools/web_template.html")
# Lessico morfologico (Morph-it!, LGPL) e reggenze dei verbi: dati letti dal motore grammaticale.
# Integrazione a mano per i nomi che Morph-it non ha (genere e plurale curati in data/lexicon_it/gaps.json).
def merge_gaps(lex_d, infl_d):
    for sg, g, pl in json.loads(read("data/lexicon_it/gaps.json"))["nomi"]:
        if sg in lex_d:
            continue
        lex_d.setdefault(sg, []).append("N" + g + "s")
        lex_d.setdefault(pl, [])
        if "N" + g + "p" not in lex_d[pl]:
            lex_d[pl].append("N" + g + "p")
        infl_d[sg] = {"N": {g + "s": [sg], g + "p": [pl]}}
    return lex_d, infl_d
lex_d, infl_d = merge_gaps(json.loads(read("data/lexicon_it/lex.json")), json.loads(read("data/lexicon_it/inflect.json")))
lex = json.dumps(lex_d, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
reggenze = read("data/reggenze.json").replace("</", "<\\/")
inflect = json.dumps(infl_d, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
verbs3 = read("data/lexicon_it/verbs3.json").replace("</", "<\\/")
ud_nomi = read("data/lexicon_it/ud_nomi.json").replace("</", "<\\/")
engine = (f"const LEX = {lex};\nconst REGGENZE = {reggenze};\nconst INFLECT = {inflect};\nconst VERBS3 = {verbs3};\nconst UD_NOMI = {ud_nomi};\n"
          + re.sub(r"^import .*\n", "", read("src/game.js"), flags=re.M) + "\n" + read("src/agreement.js"))
import base64
# Brani, incorporati nella pagina: tools/music/tracks.json dice file e sonorità (LUFS) di ciascuno (vedi tools/music/prepare_tracks.py).
tracks_meta = json.loads(read("tools/music/tracks.json"))
tracks = {n: {"src": "data:audio/mpeg;base64," + base64.b64encode((root / "tools/music" / m["file"]).read_bytes()).decode(), "lufs": m["lufs"]}
          for n, m in tracks_meta.items()}
audio = read("tools/audio.js").replace("/*TRACKS*/{}", json.dumps(tracks))
spell = read("tools/spell.js")
app = spell + "\n" + read("tools/room.js") + "\n" + read("tools/app.js")
# Immagini del Memory, incorporate come data URI (nessun file esterno).
mem_names = ["gatto", "cactus", "patata", "pinguino", "fantasma", "frigorifero", "ombrello", "vasca"]
mem_uris = ["data:image/jpeg;base64," + base64.b64encode((root / f"tools/memory/{n}.jpg").read_bytes()).decode() for n in mem_names]
app = app.replace("/*MEMORY_IMGS*/[]", json.dumps(mem_uris))
# Avatar del profilo: i personaggi del Memory. Il ritaglio senza sfondo (PNG trasparente) e l'illustrazione intera (da cui viene il colore della carta).
avatar_names = ["gatto", "cactus", "patata", "pinguino"]
avatars = [{"cut": "data:image/png;base64," + base64.b64encode((root / f"tools/memory/cut/{n}.png").read_bytes()).decode(),
            "bg": "data:image/jpeg;base64," + base64.b64encode((root / f"tools/memory/{n}.jpg").read_bytes()).decode()} for n in avatar_names]
app = app.replace("/*AVATARS*/[]", json.dumps(avatars))
jolly_uri = "data:image/jpeg;base64," + base64.b64encode((root / "tools/memory/jolly.jpg").read_bytes()).decode()
app = app.replace('"/*JOLLY_IMG*/"', json.dumps(jolly_uri))
# Strato di design: un foglio di stile a parte, messo in app.js come ultimo <style> (il file non deve contenere apici inversi né "${").
design = read("tools/design-v2.css")
assert "`" not in design and "${" not in design, "design-v2.css non può contenere apici inversi né dollaro-graffa"
app = app.replace("/*DESIGN_V2*/", design)
cards = json.loads(read("data/cards.json"))
# Evita che un testo contenga la sequenza di chiusura dello script.
payload = json.dumps({"white": cards["white"], "black": cards["black"]}, ensure_ascii=False).replace("</", "<\\/")

html = (tpl.replace("/*ENGINE*/", engine)
           .replace("/*AUDIO*/", audio)
           .replace("/*APP*/", f"const CARDS = {payload};\n\n{app}"))
out = root / "web" / "index.html"
# Fine riga LF anche su Windows: il file committato è LF e il confronto con git resta pulito.
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print(out, f"{out.stat().st_size/1024:.0f} KB")
