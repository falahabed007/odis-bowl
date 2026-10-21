# Erzeugt liefergebiet.json: Fahrstrecke vom Laden zu jeder Adresse im Umkreis.
#
#   python3 -I liefergebiet/erzeugen.py            # holt Adressen + Strecken neu
#   python3 -I liefergebiet/erzeugen.py strecken.json   # nur aus einem frueheren Lauf
#
# Adressen: OpenStreetMap ueber Overpass (alle Hausnummern im Umkreis von 6,5 km
# Luftlinie). Strecken: OSRM-Table mit dem Auto, eine Quelle (der Laden) und
# 99 Ziele je Anfrage. Beides laeuft nur hier, beim Erzeugen - beim Bestellen
# geht keine Kundenadresse an einen fremden Dienst.
#
# Gespeichert werden nur Strassen, an denen mindestens eine Adresse innerhalb
# der groessten Zone liegt; deren Hausnummern aber vollstaendig, damit eine
# Hausnummer jenseits von 5 km als "zu weit" erkannt wird und nicht als
# unbekannt.
import json, sys, time, urllib.parse, urllib.request
from collections import defaultdict

LADEN = (51.8267587, 8.1430233)          # Bahnhofstr. 11, 59302 Oelde
UMKREIS_M = 6500
ZONEN = [{'bis_km': 2, 'gebuehr': 3.0}, {'bis_km': 3, 'gebuehr': 4.0}, {'bis_km': 5, 'gebuehr': 5.0}]
MINDESTWERT = 30.0
UA = {'User-Agent': 'FlueVate-OdisBowl-Liefergebiet/1.0 (+https://odis-oelde.com)'}
ZIEL = __file__.rsplit('/', 1)[0] + '/../liefergebiet.json'


def adressen():
    q = f'''[out:json][timeout:120];
(node["addr:housenumber"]["addr:street"](around:{UMKREIS_M},{LADEN[0]},{LADEN[1]});
 way["addr:housenumber"]["addr:street"](around:{UMKREIS_M},{LADEN[0]},{LADEN[1]}););
out center tags;'''
    daten = urllib.parse.urlencode({'data': q}).encode()
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=daten, headers=UA)
    el = json.load(urllib.request.urlopen(req, timeout=300))['elements']
    pts = []
    for e in el:
        t = e['tags']
        lat = e.get('lat') or e['center']['lat']; lon = e.get('lon') or e['center']['lon']
        pts.append({'ort': t.get('addr:city') or '', 'str': t['addr:street'], 'nr': t['addr:housenumber'],
                    'lat': lat, 'lon': lon})
    return pts


def strecken(pts):
    for i in range(0, len(pts), 99):
        teil = pts[i:i + 99]
        coords = ';'.join(f'{lon:.6f},{lat:.6f}' for lat, lon in
                          [LADEN] + [(p['lat'], p['lon']) for p in teil])
        url = f'https://router.project-osrm.org/table/v1/driving/{coords}?sources=0&annotations=distance'
        for versuch in range(5):
            try:
                r = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
                if r.get('code') == 'Ok': break
            except Exception as ex:
                r = {'code': str(ex)}
            time.sleep(3 + versuch * 3)
        else:
            sys.exit(f'OSRM bricht bei Adresse {i} ab: {r.get("code")}')
        for p, m in zip(teil, r['distances'][0][1:]):
            p['m'] = None if m is None else round(m)
        time.sleep(1.1)   # oeffentlicher Server: hoechstens eine Anfrage je Sekunde
    return pts


def schluessel(p):
    # Oelde ist der Normalfall; eine Strasse in einem Nachbarort traegt ihn im
    # Namen, damit sie nicht mit einer gleichnamigen in Oelde zusammenfaellt.
    return p['str'] if p['ort'] in ('Oelde', '') else f"{p['str']} ({p['ort']})"


def main():
    if len(sys.argv) > 1:
        pts = json.load(open(sys.argv[1]))
    else:
        pts = strecken(adressen())
    grenze = ZONEN[-1]['bis_km'] * 1000
    je_strasse = defaultdict(dict)
    for p in pts:
        if p.get('m') is None: continue
        nr = p['nr'].lower().replace(' ', '')
        alt = je_strasse[schluessel(p)].get(nr)
        # Mehrere Punkte fuer dieselbe Adresse (Gebaeude + Eingang): der naechste zaehlt
        je_strasse[schluessel(p)][nr] = p['m'] if alt is None else min(alt, p['m'])
    strassen = {s: dict(sorted(h.items(), key=lambda kv: (len(kv[0]), kv[0])))
                for s, h in sorted(je_strasse.items()) if min(h.values()) <= grenze}
    aus = {
        '_quelle': 'Adressen (c) OpenStreetMap-Mitwirkende, ODbL; Fahrstrecke per OSRM (Auto), '
                   f'erzeugt am {time.strftime("%d.%m.%Y")} mit liefergebiet/erzeugen.py',
        '_einheit': 'Meter Fahrstrecke vom Laden, je Strasse und Hausnummer',
        'zonen': ZONEN,
        'mindestwert': MINDESTWERT,
        'strassen': strassen,
    }
    json.dump(aus, open(ZIEL, 'w'), ensure_ascii=False, separators=(',', ':'))
    n = sum(len(h) for h in strassen.values())
    print(f'{len(strassen)} Strassen, {n} Adressen -> {ZIEL}')


if __name__ == '__main__':
    main()
