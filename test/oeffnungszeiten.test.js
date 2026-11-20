// Öffnungszeiten und wählbare Zeiten für Vorbestellungen (oeffnungszeiten.js).
// Oelde: Mo–Sa 11:30–21:00, So 13:00–21:00 (stammdaten.json).
// Alle Zeitpunkte als UTC (Z), damit die Tests unabhängig von der Zeitzone des
// Rechners laufen. Berlin: Winter = UTC+1, Sommer = UTC+2.
// Aufbau wie test/oeffnungszeiten.test.js von Odi’s Bowl Ahaus, Zeiten von Oelde.
const test   = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../oeffnungszeiten');

const utc = s => new Date(s);
const ersteZeit = (tage, i = 0) => tage[i].slots[0];
const letzteZeit = (tage, i = 0) => tage[i].slots[tage[i].slots.length - 1];

test('Konstanten wie vorgegeben', () => {
  assert.equal(Z.RASTER_MINUTEN, 15);
  assert.deepEqual(Z.VORLAUF_MINUTEN, { abholung: 30, lieferung: 45 });
  assert.equal(Z.LETZTER_SLOT_VOR_SCHLUSS, 15);
  assert.equal(Z.TAGE_VORAUS, 7);
  assert.equal(Z.ZEITZONE, 'Europe/Berlin');
});

test('Öffnungszeiten Oelde wie in stammdaten.json', () => {
  const stamm = require('../stammdaten.json').oeffnungszeiten_tage;
  const minuten = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'].forEach((tag, wd) => {
    assert.equal(stamm[tag].length, 1, tag);
    assert.deepEqual(Z.OEFFNUNGSZEITEN[wd], { von: minuten(stamm[tag][0][0]), bis: minuten(stamm[tag][0][1]) }, tag);
  });
});

test('istGeoeffnet: Montag bis Samstag 11:30–21 Uhr (Winter)', () => {
  // Do. 19.11.2026, Mo. 23.11.2026, Sa. 21.11.2026
  for (const tag of ['2026-11-19', '2026-11-23', '2026-11-21']) {
    assert.equal(Z.istGeoeffnet(utc(`${tag}T10:29:59Z`)), false, `${tag} 11:29:59`);
    assert.equal(Z.istGeoeffnet(utc(`${tag}T10:30:00Z`)), true,  `${tag} 11:30`);
    assert.equal(Z.istGeoeffnet(utc(`${tag}T19:59:59Z`)), true,  `${tag} 20:59:59`);
    assert.equal(Z.istGeoeffnet(utc(`${tag}T20:00:00Z`)), false, `${tag} 21:00`);
  }
});

test('istGeoeffnet: Sonntag 13–21 Uhr', () => {
  assert.equal(Z.istGeoeffnet(utc('2026-11-22T10:30:00Z')), false);   // So 11:30
  assert.equal(Z.istGeoeffnet(utc('2026-11-22T11:59:00Z')), false);   // So 12:59
  assert.equal(Z.istGeoeffnet(utc('2026-11-22T12:00:00Z')), true);    // So 13:00
  assert.equal(Z.istGeoeffnet(utc('2026-11-22T19:59:00Z')), true);    // So 20:59
  assert.equal(Z.istGeoeffnet(utc('2026-11-22T20:00:00Z')), false);   // So 21:00
});

test('istGeoeffnet: Sommerzeit (UTC+2)', () => {
  assert.equal(Z.istGeoeffnet(utc('2026-06-15T09:29:00Z')), false);   // Mo 11:29
  assert.equal(Z.istGeoeffnet(utc('2026-06-15T09:30:00Z')), true);    // Mo 11:30
  assert.equal(Z.istGeoeffnet(utc('2026-06-15T18:59:00Z')), true);    // Mo 20:59
  assert.equal(Z.istGeoeffnet(utc('2026-06-15T19:00:00Z')), false);   // Mo 21:00
  assert.equal(Z.modusAusUhrzeit(utc('2026-06-15T12:00:00Z')), 'online');
  assert.equal(Z.modusAusUhrzeit(utc('2026-06-15T05:00:00Z')), 'geschlossen');
});

test('slots um 7 Uhr: sieben Tage, jeder Wochentagstyp richtig (Abholung)', () => {
  const tage = Z.slots({ jetzt: utc('2026-11-19T06:00:00Z'), modus: 'abholung' });   // Do 07:00
  assert.deepEqual(tage.map(t => t.label), [
    'Heute, Do. 19.11.', 'Morgen, Fr. 20.11.', 'Sa. 21.11.', 'So. 22.11.', 'Mo. 23.11.', 'Di. 24.11.', 'Mi. 25.11.']);
  assert.deepEqual(tage.map(t => t.datum), [
    '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  // Mo–Sa: 11:30 + 30 Minuten
  assert.deepEqual(ersteZeit(tage), { wert: '2026-11-19T11:00:00.000Z', label: '12:00' });
  assert.deepEqual(letzteZeit(tage), { wert: '2026-11-19T19:45:00.000Z', label: '20:45' });
  assert.equal(tage[0].slots.length, 36);   // 12:00 … 20:45
  // Sa wie werktags, So: 13:30
  assert.equal(ersteZeit(tage, 2).label, '12:00');
  assert.equal(ersteZeit(tage, 2).wert, '2026-11-21T11:00:00.000Z');
  assert.equal(ersteZeit(tage, 3).label, '13:30');
  assert.equal(ersteZeit(tage, 3).wert, '2026-11-22T12:30:00.000Z');
  assert.equal(tage[3].slots.length, 30);   // So 13:30 … 20:45
  for (const t of tage) assert.equal(letzteZeit(tage, tage.indexOf(t)).label, '20:45');
});

test('Lieferung: 45 Minuten nach Öffnung statt 30', () => {
  const tage = Z.slots({ jetzt: utc('2026-11-19T06:00:00Z'), modus: 'lieferung' });
  assert.equal(ersteZeit(tage).label, '12:15');
  assert.equal(ersteZeit(tage, 2).label, '12:15');   // Sa
  assert.equal(ersteZeit(tage, 3).label, '13:45');   // So
  assert.equal(letzteZeit(tage).label, '20:45');
  assert.equal(tage[0].slots.length, 35);
});

test('Raster: nur volle Viertelstunden, lückenlos', () => {
  for (const modus of ['abholung', 'lieferung']) {
    const tage = Z.slots({ jetzt: utc('2026-11-19T10:37:00Z'), modus });   // Do 11:37
    for (const t of tage) {
      t.slots.forEach((s, i) => {
        assert.match(s.label, /^\d\d:(00|15|30|45)$/);
        assert.equal(new Date(s.wert).getUTCSeconds(), 0);
        if (i) assert.equal(Date.parse(s.wert) - Date.parse(t.slots[i - 1].wert), 15 * 60 * 1000);
      });
    }
  }
});

test('Vorlauf ab jetzt: 30 bzw. 45 Minuten, auf das Raster aufgerundet', () => {
  // Do 12:00 genau: Abholung 12:30 noch wählbar
  assert.equal(ersteZeit(Z.slots({ jetzt: utc('2026-11-19T11:00:00Z'), modus: 'abholung' })).label, '12:30');
  // Do 12:01: 12:31 → 12:45
  assert.equal(ersteZeit(Z.slots({ jetzt: utc('2026-11-19T11:01:00Z'), modus: 'abholung' })).label, '12:45');
  // Lieferung Do 12:01: 12:46 → 13:00
  assert.equal(ersteZeit(Z.slots({ jetzt: utc('2026-11-19T11:01:00Z'), modus: 'lieferung' })).label, '13:00');
  // Lieferung Do 12:00 genau: 12:45
  assert.equal(ersteZeit(Z.slots({ jetzt: utc('2026-11-19T11:00:00Z'), modus: 'lieferung' })).label, '12:45');
  // Kurz nach Öffnung (Do 11:40): Abholung frühestens 12:15 (ab jetzt), nicht 12:00
  assert.equal(ersteZeit(Z.slots({ jetzt: utc('2026-11-19T10:40:00Z'), modus: 'abholung' })).label, '12:15');
});

test('Ladenschluss: letzte Zeit 20:45, danach erst morgen', () => {
  // Abholung Do 20:15 → 20:45 gerade noch
  let tage = Z.slots({ jetzt: utc('2026-11-19T19:15:00Z'), modus: 'abholung' });
  assert.equal(tage[0].label, 'Heute, Do. 19.11.');
  assert.deepEqual(tage[0].slots.map(s => s.label), ['20:45']);
  // Abholung Do 20:16 → heute nichts mehr, der Tag fehlt
  tage = Z.slots({ jetzt: utc('2026-11-19T19:16:00Z'), modus: 'abholung' });
  assert.equal(tage[0].label, 'Morgen, Fr. 20.11.');
  assert.equal(tage.length, 6);
  // Lieferung Do 20:00 → 20:45; 20:01 → nichts mehr
  assert.deepEqual(Z.slots({ jetzt: utc('2026-11-19T19:00:00Z'), modus: 'lieferung' })[0].slots.map(s => s.label), ['20:45']);
  assert.equal(Z.slots({ jetzt: utc('2026-11-19T19:01:00Z'), modus: 'lieferung' })[0].label, 'Morgen, Fr. 20.11.');
});

test('Mitternacht: der Tag wechselt nach Berliner Zeit, nicht nach UTC', () => {
  // Do 23:59:30 Berlin = 22:59:30 UTC
  let tage = Z.slots({ jetzt: utc('2026-11-19T22:59:30Z'), modus: 'abholung' });
  assert.equal(tage[0].label, 'Morgen, Fr. 20.11.');
  assert.equal(tage[tage.length - 1].datum, '2026-11-25');
  // Fr 00:00:30 Berlin = Do 23:00:30 UTC
  tage = Z.slots({ jetzt: utc('2026-11-19T23:00:30Z'), modus: 'abholung' });
  assert.equal(tage[0].label, 'Heute, Fr. 20.11.');
  assert.equal(tage[1].label, 'Morgen, Sa. 21.11.');
  assert.equal(tage.length, 7);
  assert.equal(tage[6].datum, '2026-11-26');
  assert.equal(Z.berlinTeile(utc('2026-11-19T23:00:30Z')).tag, 20);
});

test('7 Tage: heute plus sechs, Anzahl begrenzt', () => {
  const jetzt = utc('2026-11-23T05:00:00Z');   // Mo 06:00
  assert.equal(Z.slots({ jetzt, modus: 'abholung' }).length, 7);
  assert.equal(Z.slots({ jetzt, modus: 'abholung' })[6].datum, '2026-11-29');
  assert.equal(Z.slots({ jetzt, modus: 'abholung', tage: 3 }).length, 3);
  assert.equal(Z.slots({ jetzt, modus: 'abholung', tage: 100 }).length, 7);
  assert.equal(Z.slots({ jetzt, modus: 'abholung', tage: 0 }).length, 0);
  assert.equal(Z.slots({ jetzt, modus: 'abholung', tage: 'x' }).length, 0);
});

test('Zeitumstellung März 2026 (29.03.): Samstag UTC+1, Sonntag UTC+2', () => {
  const tage = Z.slots({ jetzt: utc('2026-03-28T06:00:00Z'), modus: 'abholung' });   // Sa 07:00 MEZ
  assert.equal(tage[0].label, 'Heute, Sa. 28.03.');
  assert.equal(ersteZeit(tage).wert, '2026-03-28T11:00:00.000Z');      // 12:00 MEZ
  assert.equal(tage[1].label, 'Morgen, So. 29.03.');
  assert.equal(ersteZeit(tage, 1).wert, '2026-03-29T11:30:00.000Z');   // 13:30 MESZ
  assert.equal(letzteZeit(tage, 1).wert, '2026-03-29T18:45:00.000Z');  // 20:45 MESZ
  assert.equal(ersteZeit(tage, 2).wert, '2026-03-30T10:00:00.000Z');   // Mo 12:00 MESZ
  assert.equal(Z.istGeoeffnet(utc('2026-03-29T10:59:00Z')), false);    // So 12:59 MESZ
  assert.equal(Z.istGeoeffnet(utc('2026-03-29T11:00:00Z')), true);     // So 13:00 MESZ
  // Mitten in der Umstellungsnacht: Kalendertag stimmt trotzdem
  assert.equal(Z.berlinTeile(utc('2026-03-29T01:30:00Z')).minuten, 3 * 60 + 30);
});

test('Zeitumstellung Oktober 2026 (25.10.): Samstag UTC+2, Sonntag UTC+1', () => {
  const tage = Z.slots({ jetzt: utc('2026-10-24T05:00:00Z'), modus: 'lieferung' });   // Sa 07:00 MESZ
  assert.equal(ersteZeit(tage).wert, '2026-10-24T10:15:00.000Z');      // Sa 12:15 MESZ
  assert.equal(tage[1].label, 'Morgen, So. 25.10.');
  assert.equal(ersteZeit(tage, 1).wert, '2026-10-25T12:45:00.000Z');   // So 13:45 MEZ
  assert.equal(letzteZeit(tage, 1).wert, '2026-10-25T19:45:00.000Z');  // So 20:45 MEZ
  assert.equal(Z.istGeoeffnet(utc('2026-10-25T11:59:00Z')), false);    // So 12:59 MEZ
  assert.equal(Z.istGeoeffnet(utc('2026-10-25T12:00:00Z')), true);     // So 13:00 MEZ
});

test('Zeitumstellung 2027 (28.03. und 31.10.)', () => {
  let tage = Z.slots({ jetzt: utc('2027-03-27T23:30:00Z'), modus: 'abholung' });   // So 00:30 MEZ
  assert.equal(tage[0].label, 'Heute, So. 28.03.');
  assert.equal(ersteZeit(tage).wert, '2027-03-28T11:30:00.000Z');      // 13:30 MESZ
  tage = Z.slots({ jetzt: utc('2027-10-30T22:30:00Z'), modus: 'abholung' });   // So 00:30 MESZ
  assert.equal(tage[0].label, 'Heute, So. 31.10.');
  assert.equal(ersteZeit(tage).wert, '2027-10-31T12:30:00.000Z');      // 13:30 MEZ
  assert.equal(Z.zeitText(new Date('2027-10-31T12:30:00.000Z')), 'So. 31.10., 13:30 Uhr');
});

test('zeitText', () => {
  assert.equal(Z.zeitText(new Date('2026-11-20T11:30:00Z')), 'Fr. 20.11., 12:30 Uhr');
  assert.equal(Z.zeitText(new Date('2026-06-15T09:30:00Z')), 'Mo. 15.06., 11:30 Uhr');
});

test('pruefeWunschzeit: gültige Zeiten werden angenommen', () => {
  const jetzt = utc('2026-11-19T06:00:00Z');   // Do 07:00
  const r = Z.pruefeWunschzeit('2026-11-20T11:30:00.000Z', { jetzt, modus: 'abholung' });
  assert.equal(r.ok, true);
  assert.equal(r.zeitpunkt.toISOString(), '2026-11-20T11:30:00.000Z');
  // Derselbe Zeitpunkt in anderer Schreibweise
  assert.equal(Z.pruefeWunschzeit('2026-11-20T12:30:00+01:00', { jetzt, modus: 'abholung' }).ok, true);
  // Letzter Tag und letzte Zeit
  assert.equal(Z.pruefeWunschzeit('2026-11-25T19:45:00.000Z', { jetzt, modus: 'lieferung' }).ok, true);
  // Sonntag 13:30 Abholung
  assert.equal(Z.pruefeWunschzeit('2026-11-22T12:30:00.000Z', { jetzt, modus: 'abholung' }).ok, true);
});

test('pruefeWunschzeit: Abholung und Lieferung unterscheiden sich', () => {
  const jetzt = utc('2026-11-19T06:00:00Z');
  assert.equal(Z.pruefeWunschzeit('2026-11-19T11:00:00.000Z', { jetzt, modus: 'abholung' }).ok, true);    // 12:00
  const r = Z.pruefeWunschzeit('2026-11-19T11:00:00.000Z', { jetzt, modus: 'lieferung' });
  assert.equal(r.ok, false);
  assert.match(r.fehler, /liefern/);
  assert.equal(Z.pruefeWunschzeit('2026-11-19T11:15:00.000Z', { jetzt, modus: 'lieferung' }).ok, true);   // 12:15
});

test('pruefeWunschzeit: abgelehnt außerhalb der Zeiten', () => {
  const jetzt = utc('2026-11-19T06:00:00Z');
  const nein = (wert, modus = 'abholung') => assert.equal(Z.pruefeWunschzeit(wert, { jetzt, modus }).ok, false, wert);
  nein('2026-11-19T11:01:00.000Z');   // nicht im Raster
  nein('2026-11-19T11:00:30.000Z');   // Sekunden
  nein('2026-11-19T10:45:00.000Z');   // 11:45: zu früh nach Öffnung
  nein('2026-11-19T10:30:00.000Z');   // 11:30: Öffnung, aber ohne Vorlauf
  nein('2026-11-19T20:00:00.000Z');   // 21:00: Schluss
  nein('2026-11-19T19:50:00.000Z');
  nein('2026-11-19T05:00:00.000Z');   // in der Vergangenheit
  nein('2026-11-22T12:00:00.000Z');   // So 13:00: Öffnung, Vorlauf fehlt
  nein('2026-11-22T11:00:00.000Z');   // So 12:00: noch zu
  nein('2026-11-26T11:00:00.000Z');   // achter Tag
});

test('pruefeWunschzeit: Vorlauf ab jetzt mit fünf Minuten Kulanz', () => {
  const wert = '2026-11-19T11:00:00.000Z';   // Do 12:00, Abholung
  // um 11:29 gewählt, um 11:33 abgeschickt: noch gut
  assert.equal(Z.pruefeWunschzeit(wert, { jetzt: utc('2026-11-19T10:33:00Z'), modus: 'abholung' }).ok, true);
  assert.equal(Z.pruefeWunschzeit(wert, { jetzt: utc('2026-11-19T10:35:00Z'), modus: 'abholung' }).ok, true);
  // ab 11:36 nicht mehr
  assert.equal(Z.pruefeWunschzeit(wert, { jetzt: utc('2026-11-19T10:36:00Z'), modus: 'abholung' }).ok, false);
  // ohne Kulanz streng
  assert.equal(Z.pruefeWunschzeit(wert, { jetzt: utc('2026-11-19T10:31:00Z'), modus: 'abholung', kulanzMinuten: 0 }).ok, false);
});

test('pruefeWunschzeit und slots: ungültige Eingaben', () => {
  const jetzt = utc('2026-11-19T06:00:00Z');
  for (const wert of [undefined, null, '', 'morgen', 'abc', 12345, {}, [], { $gt: '' }, 'x'.repeat(41), '2026-13-40T99:00:00Z']) {
    const r = Z.pruefeWunschzeit(wert, { jetzt, modus: 'abholung' });
    assert.equal(r.ok, false, String(wert));
    assert.ok(r.fehler);
  }
  assert.throws(() => Z.slots({ jetzt, modus: 'post' }), TypeError);
  assert.throws(() => Z.slots({ jetzt, modus: undefined }), TypeError);
  assert.throws(() => Z.pruefeWunschzeit('2026-11-20T11:30:00.000Z', { jetzt, modus: 'x' }), TypeError);
  assert.throws(() => Z.berlinTeile(new Date('kaputt')), TypeError);
  assert.throws(() => Z.istGeoeffnet('2026-11-19'), TypeError);
});
