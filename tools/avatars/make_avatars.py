#!/usr/bin/env python3
"""Genera gli avatar del profilo: personaggi ispirati alle carte, nello stile dei quattro del Memory
(maglietta crema, contorno scuro, arancione e crema su fondo scuro).

Uso:  python3 tools/avatars/make_avatars.py [nome ...]      (senza nomi: tutti)
Scrive in tools/avatars:  cut/<nome>.png (ritaglio trasparente 280x400),  <nome>.jpg (con fondo e cornice),  order.json.
Serve Playwright per Node (disegna gli SVG) e numpy + Pillow (retino e grana di stampa).
"""
import json, subprocess, sys, pathlib, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent
INK = "#1b120c"
CREAM = "#efe2c1"
CREAM_D = "#d8c79f"
ORANGE = "#d4682c"
ORANGE_D = "#a94a1e"
BROWN = "#4a3224"
SW = 7  # spessore del contorno

# ---------------------------------------------------------------------------------------------- pezzi comuni
def tube(pts, color, w, ink=INK):
    """Un braccio: tratto scuro largo e, sopra, quello colorato più stretto."""
    d = "M " + " L ".join(f"{x} {y}" for x, y in pts)
    return (f'<path d="{d}" fill="none" stroke="{ink}" stroke-width="{w + 2 * SW}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')

def shape(d, fill, extra=""):
    return f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round" {extra}/>'

def line(d, w=4, op=1.0, color=INK):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" opacity="{op}"/>'

def circ(cx, cy, r, fill, sw=SW):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{INK}" stroke-width="{sw}"/>'

def ell(cx, cy, rx, ry, fill, sw=SW, rot=0):
    t = f' transform="rotate({rot} {cx} {cy})"' if rot else ""
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{INK}" stroke-width="{sw}"{t}/>'

def mirror(svg):
    return f'<g transform="translate(560 0) scale(-1 1)">{svg}</g>'

def body(pants, shoes, arm, hand, sole=CREAM_D, left_arm=None, right_arm=None, tee=CREAM):
    """Il corpo comune: gambe, scarpe, maglietta e due braccia. Il braccio sinistro (di chi guarda) regge l'oggetto."""
    p = []
    # gambe
    p.append(shape("M 208 520 L 278 520 L 272 698 L 204 698 Z", pants))
    p.append(shape("M 282 520 L 352 520 L 358 698 L 290 698 Z", pants))
    p.append(line("M 206 684 L 274 684", 4, .45)); p.append(line("M 288 684 L 356 684", 4, .45))
    p.append(line("M 276 530 L 280 690", 4, .5))
    # scarpe
    p.append(shape("M 192 704 C 190 686 262 684 282 702 C 296 716 292 742 262 744 L 204 744 C 186 744 186 718 192 704 Z", shoes))
    p.append(shape("M 368 704 C 370 686 298 684 278 702 C 264 716 268 742 298 744 L 356 744 C 374 744 374 718 368 704 Z", shoes))
    p.append(f'<path d="M 190 730 L 290 730" stroke="{INK}" stroke-width="4" opacity=".6"/>')
    p.append(f'<path d="M 270 730 L 370 730" stroke="{INK}" stroke-width="4" opacity=".6"/>')
    # braccia (dietro la maglietta le spalle)
    la = left_arm or [(170, 366), (120, 432), (134, 484)]
    ra = right_arm or [(390, 366), (438, 432), (398, 492)]
    p.append(tube(la, arm, 34)); p.append(tube(ra, arm, 34))
    # maglietta
    p.append(shape("M 196 308 C 228 296 332 296 364 308 L 410 340 L 392 400 L 364 382 L 368 540 C 324 556 236 556 192 540 L 196 382 L 168 400 L 150 340 Z", tee))
    p.append(line("M 240 306 Q 280 334 320 306", 5))
    p.append(line("M 222 420 Q 240 440 226 470", 3.5, .45)); p.append(line("M 330 430 Q 316 456 334 486", 3.5, .45))
    p.append(line("M 204 530 Q 280 552 356 530", 3.5, .4))
    # mani
    p.append(circ(la[-1][0], la[-1][1], 24, hand)); p.append(circ(ra[-1][0], ra[-1][1], 24, hand))
    return "".join(p)

def coin(cx, cy, r=34):
    return (circ(cx, cy, r, "#e1a33a") + circ(cx, cy, r - 10, "#efc460", 4) +
            line(f"M {cx} {cy - 12} L {cx + 4} {cy - 3} L {cx + 13} {cy - 3} L {cx + 6} {cy + 3} L {cx + 9} {cy + 12} L {cx} {cy + 6} L {cx - 9} {cy + 12} L {cx - 6} {cy + 3} L {cx - 13} {cy - 3} L {cx - 4} {cy - 3} Z", 3.5))

def can(cx, cy):
    return (shape(f"M {cx - 30} {cy - 36} L {cx - 30} {cy + 40} Q {cx} {cy + 54} {cx + 30} {cy + 40} L {cx + 30} {cy - 36} Z", "#bdb8ab") +
            shape(f"M {cx - 30} {cy - 6} L {cx - 30} {cy + 24} Q {cx} {cy + 38} {cx + 30} {cy + 24} L {cx + 30} {cy - 6} Q {cx} {cy + 8} {cx - 30} {cy - 6} Z", ORANGE) +
            ell(cx, cy - 36, 30, 10, "#d9d4c6", 5) + ell(cx, cy - 36, 18, 5, "#8d887c", 3))

def egg(cx, cy):
    spots = "".join(f'<circle cx="{cx + dx}" cy="{cy + dy}" r="{r}" fill="#7a5436"/>' for dx, dy, r in [(-12, -10, 5), (10, -22, 4), (14, 6, 6), (-6, 18, 5), (-16, 8, 3), (2, -2, 3)])
    return shape(f"M {cx} {cy - 52} C {cx + 40} {cy - 40} {cx + 44} {cy + 40} {cx} {cy + 48} C {cx - 44} {cy + 40} {cx - 40} {cy - 40} {cx} {cy - 52} Z", "#e4dcb8") + spots

def mug(cx, cy):
    return (shape(f"M {cx - 32} {cy - 30} L {cx - 28} {cy + 44} Q {cx} {cy + 54} {cx + 28} {cy + 44} L {cx + 32} {cy - 30} Z", "#9a6636") +
            f'<path d="M {cx + 31} {cy - 14} C {cx + 62} {cy - 14} {cx + 62} {cy + 28} {cx + 29} {cy + 28}" fill="none" stroke="{INK}" stroke-width="{SW + 10}" stroke-linecap="round"/>'
            f'<path d="M {cx + 31} {cy - 14} C {cx + 62} {cy - 14} {cx + 62} {cy + 28} {cx + 29} {cy + 28}" fill="none" stroke="#9a6636" stroke-width="9" stroke-linecap="round"/>' +
            line(f"M {cx - 30} {cy} L {cx + 30} {cy}", 4, .5) + line(f"M {cx - 29} {cy + 22} L {cx + 29} {cy + 22}", 4, .5) +
            shape(f"M {cx - 36} {cy - 28} C {cx - 40} {cy - 52} {cx - 18} {cy - 56} {cx - 12} {cy - 44} C {cx - 4} {cy - 62} {cx + 22} {cy - 58} {cx + 22} {cy - 42} C {cx + 42} {cy - 46} {cx + 44} {cy - 24} {cx + 34} {cy - 26} Z", "#f6efdc"))

def heart(cx, cy):
    return shape(f"M {cx} {cy + 40} C {cx - 70} {cy - 4} {cx - 34} {cy - 56} {cx} {cy - 22} C {cx + 34} {cy - 56} {cx + 70} {cy - 4} {cx} {cy + 40} Z", "#d9482a") + line(f"M {cx - 24} {cy - 14} Q {cx - 16} {cy - 26} {cx - 4} {cy - 22}", 4, .5, "#f4cdb8")

def loaf(cx, cy):
    return (shape(f"M {cx - 22} {cy - 66} L {cx + 22} {cy - 60} Q {cx + 34} {cy} {cx + 24} {cy + 62} L {cx - 20} {cy + 66} Q {cx - 34} {cy} {cx - 22} {cy - 66} Z", "#c98a43") +
            line(f"M {cx - 14} {cy - 36} L {cx + 12} {cy - 28}", 5, .6) + line(f"M {cx - 16} {cy - 4} L {cx + 14} {cy + 4}", 5, .6) + line(f"M {cx - 14} {cy + 30} L {cx + 14} {cy + 38}", 5, .6))

# ---------------------------------------------------------------------------------------------- personaggi
def goblin():
    G, GD = "#7d9a3c", "#5e7a2a"
    ear_l = shape("M 196 168 L 70 112 Q 84 196 204 232 Z", G) + shape("M 192 178 L 100 138 Q 110 192 198 218 Z", "#d98a5a", 'stroke-width="4"')
    head = shape("M 192 144 C 188 86 372 86 368 144 C 396 198 382 266 280 288 C 178 266 164 198 192 144 Z", G)
    face = (line("M 214 122 Q 240 108 262 120", 4, .55) + line("M 300 120 Q 322 108 348 122", 4, .55) + line("M 236 104 Q 280 96 326 104", 4, .45) +
            # sopracciglia
            f'<path d="M 206 160 Q 240 142 266 168" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
            f'<path d="M 354 160 Q 320 142 294 168" fill="none" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>' +
            # occhi
            ell(238, 184, 24, 17, "#ecd24e", 5) + ell(322, 184, 24, 17, "#ecd24e", 5) +
            f'<ellipse cx="240" cy="185" rx="6" ry="14" fill="{INK}"/><ellipse cx="320" cy="185" rx="6" ry="14" fill="{INK}"/>' +
            # naso
            shape("M 258 198 Q 280 184 302 198 Q 312 226 280 232 Q 248 226 258 198 Z", GD, 'stroke-width="5"') +
            f'<circle cx="270" cy="220" r="4" fill="{INK}"/><circle cx="290" cy="220" r="4" fill="{INK}"/>' +
            # bocca e zanne
            shape("M 208 244 Q 280 304 352 244 Q 280 262 208 244 Z", "#3a1c14", 'stroke-width="5"') +
            shape("M 226 252 L 236 232 L 246 256 Z", CREAM, 'stroke-width="4"') + shape("M 334 252 L 324 232 L 314 256 Z", CREAM, 'stroke-width="4"') +
            circ(344, 214, 6, GD, 3) + line("M 214 130 L 206 100", 4, .7) + line("M 280 98 L 284 70", 4, .7))
    return mirror(ear_l) + ear_l + head + face

def capra():
    FUR, FURD = "#e6dcc8", "#c8bba2"
    horn = shape("M 218 134 C 156 136 112 98 124 44 C 148 82 194 92 240 100 Z", "#c99a58") + line("M 196 122 Q 160 114 140 84", 4, .6) + line("M 214 114 Q 176 104 156 72", 4, .5)
    ear = shape("M 202 176 L 112 166 Q 124 206 208 212 Z", FUR) + shape("M 196 182 L 134 174 Q 144 200 200 204 Z", "#d99a86", 'stroke-width="3"')
    head = shape("M 214 126 C 244 104 316 104 346 126 C 364 168 352 214 338 254 C 322 294 238 294 222 254 C 208 214 196 168 214 126 Z", FUR)
    face = (shape("M 238 224 Q 280 206 322 224 C 330 262 312 286 280 288 C 248 286 230 262 238 224 Z", "#f2ead9", 'stroke-width="5"') +
            f'<ellipse cx="266" cy="246" rx="5" ry="8" fill="{INK}"/><ellipse cx="294" cy="246" rx="5" ry="8" fill="{INK}"/>' + line("M 262 268 Q 280 280 298 268", 4.5) +
            ell(244, 176, 22, 15, "#e6a537", 5) + ell(316, 176, 22, 15, "#e6a537", 5) +
            f'<rect x="230" y="172" width="28" height="9" rx="3" fill="{INK}"/><rect x="302" y="172" width="28" height="9" rx="3" fill="{INK}"/>' +
            f'<path d="M 220 158 Q 244 146 268 160" fill="none" stroke="{INK}" stroke-width="8" stroke-linecap="round"/><path d="M 340 158 Q 316 146 292 160" fill="none" stroke="{INK}" stroke-width="8" stroke-linecap="round"/>' +
            shape("M 258 290 Q 280 352 302 290 Q 280 304 258 290 Z", FUR, 'stroke-width="5"') + line("M 268 304 L 266 326", 3.5, .5) + line("M 292 304 L 294 326", 3.5, .5) +
            line("M 236 130 Q 250 150 242 170", 3.5, .4) + line("M 322 130 Q 310 150 318 170", 3.5, .4))
    return mirror(horn) + horn + mirror(ear) + ear + head + face

def pterodattilo():
    R, RD = "#d58a4a", "#b66a30"
    neck = shape("M 258 252 L 252 316 L 330 316 L 336 252 Z", R)
    crest = shape("M 300 116 C 360 84 440 96 476 150 C 420 134 366 142 330 170 Z", "#8f3f22")
    skull = shape("M 232 176 C 232 118 340 104 356 168 C 366 214 330 262 286 262 C 250 262 232 222 232 176 Z", R)
    upper = shape("M 246 168 L 56 190 Q 52 198 58 204 L 250 214 Z", "#e2a05c")
    lower = shape("M 248 214 L 86 214 Q 82 222 90 226 L 250 236 Z", "#c9803f")
    face = (ell(284, 170, 20, 20, "#f4ecd6", 5) + f'<circle cx="288" cy="172" r="8" fill="{INK}"/>' +
            f'<circle cx="176" cy="186" r="4" fill="{INK}"/>' + line("M 252 150 Q 280 134 304 148", 7) + line("M 326 186 Q 334 214 318 240", 4, .45) + line("M 300 210 Q 316 226 312 246", 4, .4))
    return neck + crest + skull + upper + lower + face

def vichingo():
    SK = "#e2b48a"
    horn = shape("M 200 132 C 124 134 92 80 118 30 C 134 74 178 96 216 102 Z", "#f0e2c2") + line("M 184 118 Q 150 110 128 74", 4, .5)
    face = shape("M 200 150 C 196 220 230 262 280 262 C 330 262 364 220 360 150 Z", SK)
    helmet = (shape("M 190 170 C 186 78 374 78 370 170 L 370 188 L 190 188 Z", "#a6a49c") +
              shape("M 190 158 L 370 158 L 370 190 L 190 190 Z", "#6e6c66", 'stroke-width="5"') +
              "".join(f'<circle cx="{x}" cy="174" r="4.5" fill="#cfcabd" stroke="{INK}" stroke-width="2"/>' for x in (214, 246, 314, 346)) +
              shape("M 268 158 L 292 158 L 290 236 Q 280 246 270 236 Z", "#8c8a83", 'stroke-width="5"') + line("M 214 110 Q 240 90 270 94", 4, .35, "#ffffff"))
    eyes = (ell(240, 212, 11, 8, "#f6efdc", 4) + ell(320, 212, 11, 8, "#f6efdc", 4) + f'<circle cx="242" cy="213" r="4.5" fill="{INK}"/><circle cx="318" cy="213" r="4.5" fill="{INK}"/>' +
            f'<path d="M 222 198 L 258 206" stroke="#a9451c" stroke-width="9" stroke-linecap="round"/><path d="M 338 198 L 302 206" stroke="#a9451c" stroke-width="9" stroke-linecap="round"/>' +
            shape("M 266 214 Q 280 236 294 214 Q 296 244 280 248 Q 264 244 266 214 Z", "#cd9770", 'stroke-width="4"'))
    beard = shape("M 196 226 C 186 304 236 334 280 356 C 324 334 374 304 364 226 C 340 262 318 252 280 262 C 242 252 220 262 196 226 Z", ORANGE)
    stache = shape("M 280 252 C 258 240 228 244 214 262 C 238 272 262 270 280 262 C 298 270 322 272 346 262 C 332 244 302 240 280 252 Z", "#e27a38", 'stroke-width="5"')
    beard_lines = line("M 250 290 Q 256 316 262 334", 4, .45) + line("M 280 280 L 280 340", 4, .45) + line("M 310 290 Q 304 316 298 334", 4, .45)
    braid = "".join(shape(f"M {x - 11} {y} Q {x - 15} {y + 14} {x - 9} {y + 26} Q {x} {y + 32} {x + 9} {y + 26} Q {x + 15} {y + 14} {x + 11} {y} Z", ORANGE, 'stroke-width="4"') for x, y in [(206, 296), (210, 318), (206, 340)])
    braid += shape("M 198 364 L 214 364 L 212 380 L 200 380 Z", "#e8d9b0", 'stroke-width="4"')
    return mirror(horn) + horn + face + braid + mirror(braid) + beard + stache + beard_lines + eyes + helmet

def panettone():
    top = "#c98a3e"
    cake = shape("M 198 268 L 198 154 C 198 66 362 66 362 154 L 362 268 Z", top)
    glaze = shape("M 204 140 C 208 74 352 74 356 140 C 340 118 322 132 304 112 C 290 130 268 108 250 126 C 232 112 218 134 204 140 Z", "#f0dfb6", 'stroke-width="5"')
    fruit = "".join(circ(x, y, r, c, 3) for x, y, r, c in [(236, 100, 7, "#d4682c"), (284, 92, 6, "#6f8a3a"), (326, 108, 7, "#d4682c"), (260, 126, 5, "#6f8a3a"), (308, 130, 5, "#d4682c")])
    sugar = "".join(f'<circle cx="{x}" cy="{y}" r="2.6" fill="#fffaf0"/>' for x, y in [(228, 118), (270, 108), (296, 104), (338, 128), (252, 98), (318, 94)])
    wrapper = shape("M 186 238 L 374 238 L 362 304 L 198 304 Z", ORANGE)
    flutes = "".join(line(f"M {x} 240 L {x + (x - 280) * .06} 302", 4, .45) for x in range(204, 360, 22))
    face = (f'<path d="M 226 188 Q 244 174 262 188" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/><path d="M 298 188 Q 316 174 334 188" fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round"/>' +
            f'<path d="M 232 192 Q 244 206 258 192 Z" fill="{INK}" opacity=".0"/>' + line("M 250 224 Q 280 246 310 224", 6) + circ(214, 214, 9, "#e0884a", 2) + circ(346, 214, 9, "#e0884a", 2))
    return cake + glaze + fruit + sugar + wrapper + flutes + face

def capodoglio():
    W, WD = "#919489", "#74786d"
    neck = shape("M 238 280 L 232 318 L 330 318 L 324 280 Z", W)
    spout = (line("M 300 96 C 292 52 262 34 244 44", 8, 1, "#efe6cb") + line("M 306 96 C 316 52 346 34 366 46", 8, 1, "#efe6cb") + line("M 303 94 L 303 40", 7, 1, "#efe6cb"))
    spout = spout.replace(f'stroke="{INK}"', f'stroke="{INK}"')
    head = shape("M 148 196 C 146 112 252 92 326 112 C 410 134 424 206 402 252 C 380 292 250 302 178 272 C 150 254 148 224 148 196 Z", W)
    belly = shape("M 170 250 C 230 290 346 292 396 252 C 392 276 330 306 250 300 C 200 296 176 276 170 250 Z", "#cfc9b8", 'stroke-width="5"')
    mouth = line("M 164 236 C 240 272 340 274 396 238", 6)
    teeth = "".join(f'<path d="M {x} {y} l 7 12 l 7 -12 Z" fill="{CREAM}" stroke="{INK}" stroke-width="2.5"/>' for x, y in [(206, 252), (230, 260), (256, 264), (282, 266), (308, 264), (334, 258), (358, 250)])
    face = (ell(212, 188, 17, 14, "#f4ecd6", 5) + f'<circle cx="214" cy="190" r="7" fill="{INK}"/>' + line("M 190 168 Q 212 152 238 164", 7) +
            line("M 300 132 Q 330 150 322 184", 4, .4) + line("M 330 150 Q 360 168 352 200", 4, .35) + circ(303, 106, 6, WD, 3))
    return neck + spout + head + belly + mouth + teeth + face

def oca():
    neck_pts = "M 282 312 C 232 262 350 232 308 166"
    neck = (f'<path d="{neck_pts}" fill="none" stroke="{INK}" stroke-width="58" stroke-linecap="round"/>'
            f'<path d="{neck_pts}" fill="none" stroke="#f4ebd5" stroke-width="44" stroke-linecap="round"/>')
    neck_lines = line("M 270 292 C 252 268 300 252 290 220", 4, .35) + line("M 296 276 C 290 248 326 232 312 196", 4, .3)
    head = shape("M 276 130 C 276 92 346 90 354 124 C 358 150 332 168 310 168 C 288 168 276 154 276 130 Z", "#f4ebd5")
    beak = shape("M 346 118 L 416 134 Q 424 148 410 150 L 346 148 Z", "#e2802e") + line("M 350 132 L 410 140", 4, .5) + f'<circle cx="372" cy="124" r="3.5" fill="{INK}"/>'
    eye = f'<circle cx="320" cy="124" r="7" fill="{INK}"/><circle cx="322" cy="122" r="2" fill="#fff"/>' + line("M 304 108 Q 320 100 336 108", 5)
    tuft = shape("M 296 100 Q 290 76 304 66 Q 304 86 316 96 Z", "#f4ebd5", 'stroke-width="4"')
    return neck + neck_lines + head + beak + eye + tuft

def robot():
    S, SD = "#b3b5ad", "#8c8f86"
    spring = "".join(shape(f"M 248 {y} L 312 {y} L 312 {y + 8} L 248 {y + 8} Z", SD, 'stroke-width="4"') for y in (282, 292, 302))
    ant = f'<path d="M 280 112 L 280 62" stroke="{INK}" stroke-width="{SW + 6}" stroke-linecap="round"/><path d="M 280 112 L 280 62" stroke="{SD}" stroke-width="7" stroke-linecap="round"/>' + circ(280, 52, 15, ORANGE, 6)
    ears = shape("M 168 168 L 186 168 L 186 220 L 168 220 Z", SD, 'stroke-width="5"') + shape("M 394 168 L 376 168 L 376 220 L 394 220 Z", SD, 'stroke-width="5"')
    head = shape("M 196 112 H 364 Q 378 112 378 128 V 252 Q 378 270 362 270 H 198 Q 182 270 182 252 V 128 Q 182 112 196 112 Z", S)
    screen = shape("M 208 138 H 352 Q 362 138 362 148 V 232 Q 362 244 350 244 H 210 Q 198 244 198 232 V 148 Q 198 138 208 138 Z", "#2c211a", 'stroke-width="5"')
    eyes = "".join(f'<rect x="{x}" y="164" width="34" height="34" rx="9" fill="#f3a93c"/><rect x="{x + 6}" y="170" width="10" height="10" rx="3" fill="#fff3cf"/>' for x in (222, 304))
    mouth = "".join(f'<rect x="{x}" y="{y}" width="12" height="9" rx="2" fill="#f3a93c"/>' for x, y in [(236, 216), (254, 224), (272, 226), (290, 224), (308, 216)])
    rivets = "".join(f'<circle cx="{x}" cy="{y}" r="4.5" fill="{SD}" stroke="{INK}" stroke-width="2.5"/>' for x, y in [(198, 128), (362, 128), (198, 256), (362, 256)])
    return spring + ant + ears + head + screen + eyes + mouth + rivets + line("M 204 120 Q 280 112 356 120", 4, .35, "#ffffff")

HEAD_SCALE = 1.2   # le teste dei personaggi del Memory sono grandi rispetto al corpo

def big_head(svg, neck=None):
    """La testa ingrandita attorno al colletto; con 'neck' un collo di quel colore tra testa e maglietta."""
    n = shape("M 246 262 L 240 322 L 320 322 L 314 262 Z", neck) if neck else ""
    return n + f'<g transform="translate(280 300) scale({HEAD_SCALE}) translate(-280 -300)">{svg}</g>'

def build(name):
    if name == "goblin":
        return body("#5b4630", CREAM, "#7d9a3c", "#7d9a3c") + coin(112, 452) + big_head(goblin(), "#6a8734")
    if name == "capra":
        return body("#3a2c24", CREAM, "#e6dcc8", "#e6dcc8") + can(116, 456) + big_head(capra(), "#d9ceb6")
    if name == "pterodattilo":
        return body(ORANGE_D, CREAM, "#d58a4a", "#d58a4a") + egg(120, 454) + big_head(pterodattilo())
    if name == "vichingo":
        return body("#4a3a2a", "#8f6a42", "#e2b48a", "#e2b48a") + mug(114, 450) + big_head(vichingo(), "#d4a47a")
    if name == "panettone":
        return body("#6a3f22", CREAM, "#c98a3e", "#c98a3e") + big_head(panettone())
    if name == "capodoglio":
        return body("#33423f", CREAM, "#919489", "#919489") + big_head(capodoglio())
    if name == "oca":
        return body("#c8622b", CREAM, "#f4ebd5", "#e2802e") + loaf(118, 440) + big_head(oca())
    if name == "robot":
        return body("#2f2a26", ORANGE, "#b3b5ad", "#8c8f86") + heart(112, 448) + big_head(robot())
    raise KeyError(name)

NAMES = ["goblin", "capra", "pterodattilo", "vichingo", "panettone", "capodoglio", "oca", "robot"]

# ---------------------------------------------------------------------------------------------- resa
def svg_doc(inner):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-80 -180 720 1040" width="720" height="1040">{inner}</svg>')

def render(names, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    for n in names:
        (out_dir / f"{n}.svg").write_text(svg_doc(build(n)), encoding="utf-8")
    js = ("const {chromium}=require('playwright');const fs=require('fs');(async()=>{const b=await chromium.launch();"
          "const p=await b.newPage({viewport:{width:720,height:1040}});for(const n of process.argv.slice(3)){"
          "await p.setContent('<html><body style=\"margin:0;background:transparent\">'+fs.readFileSync(process.argv[2]+'/'+n+'.svg','utf8')+'</body></html>');"
          "await p.screenshot({path:process.argv[2]+'/'+n+'.png',omitBackground:true});}await b.close();})();")
    jsf = out_dir / "render.js"
    jsf.write_text(js)
    subprocess.run(["node", str(jsf), str(out_dir), *names], check=True)

def fit(img, W=560, H=800):
    """Ritaglia lo spazio vuoto e adatta la figura alla carta (stesso margine per tutti), appoggiata in basso."""
    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    c = img.crop(bbox)
    k = min((W - 36) / c.width, (H - 24 - 40) / c.height)
    c = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(c, ((W - c.width) // 2, H - 40 - c.height), c)
    return out

def print_look(img):
    """Retino (punti più fitti verso il basso e a destra, la luce viene da in alto a sinistra) e grana di carta, solo dove c'è colore."""
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # griglia di punti ruotata di 45 gradi
    u = (xx + yy) / 1.4142; v = (xx - yy) / 1.4142
    cell = 7.0
    fu = (u % cell) - cell / 2; fv = (v % cell) - cell / 2
    dist = np.sqrt(fu * fu + fv * fv)
    light = np.clip((xx / w * 0.45 + yy / h * 0.75 - 0.18) / 0.8, 0, 1)   # 0 = chiaro, 1 = in ombra
    radius = light * 3.1
    dots = (dist < radius).astype(np.float32)
    shade = 1 - dots * 0.30 * (a[..., 3:4] > 0)[..., 0]
    # le linee scure del contorno restano com'erano (il retino è invisibile sopra)
    a[..., :3] *= shade[..., None]
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 7, (h, w)).astype(np.float32)
    grain = np.asarray(Image.fromarray(np.clip(grain + 128, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) - 128
    a[..., :3] = np.clip(a[..., :3] + grain[..., None] * 1.0, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")

def card_bg(cut):
    """La carta intera: bordo crema, fondo scuro, filo interno, il personaggio al centro (come le carte del Memory)."""
    W, H = cut.size
    card = Image.new("RGB", (W, H), (236, 224, 192))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((7, 7, W - 8, H - 8), radius=20, fill=(29, 23, 19))
    d.rounded_rectangle((14, 14, W - 15, H - 15), radius=14, outline=(190, 170, 128), width=2)
    ground = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(ground)
    gd.ellipse((W * .16, H * .90, W * .84, H * .97), fill=(70, 56, 44, 150))
    card.paste(ground, (0, 0), ground)
    card.paste(cut, (0, 0), cut)
    return card

def main():
    names = sys.argv[1:] or NAMES
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="avatars-"))
    render(names, tmp)
    (ROOT / "cut").mkdir(exist_ok=True)
    for n in names:
        big = fit(Image.open(tmp / f"{n}.png").convert("RGBA"))
        big = print_look(big)
        cut = big.resize((280, 400), Image.LANCZOS)
        q = cut.quantize(colors=160, method=Image.FASTOCTREE, dither=Image.NONE)
        q.save(ROOT / "cut" / f"{n}.png", optimize=True)
        card_bg(cut).save(ROOT / f"{n}.jpg", quality=86, optimize=True)
        print("ok", n)
    (ROOT / "order.json").write_text(json.dumps(NAMES, ensure_ascii=False) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
