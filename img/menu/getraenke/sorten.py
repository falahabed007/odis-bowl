# Faerbt die Flaschenbilder je Sorte um, damit jede Sorte ihre Farbe hat und
# alle Flaschen einer Marke trotzdem gleich aussehen (Abed, 22.10.2026).
#
#   python3 -I img/menu/getraenke/sorten.py
#
# Danach in index.html BILD_STAND hochzaehlen, sonst zeigen Browser bis zu
# 10 Minuten die alten Flaschen.
#
# Vorlagen sind die freigestellten Flaschen aus Odi's Getraenkekarte
# (cola.png, limonade.png, schorle.png, ice-tea.png, gesaris.png, potts.png).
# Geaendert werden nur Farbton, Saettigung und Helligkeit ausgewaehlter
# Farbbereiche - Form, Glanzlichter und Schrift bleiben die der Vorlage.
import colorsys, os
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(HIER, 'sorten')


def laden(name):
    return Image.open(os.path.join(HIER, name + '.png')).convert('RGBA')


def band_leeren(im, von, bis):
    """Macht die Schrift auf einem hellen Etikettband unsichtbar ("LEMON" auf
    Peach waere falsch): dunkle Pixel zwischen dem ersten und letzten hellen
    Pixel einer Zeile bekommen die mittlere Bandfarbe."""
    w, h = im.size
    px = im.load()
    for y in range(int(von * h), int(bis * h) + 1):
        hell = []
        for x in range(w):
            r, g, b, a = px[x, y]
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if a > 200 and s < 0.3 and v > 0.62:
                hell.append(x)
        if len(hell) < 5:
            continue
        farben = [px[x, y] for x in hell]
        mittel = tuple(round(sum(c[i] for c in farben) / len(farben)) for i in range(3)) + (255,)
        for x in range(hell[0], hell[-1] + 1):
            r, g, b, a = px[x, y]
            if colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[2] <= 0.62:
                px[x, y] = mittel[:3] + (a,)


def umfaerben(bild, regeln, band=None):
    """regeln: Liste von dicts. Ein Pixel wird von der ersten passenden Regel erfasst.
    Bedingungen: zeilen (von, bis) als Anteil der Hoehe, hue (von, bis) in Grad
    (von > bis laeuft ueber 0), s_min/s_max, v_min/v_max.
    Wirkung: hue (Zielton), s_faktor, v_faktor, s_min_neu (Mindestsaettigung)."""
    im = bild.copy()
    if band:
        band_leeren(im, *band)
    w, h = im.size
    px = im.load()
    for y in range(h):
        f = y / h
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            grad = hh * 360
            for rg in regeln:
                z0, z1 = rg.get('zeilen', (0, 1))
                if not z0 <= f <= z1:
                    continue
                if 'hue' in rg:
                    lo, hi = rg['hue']
                    drin = lo <= grad <= hi if lo <= hi else (grad >= lo or grad <= hi)
                    if not drin:
                        continue
                if not rg.get('s_min', 0) <= s <= rg.get('s_max', 1):
                    continue
                if not rg.get('v_min', 0) <= v <= rg.get('v_max', 1):
                    continue
                nh = rg['ziel'] / 360 if 'ziel' in rg else hh
                ns = min(1, max(s * rg.get('s_faktor', 1), rg.get('s_min_neu', 0)))
                nv = min(1, v * rg.get('v_faktor', 1))
                nr, ng, nb = colorsys.hsv_to_rgb(nh, ns, nv)
                px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
                break
    return im


def schrift_schwarz(bild, von, bis):
    """Coca-Cola Zero: Etikett bleibt rot, die weisse Schrift wird schwarz.
    Je weisser ein Pixel, desto dunkler wird er; Kantenpixel zwischen Rot und
    Weiss werden dunkelrot, damit die Schrift nicht ausfranst."""
    im = bild.copy()
    w, h = im.size
    px = im.load()
    for y in range(int(von * h), int(bis * h) + 1):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if v < 0.55:
                continue                      # Etikettkante, Glas, Schatten
            weiss = max(0.0, min(1.0, (0.6 - s) / 0.45))
            if weiss == 0:
                continue                      # reines Etikettrot bleibt, wie es ist
            rot = colorsys.hsv_to_rgb(hh if s > 0.15 else 0.0, 0.85, v)   # Etikettrot bei gleicher Helligkeit
            schwarz = (0.07, 0.05, 0.05)
            neu = [rot[i] * (1 - weiss) + schwarz[i] * weiss for i in range(3)]
            px[x, y] = tuple(round(c * 255) for c in neu) + (a,)
    return im


def gesaris_einzeln():
    """gesaris.png zeigt zwei Flaschen; die linke steht vorn. Ihre rechte Kante
    ist die gespiegelte linke (Achse aus Hals und Fuss), alles rechts davon
    gehoert zur hinteren Flasche und faellt weg."""
    im = laden('gesaris')
    w, h = im.size
    px = im.load()
    achse = 28.7
    for y in range(h):
        links = next((x for x in range(w) if px[x, y][3] > 128), None)
        if links is None or links >= 45:          # nur die hintere Flasche
            for x in range(w):
                px[x, y] = (0, 0, 0, 0)
            continue
        rechts = 2 * achse - links
        for x in range(w):
            if x > rechts + 0.5:
                px[x, y] = (0, 0, 0, 0)
    return im.crop(im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox())


# ── Regeln je Sorte ─────────────────────────────────────────────
ROT = (340, 20)          # Coca-Cola-Rot
PINK = (285, 20)         # Gesaris: Spirale und Deckel
LIMETTE = (45, 115)      # Proviant-Limonade: Punkte, Band, gruenlicher Inhalt
APFEL_GRUEN = (60, 120)  # Proviant-Schorle: Etikett
APFEL_SAFT = (25, 59)    # Proviant-Schorle: trueber Apfelinhalt
ZITRONE = (47, 75)       # Richard's Sun Lemon: Etikett, Deckel
TEE = (15, 46.9)         # Richard's Sun: Teefarbe
SORTENBAND = (0.832, 0.872)   # Richard's Sun: helles Band mit "LEMON"

SORTEN = {
    'cola-original': ('cola', []),
    # Zero: Etikett und Deckel schwarz, das weisse Logo bleibt
    # Zero: Etikett und Deckel bleiben rot, nur die Schrift wird schwarz (Abed)
    'cola-zero': ('cola*zero', []),
    'limonade-limette-minze': ('limonade', []),
    'limonade-orange': ('limonade', [
        {'hue': LIMETTE, 's_min': 0.22, 'ziel': 30, 's_faktor': 1.15, 'v_faktor': 1.0},
        {'hue': LIMETTE, 's_min': 0.04, 'ziel': 36, 's_faktor': 2.2, 's_min_neu': 0.12},
    ]),
    'limonade-rhabarber': ('limonade', [
        {'hue': LIMETTE, 's_min': 0.22, 'ziel': 342, 's_faktor': 1.0, 'v_faktor': 0.95},
        {'hue': LIMETTE, 's_min': 0.04, 'ziel': 350, 's_faktor': 2.0, 's_min_neu': 0.10},
    ]),
    'schorle-kirsche-granatapfel': ('schorle', [
        {'hue': APFEL_GRUEN, 's_min': 0.15, 'ziel': 345, 's_faktor': 1.1, 'v_faktor': 0.98},
        {'hue': APFEL_SAFT, 's_min': 0.06, 'ziel': 354, 's_faktor': 2.8, 's_min_neu': 0.45, 'v_faktor': 0.6},
    ]),
    'ice-tea-lemon': ('ice-tea', []),
    'ice-tea-peach': ('ice-tea', SORTENBAND, [
        {'hue': ZITRONE, 's_min': 0.25, 'ziel': 24, 's_faktor': 1.0, 'v_faktor': 1.0},
    ]),
    'ice-tea-pomegranate': ('ice-tea', SORTENBAND, [
        {'hue': ZITRONE, 's_min': 0.25, 'ziel': 352, 's_faktor': 1.05, 'v_faktor': 0.88},
        {'hue': TEE, 's_min': 0.25, 'ziel': 356, 's_faktor': 1.0, 'v_faktor': 0.85},
    ]),
    'ice-tea-blueberry': ('ice-tea', SORTENBAND, [
        {'hue': ZITRONE, 's_min': 0.25, 'ziel': 228, 's_faktor': 0.95, 'v_faktor': 0.8},
        {'hue': TEE, 's_min': 0.25, 'ziel': 300, 's_faktor': 0.75, 'v_faktor': 0.62},
    ]),
    'gesaris-classic': ('gesaris*', [
        {'hue': PINK, 's_min': 0.1, 'ziel': 214, 's_faktor': 1.1},
    ]),
    'gesaris-still': ('gesaris*', [
        {'hue': PINK, 's_min': 0.1, 'ziel': 140, 's_faktor': 1.0, 'v_faktor': 0.85},
    ]),
    'gesaris-apfelschorle': ('gesaris*', [
        {'hue': PINK, 's_min': 0.1, 'ziel': 80, 's_faktor': 1.1, 'v_faktor': 0.85},
        # klares Glas wird zu goldgelbem Apfelsaft, die Lichter bleiben hell
        {'zeilen': (0.18, 1), 's_max': 0.2, 'v_min': 0.35, 'ziel': 46, 's_min_neu': 0.42, 'v_faktor': 0.96},
    ]),
    'potts-cola-mix': ('potts', []),
}


def main():
    os.makedirs(ZIEL, exist_ok=True)
    gesaris = gesaris_einzeln()
    for name, (vorlage, *rest) in SORTEN.items():
        band, regeln = rest if len(rest) == 2 else (None, rest[0])
        basis = (gesaris if vorlage == 'gesaris*'
                 else schrift_schwarz(laden('cola'), 0.375, 0.56) if vorlage == 'cola*zero'
                 else laden(vorlage))
        umfaerben(basis, regeln, band).save(os.path.join(ZIEL, name + '.png'), optimize=True)
        print(name)


if __name__ == '__main__':
    main()
