#!/usr/bin/env python3
"""Prepara gli avatar del profilo che non vengono dal Memory: ritaglia il personaggio dall'illustrazione e lo porta
nel formato degli altri (280x400, ritaglio trasparente + carta intera con cornice).

Uso:  python3 tools/avatars/make_avatars.py [nome ...]
Legge   tools/avatars/src/<nome>.webp   (l'illustrazione originale, con la sua cornice)
Scrive  tools/avatars/cut/<nome>.png    (il personaggio senza sfondo, 280x400)
        tools/avatars/<nome>.jpg        (la carta intera: bordo crema, fondo scuro; ne viene il colore della carta profilo)
Serve:  pip install rembg onnxruntime opencv-python-headless pillow numpy   (il modello si scarica la prima volta)
Per aggiungere un avatar: mettere l'illustrazione in src/, aggiungere una riga in AVATARS (nome e riquadro da ritagliare
dentro la cornice) e il nome in tools/avatars/order.json.
"""
import json, pathlib, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
W, H = 280, 400
# nome -> riquadro (sinistra, alto, destra, basso) dentro la cornice dell'illustrazione originale
AVATARS = {
    "sigaretta": (30, 30, 657, 994),
    "burro": (326, 32, 700, 524),
    "formaggio": (30, 30, 658, 994),
    "anguria": (30, 30, 658, 994),
}


def cut_out(img):
    """Il personaggio senza sfondo: modello di ritaglio, poi si tiene solo il pezzo grande (via frammenti di sfondo)."""
    from rembg import new_session, remove
    out = remove(img, session=new_session("isnet-general-use"))
    a = np.asarray(out)[..., 3]
    solid = (a > 128).astype(np.uint8)
    # un'apertura spezza i fili sottili che attaccano frammenti di sfondo (mattoni, ombre) al personaggio
    opened = cv2.morphologyEx(solid, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = np.zeros_like(solid)
    for k, area in enumerate(areas, start=1):
        if area >= 0.03 * areas.max():      # il corpo e i pezzi grandi (una mano staccata); non i frammenti
            keep[lab == k] = 1
    keep = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))   # recupera il bordo
    rgba = np.asarray(out).copy()
    rgba[..., 3] = np.where(keep > 0, rgba[..., 3], 0)
    return Image.fromarray(rgba, "RGBA")


def fit(img, margin_x=14, top=16, bottom=22, scale=2):
    """Ritaglia il vuoto e adatta il personaggio alla carta, appoggiato in basso. Si lavora al doppio e poi si riduce."""
    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    c = img.crop(bbox)
    k = min((W - 2 * margin_x) * scale / c.width, (H - top - bottom) * scale / c.height)
    c = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
    out = Image.new("RGBA", (W * scale, H * scale), (0, 0, 0, 0))
    out.paste(c, ((W * scale - c.width) // 2, H * scale - bottom * scale - c.height), c)
    return out.resize((W, H), Image.LANCZOS)


def card_bg(cut):
    """La carta intera: bordo crema, fondo scuro, filo interno, il personaggio al centro (come le carte del Memory)."""
    card = Image.new("RGB", (W, H), (236, 224, 192))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((7, 7, W - 8, H - 8), radius=20, fill=(29, 23, 19))
    d.rounded_rectangle((14, 14, W - 15, H - 15), radius=14, outline=(190, 170, 128), width=2)
    card.paste(cut, (0, 0), cut)
    return card


def main(names):
    (ROOT / "cut").mkdir(exist_ok=True)
    for n in names:
        src = Image.open(ROOT / "src" / f"{n}.webp").convert("RGB").crop(AVATARS[n])
        cut = fit(cut_out(src))
        cut.save(ROOT / "cut" / f"{n}.png", optimize=True)
        card_bg(cut).save(ROOT / f"{n}.jpg", quality=88, optimize=True)
        print("ok", n)
    (ROOT / "order.json").write_text(json.dumps(list(AVATARS), ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:] or list(AVATARS))
