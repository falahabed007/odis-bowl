// ─── Öffnungszeiten und wählbare Zeiten für Vorbestellungen ──────
// Die EINZIGE Stelle im Server, an der die Öffnungszeiten von Odi’s Bowl Oelde
// stehen (stammdaten.json, Abed 20.10.2026; dieselben Zeiten nennt die
// Bestellseite in Bühne und Infoblock). server.js rechnet damit den Auto-Modus
// (online/geschlossen) und prüft die Wunschzeit einer Vorbestellung.
// Übernommen aus Odi’s Bowl Ahaus (19.11.2026), nur die Zeiten sind Oeldes.
//
// Reine Funktionen ohne Abhängigkeiten, die Uhrzeit wird immer übergeben
// (Tests: test/oeffnungszeiten.test.js). Gerechnet wird in Europe/Berlin über
// Intl, nie in Serverzeit: Der Server läuft in UTC, ein new Date(jahr, monat, tag)
// läge dort zwei Stunden daneben, im Winter eine.
//
// Vorbestellung (Abed, 19.11.2026): Gäste – oft Firmen, die um 7 Uhr bestellen –
// wählen Tag und Uhrzeit, aber nur, wenn der Laden dann geöffnet hat.

const ZEITZONE = 'Europe/Berlin';

// Öffnungszeiten je Wochentag (0 = Sonntag … 6 = Samstag), in Minuten ab
// Mitternacht. Kein Ruhetag. Ein Ruhetag wäre hier null.
const OEFFNUNGSZEITEN = {
  0: { von: 13 * 60,      bis: 21 * 60 },   // Sonntag   13:00–21:00
  1: { von: 11 * 60 + 30, bis: 21 * 60 },   // Montag    11:30–21:00
  2: { von: 11 * 60 + 30, bis: 21 * 60 },   // Dienstag
  3: { von: 11 * 60 + 30, bis: 21 * 60 },   // Mittwoch
  4: { von: 11 * 60 + 30, bis: 21 * 60 },   // Donnerstag
  5: { von: 11 * 60 + 30, bis: 21 * 60 },   // Freitag
  6: { von: 11 * 60 + 30, bis: 21 * 60 },   // Samstag   11:30–21:00
};

// Wählbare Zeiten für eine Vorbestellung
const RASTER_MINUTEN = 15;             // 12:00, 12:15, 12:30 …
const VORLAUF_MINUTEN = {              // frühestens so lange nach Öffnung UND ab jetzt
  abholung:  30,
  lieferung: 45,
};
const LETZTER_SLOT_VOR_SCHLUSS = 15;   // Schluss 21:00 → letzte Zeit 20:45
const TAGE_VORAUS = 7;                 // heute plus die nächsten 6 Tage
// Der Server prüft die Wunschzeit erst beim Absenden. Wer um 10:59 die 11:30
// gewählt hat und um 11:01 absendet, soll nicht scheitern: so viele Minuten
// darf "jetzt" bei der Prüfung zurückliegen.
const KULANZ_MINUTEN = 5;

const WOCHENTAG_KURZ = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
const WOCHENTAG_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatierer = new Intl.DateTimeFormat('en-US', {
  timeZone: ZEITZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});

function gueltigesDatum(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

// Kalender und Uhrzeit eines Zeitpunkts in Berlin
function berlinTeile(datum) {
  if (!gueltigesDatum(datum)) throw new TypeError('Ungültiger Zeitpunkt');
  const t = {};
  for (const p of formatierer.formatToParts(datum)) t[p.type] = p.value;
  const stunde = Number(t.hour) % 24;
  return {
    jahr: Number(t.year), monat: Number(t.month), tag: Number(t.day),
    wochentag: WOCHENTAG_EN[t.weekday],
    minuten: stunde * 60 + Number(t.minute),
    sekunden: Number(t.second),
  };
}

// Abstand Berlin–UTC in Millisekunden zu einem Zeitpunkt (Winter +1 h, Sommer +2 h)
function versatz(ms) {
  const b = berlinTeile(new Date(ms));
  const alsUtc = Date.UTC(b.jahr, b.monat - 1, b.tag, Math.floor(b.minuten / 60), b.minuten % 60, b.sekunden);
  return alsUtc - Math.floor(ms / 1000) * 1000;
}

// Zeitpunkt zu einer Berliner Wanduhrzeit (Kalendertag + Minuten ab Mitternacht).
// Zweimal nachrechnen, damit auch Tage mit Zeitumstellung stimmen.
function berlinZeitpunkt(jahr, monat, tag, minuten) {
  const wand = Date.UTC(jahr, monat - 1, tag, 0, minuten);
  let t = wand - versatz(wand);
  t = wand - versatz(t);
  return new Date(t);
}

// Kalendertag + n Tage (reine Kalenderrechnung, ohne Zeitzone)
function tagPlus(jahr, monat, tag, n) {
  const d = new Date(Date.UTC(jahr, monat - 1, tag + n, 12));
  return { jahr: d.getUTCFullYear(), monat: d.getUTCMonth() + 1, tag: d.getUTCDate(), wochentag: d.getUTCDay() };
}

const zwei = n => String(n).padStart(2, '0');
const uhrText = minuten => `${zwei(Math.floor(minuten / 60))}:${zwei(minuten % 60)}`;
const datumKurz = k => `${WOCHENTAG_KURZ[k.wochentag]} ${zwei(k.tag)}.${zwei(k.monat)}.`;

/** Hat der Laden zu diesem Zeitpunkt geöffnet? */
function istGeoeffnet(datum) {
  const b = berlinTeile(datum);
  const z = OEFFNUNGSZEITEN[b.wochentag];
  return Boolean(z) && b.minuten >= z.von && b.minuten < z.bis;
}

/** Auto-Modus aus der Uhrzeit, wie ihn der Cron in Settings schreibt */
function modusAusUhrzeit(datum) {
  return istGeoeffnet(datum) ? 'online' : 'geschlossen';
}

function pruefeArt(modus) {
  if (!Object.prototype.hasOwnProperty.call(VORLAUF_MINUTEN, modus)) {
    throw new TypeError(`Unbekannte Bestellart: ${modus}`);
  }
}

// Wählbare Zeiten ab einem Kalendertag in Berlin, frühestens ab einem Zeitpunkt
function sammle({ heute, fruehestens, modus, anzahl }) {
  const vorlauf = VORLAUF_MINUTEN[modus];
  const ergebnis = [];
  for (let i = 0; i < anzahl; i++) {
    const k = tagPlus(heute.jahr, heute.monat, heute.tag, i);
    const z = OEFFNUNGSZEITEN[k.wochentag];
    if (!z) continue;
    const erste = Math.ceil((z.von + vorlauf) / RASTER_MINUTEN) * RASTER_MINUTEN;
    const letzte = z.bis - LETZTER_SLOT_VOR_SCHLUSS;
    const liste = [];
    for (let m = erste; m <= letzte; m += RASTER_MINUTEN) {
      const zp = berlinZeitpunkt(k.jahr, k.monat, k.tag, m);
      if (zp.getTime() < fruehestens) continue;
      liste.push({ wert: zp.toISOString(), label: uhrText(m) });
    }
    if (!liste.length) continue;
    const vorne = i === 0 ? 'Heute, ' : i === 1 ? 'Morgen, ' : '';
    ergebnis.push({
      datum: `${k.jahr}-${zwei(k.monat)}-${zwei(k.tag)}`,
      label: vorne + datumKurz(k),
      slots: liste,
    });
  }
  return ergebnis;
}

/**
 * Wählbare Zeiten für eine Vorbestellung, nach Tagen. Tage ohne wählbare Zeit
 * fehlen (z. B. heute nach Ladenschluss).
 * @param {{ jetzt: Date, modus: 'abholung'|'lieferung', tage?: number }} o
 * @returns {{ datum: string, label: string, slots: { wert: string, label: string }[] }[]}
 */
function slots({ jetzt, modus, tage = TAGE_VORAUS } = {}) {
  pruefeArt(modus);
  const anzahl = Math.max(0, Math.min(Math.floor(Number(tage)) || 0, TAGE_VORAUS));
  return sammle({
    heute: berlinTeile(jetzt), modus, anzahl,
    fruehestens: jetzt.getTime() + VORLAUF_MINUTEN[modus] * 60 * 1000,
  });
}

/**
 * Prüft eine Wunschzeit (ISO-Zeitpunkt) gegen die wählbaren Zeiten. Dieselben
 * Tage wie slots(), nur darf "jetzt" um die Kulanz zurückliegen.
 * @returns {{ ok: true, zeitpunkt: Date } | { ok: false, fehler: string }}
 */
function pruefeWunschzeit(wert, { jetzt, modus, kulanzMinuten = KULANZ_MINUTEN } = {}) {
  pruefeArt(modus);
  if (typeof wert !== 'string' || !wert || wert.length > 40) {
    return { ok: false, fehler: 'Bitte wähle eine Uhrzeit für deine Vorbestellung.' };
  }
  const zp = new Date(wert);
  if (!gueltigesDatum(zp)) {
    return { ok: false, fehler: 'Diese Uhrzeit verstehen wir nicht. Bitte wähle sie noch einmal aus.' };
  }
  const kulanz = Math.max(0, Number(kulanzMinuten) || 0);
  const gefunden = sammle({
    heute: berlinTeile(jetzt), modus, anzahl: TAGE_VORAUS,
    fruehestens: jetzt.getTime() + (VORLAUF_MINUTEN[modus] - kulanz) * 60 * 1000,
  }).some(t => t.slots.some(s => Date.parse(s.wert) === zp.getTime()));
  if (!gefunden) {
    return { ok: false, fehler: modus === 'lieferung'
      ? 'Zu dieser Uhrzeit können wir nicht liefern. Bitte wähle eine andere Uhrzeit.'
      : 'Zu dieser Uhrzeit ist keine Abholung möglich. Bitte wähle eine andere Uhrzeit.' };
  }
  return { ok: true, zeitpunkt: zp };
}

/** "Fr. 20.11., 12:30 Uhr" – für Bon, Kasse, Mails und die Seite */
function zeitText(datum) {
  const b = berlinTeile(datum);
  return `${datumKurz(b)}, ${uhrText(b.minuten)} Uhr`;
}

module.exports = {
  ZEITZONE, OEFFNUNGSZEITEN, RASTER_MINUTEN, VORLAUF_MINUTEN, LETZTER_SLOT_VOR_SCHLUSS,
  TAGE_VORAUS, KULANZ_MINUTEN,
  berlinTeile, berlinZeitpunkt, istGeoeffnet, modusAusUhrzeit, slots, pruefeWunschzeit, zeitText,
};
