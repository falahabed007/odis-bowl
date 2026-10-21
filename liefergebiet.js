/*
 * Liefergebiet nach Fahrstrecke: Strasse + Hausnummer -> Meter -> Liefergebuehr.
 *
 * Bestellseite und Server laden diese eine Datei, damit beide dieselbe Gebuehr
 * rechnen. Die Strecken stehen in liefergebiet.json (erzeugt mit
 * liefergebiet/erzeugen.py) - beim Bestellen geht keine Adresse an einen
 * fremden Dienst.
 *
 *   const gebiet = Liefergebiet.erstelle(datenAusLiefergebietJson);
 *   gebiet.finde('Bahnhofstr.', '11a')
 *     -> { status: 'ok', strasse: 'Bahnhofstraße', ort: 'Oelde', nr: '11a',
 *          meter: 0, gebuehr: 3, geschaetzt: false }
 *
 * status: 'ok' | 'zu-weit' | 'strasse-fehlt' | 'strasse-unbekannt'
 *         | 'mehrdeutig' | 'nr-fehlt' | 'nr-unbekannt'
 */
(function (wurzel, bauen) {
  if (typeof module === 'object' && module.exports) module.exports = bauen();
  else wurzel.Liefergebiet = bauen();
})(typeof self !== 'undefined' ? self : this, function () {
  const HAUPTORT = 'Oelde';

  // "Bahnhofstr.", "Bahnhof Strasse" und "bahnhofstraße" sollen dieselbe
  // Strasse finden. Leerzeichen, Bindestriche und Punkte fallen weg.
  function normStrasse(s) {
    return String(s || '').toLowerCase()
      .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/str\.?(?=[\s(]|$)/g, 'strasse')
      .replace(/[\s.\-]+/g, '');
  }

  // "12 A" -> { zahl: 12, zusatz: 'a' }; "12-14" zaehlt als 12
  function zerlegeNr(s) {
    const m = String(s || '').toLowerCase().replace(/\s+/g, '').match(/^(\d+)([a-z]?)/);
    return m ? { zahl: Number(m[1]), zusatz: m[2] } : null;
  }

  // "Köntrup (Ennigerloh)" -> { strasse: 'Köntrup', ort: 'Ennigerloh' }
  function zerlegeSchluessel(k) {
    const m = k.match(/^(.*?)\s*\(([^)]+)\)$/);
    return m ? { strasse: m[1], ort: m[2] } : { strasse: k, ort: HAUPTORT };
  }

  function erstelle(daten) {
    const zonen = daten.zonen.slice().sort((a, b) => a.bis_km - b.bis_km);
    const grenze = zonen[zonen.length - 1].bis_km * 1000;
    const strassen = daten.strassen;
    const genau = new Map();    // "koentrup(ennigerloh)" -> Schluessel
    const ohneOrt = new Map();  // "koentrup" -> [Schluessel, ...]
    Object.keys(strassen).forEach(k => {
      genau.set(normStrasse(k), k);
      const basis = normStrasse(zerlegeSchluessel(k).strasse);
      if (!ohneOrt.has(basis)) ohneOrt.set(basis, []);
      ohneOrt.get(basis).push(k);
    });

    function gebuehrFuer(meter) {
      const z = zonen.find(z => meter <= z.bis_km * 1000);
      return z ? z.gebuehr : null;
    }

    function schluesselFuer(eingabe) {
      const n = normStrasse(eingabe);
      if (genau.has(n)) return { k: genau.get(n) };
      const treffer = ohneOrt.get(n) || [];
      // Ohne Ortsangabe gewinnt Oelde; eine Strasse, die es nur in einem
      // Nachbarort gibt, wird auch ohne "(Ort)" gefunden.
      const imHauptort = treffer.find(k => zerlegeSchluessel(k).ort === HAUPTORT);
      if (imHauptort) return { k: imHauptort };
      if (treffer.length === 1) return { k: treffer[0] };
      if (treffer.length > 1) return { mehrdeutig: treffer };
      return {};
    }

    // Hausnummer nicht in den Kartendaten (Neubau, "12b"): die Nachbarn auf
    // derselben Strasse nehmen, und zwar die weitere von beiden - im Zweifel
    // eher die hoehere Zone. Liegt die Nummer weit ausserhalb der bekannten,
    // wird nicht geraten.
    function schaetze(nummern, zahl) {
      const bekannt = Object.keys(nummern)
        .map(n => ({ zahl: zerlegeNr(n).zahl, meter: nummern[n] }))
        .sort((a, b) => a.zahl - b.zahl);
      const unten = bekannt.filter(b => b.zahl <= zahl).pop();
      const oben = bekannt.find(b => b.zahl >= zahl);
      if (!unten && oben && oben.zahl - zahl > 10) return null;
      if (!oben && unten && zahl - unten.zahl > 10) return null;
      return Math.max(unten ? unten.meter : 0, oben ? oben.meter : 0);
    }

    function finde(strasseEingabe, nrEingabe) {
      if (!String(strasseEingabe || '').trim()) return { status: 'strasse-fehlt' };
      const s = schluesselFuer(strasseEingabe);
      if (s.mehrdeutig) {
        return { status: 'mehrdeutig', vorschlaege: s.mehrdeutig };
      }
      if (!s.k) return { status: 'strasse-unbekannt' };
      const { strasse, ort } = zerlegeSchluessel(s.k);
      const nr = zerlegeNr(nrEingabe);
      if (!nr) return { status: 'nr-fehlt', strasse, ort };
      const nummern = strassen[s.k];
      const nrText = String(nrEingabe).trim();
      let meter = nummern[nr.zahl + nr.zusatz];
      let geschaetzt = false;
      if (meter === undefined) meter = nummern[String(nr.zahl)];
      if (meter === undefined) {
        meter = schaetze(nummern, nr.zahl);
        geschaetzt = true;
        if (meter === null) return { status: 'nr-unbekannt', strasse, ort, nr: nrText };
      }
      const basis = { strasse, ort, nr: nrText, meter, geschaetzt };
      if (meter > grenze) return Object.assign({ status: 'zu-weit' }, basis);
      return Object.assign({ status: 'ok', gebuehr: gebuehrFuer(meter) }, basis);
    }

    // Fuer die Vorschlagsliste im Adressfeld: Oelde ohne Zusatz, Nachbarorte
    // mit "(Ort)".
    const vorschlaege = Object.keys(strassen).sort((a, b) => a.localeCompare(b, 'de'));

    return {
      finde,
      vorschlaege,
      zonen,
      mindestwert: daten.mindestwert,
      grenzeKm: grenze / 1000,
    };
  }

  return { erstelle, HAUPTORT };
});
