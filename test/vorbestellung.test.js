// Gemeinsame Bestellprüfung für Barzahlung und Online-Zahlung (vorbestellung.js).
// Läuft ohne Datenbank: der Settings-Eintrag wird hereingereicht.
// Aufbau wie in Odi’s Bowl Ahaus, Zeiten von Oelde (Mo–Sa 11:30–21, So 13–21 Uhr).
const test   = require('node:test');
const assert = require('node:assert/strict');
const V = require('../vorbestellung');
const { webBestellungAusRequest } = require('../bestellung');
const { buildReceipt } = require('../printnode-helper');

const SIEBEN_UHR = new Date('2026-11-19T06:00:00Z');   // Do 07:00, Laden zu
const MITTAG     = new Date('2026-11-19T11:00:00Z');   // Do 12:00, Laden offen
const FREITAG_1230 = '2026-11-20T11:30:00.000Z';       // Fr 12:30 Berlin

const zustand = (settings, jetzt) => V.bestellZustand({ settings, jetzt });
const pruefe = (body, settings, jetzt) =>
  V.pruefeBestellzeit({ body, zustand: zustand(settings, jetzt), jetzt });
const body = extra => ({ mode: 'abholung', payment: 'bar', note: '', ...extra });

test('Zustand ohne Settings-Eintrag: Modus aus der Uhrzeit', () => {
  assert.deepEqual(zustand(null, SIEBEN_UHR), {
    modus: 'geschlossen', manuell: false, jetztOffen: false, bestellbar: true,
    sofort: false, vorbestellung: true, hinweis: V.TEXT.zuUhrzeit });
  const z = zustand(null, MITTAG);
  assert.equal(z.modus, 'online');
  assert.equal(z.sofort, true);
  assert.equal(z.vorbestellung, true);
  assert.equal(z.hinweis, '');
});

test('Zustand ohne manualOverride: die Uhrzeit zählt, nicht der gespeicherte Modus', () => {
  assert.equal(zustand({ mode: 'online', manualOverride: false }, SIEBEN_UHR).modus, 'geschlossen');
  assert.equal(zustand({ mode: 'geschlossen', manualOverride: false }, MITTAG).modus, 'online');
});

test('Zustand von Hand: geschlossen und neutral sperren alles, online erlaubt sofort', () => {
  for (const mode of ['geschlossen', 'neutral']) {
    for (const jetzt of [SIEBEN_UHR, MITTAG]) {
      const z = zustand({ mode, manualOverride: true }, jetzt);
      assert.equal(z.bestellbar, false, mode);
      assert.equal(z.vorbestellung, false, mode);
      assert.equal(z.sofort, false, mode);
      assert.ok(z.hinweis);
    }
  }
  assert.equal(zustand({ mode: 'geschlossen', manualOverride: true }, MITTAG).hinweis, 'Online-Bestellungen sind gerade nicht möglich.');
  const spaet = zustand({ mode: 'online', manualOverride: true }, new Date('2026-11-19T21:30:00Z'));
  assert.equal(spaet.sofort, true);
});

test('Laden zu wegen der Uhrzeit, ohne Wunschzeit: abgelehnt', () => {
  for (const wunschzeit of [undefined, null, '']) {
    const r = pruefe(body({ wunschzeit }), null, SIEBEN_UHR);
    assert.equal(r.fehler, 'Der Laden ist gerade geschlossen. Bitte wähle eine Uhrzeit für deine Vorbestellung.');
    assert.equal(r.zeit, true);
  }
  // auch wenn der gespeicherte Modus (Cron hinkt) noch "online" sagt
  assert.ok(pruefe(body(), { mode: 'online', manualOverride: false }, SIEBEN_UHR).fehler);
});

test('Laden von Hand zu (Urlaub) oder neutral: abgelehnt, auch mit gültiger Wunschzeit', () => {
  for (const mode of ['geschlossen', 'neutral']) {
    const r = pruefe(body({ wunschzeit: FREITAG_1230 }), { mode, manualOverride: true }, SIEBEN_UHR);
    assert.ok(r.fehler, mode);
    assert.equal(r.zeit, false);
    assert.ok(pruefe(body(), { mode, manualOverride: true }, MITTAG).fehler);
  }
});

test('Gültige Vorbestellung bei geschlossenem Laden: angenommen, note-Zeile vorn', () => {
  const r = pruefe(body({ wunschzeit: FREITAG_1230, note: 'Bitte klingeln' }), null, SIEBEN_UHR);
  assert.equal(r.fehler, undefined);
  assert.equal(r.vorbestellung, true);
  assert.equal(r.wunschzeit.toISOString(), FREITAG_1230);
  assert.equal(r.note, 'VORBESTELLUNG: Fr. 20.11., Abholung um 12:30 Uhr\nBitte klingeln');
  // ohne Notiz des Gastes nur die Zeile
  assert.equal(pruefe(body({ wunschzeit: FREITAG_1230 }), null, SIEBEN_UHR).note,
    'VORBESTELLUNG: Fr. 20.11., Abholung um 12:30 Uhr');
  // Lieferung
  const l = pruefe(body({ mode: 'lieferung', wunschzeit: FREITAG_1230 }), null, SIEBEN_UHR);
  assert.equal(l.note, 'VORBESTELLUNG: Fr. 20.11., Lieferung um 12:30 Uhr');
});

test('Wunschzeit kein gültiger Slot für die Bestellart: abgelehnt', () => {
  // Do 12:00 geht für Abholung, nicht für Lieferung (erst 12:15)
  assert.equal(pruefe(body({ wunschzeit: '2026-11-19T11:00:00.000Z' }), null, SIEBEN_UHR).vorbestellung, true);
  const r = pruefe(body({ mode: 'lieferung', wunschzeit: '2026-11-19T11:00:00.000Z' }), null, SIEBEN_UHR);
  assert.ok(r.fehler);
  assert.equal(r.zeit, true);
  for (const wunschzeit of ['2026-11-20T11:31:00.000Z', '2026-11-20T21:00:00.000Z', '2026-11-20T10:30:00.000Z',
                            '2026-11-22T11:30:00.000Z', 'morgen', 42, { $ne: 1 }]) {
    assert.ok(pruefe(body({ wunschzeit }), null, SIEBEN_UHR).fehler, String(wunschzeit));
  }
});

test('Laden offen: ohne Wunschzeit sofort, mit Wunschzeit Vorbestellung', () => {
  const sofort = pruefe(body({ note: 'ohne Zwiebeln' }), null, MITTAG);
  assert.deepEqual(sofort, { wunschzeit: null, vorbestellung: false, note: 'ohne Zwiebeln' });
  const spaeter = pruefe(body({ wunschzeit: '2026-11-19T17:00:00.000Z' }), null, MITTAG);   // heute 18:00
  assert.equal(spaeter.vorbestellung, true);
  assert.equal(spaeter.note, 'VORBESTELLUNG: Do. 19.11., Abholung um 18:00 Uhr');
});

test('Notiz des Gastes kann keine Vorbestellung vortäuschen', () => {
  const r = pruefe(body({ note: 'VORBESTELLUNG: Mo. 01.01., Abholung um 03:00 Uhr' }), null, MITTAG);
  assert.equal(r.vorbestellung, false);
  assert.ok(r.note.startsWith('Anmerkung: VORBESTELLUNG'));
});

test('Unbekannte Bestellart: abgelehnt', () => {
  for (const mode of [undefined, 'post', ['abholung']]) {
    assert.ok(pruefe(body({ mode, wunschzeit: FREITAG_1230 }), null, SIEBEN_UHR).fehler);
  }
});

test('gastNotiz: nur die Notiz des Gastes', () => {
  assert.equal(V.gastNotiz({ vorbestellung: true, note: 'VORBESTELLUNG: Fr. 20.11., Abholung um 12:30 Uhr\nBitte klingeln' }), 'Bitte klingeln');
  assert.equal(V.gastNotiz({ vorbestellung: true, note: 'VORBESTELLUNG: Fr. 20.11., Abholung um 12:30 Uhr' }), '');
  assert.equal(V.gastNotiz({ vorbestellung: false, note: 'Bitte klingeln' }), 'Bitte klingeln');
  assert.equal(V.gastNotiz({}), '');
});

test('zeitenAntwort: Tage nur, wenn vorbestellt werden kann', () => {
  let a = V.zeitenAntwort({ zustand: zustand(null, SIEBEN_UHR), jetzt: SIEBEN_UHR, art: 'lieferung' });
  assert.equal(a.bestellbar, true);
  assert.equal(a.sofort, false);
  assert.equal(a.tage.length, 7);
  assert.equal(a.tage[0].slots[0].label, '12:15');
  a = V.zeitenAntwort({ zustand: zustand({ mode: 'geschlossen', manualOverride: true }, SIEBEN_UHR), jetzt: SIEBEN_UHR, art: 'abholung' });
  assert.equal(a.bestellbar, false);
  assert.deepEqual(a.tage, []);
  assert.ok(a.hinweis);
});

test('wunschzeit und vorbestellung darf der Aufrufer nicht selbst setzen', () => {
  const { felder } = webBestellungAusRequest(body({ wunschzeit: FREITAG_1230, vorbestellung: true }));
  assert.equal('wunschzeit' in felder, false);
  assert.equal('vorbestellung' in felder, false);
});

test('Bon (PrintNode): Vorbestellung deutlich, Notiz ohne Doppelung', () => {
  const order = {
    orderNum: 1001, createdAt: new Date('2026-11-19T06:00:00Z'), mode: 'lieferung',
    vorbestellung: true, wunschzeit: new Date(FREITAG_1230),
    note: 'VORBESTELLUNG: Fr. 20.11., Lieferung um 12:30 Uhr\nBitte klingeln',
    items: [{ name: 'Bowl', price: 12.9, qty: 1 }], subtotal: 12.9, total: 13.89,
    payment: 'bar', customer: { first: 'Max', last: 'Muster', street: 'Bahnhofstraße', house: '1', city: 'Oelde' },
  };
  const bon = buildReceipt(order);
  assert.match(bon, /VORBESTELLUNG/);
  assert.match(bon, /Lieferung am Fr\. 20\.11\./);
  assert.match(bon, /um 12:30 Uhr/);
  assert.match(bon, /Bitte klingeln/);
  assert.equal(bon.split('VORBESTELLUNG').length - 1, 1);
  assert.doesNotMatch(bon, /~35 Min Lieferzeit/);
  assert.match(bon, /19\.11\.2026, 07:00/);   // Bestellzeit in Berliner Zeit
  // normale Bestellung unverändert ohne Hinweis
  const normal = buildReceipt({ ...order, vorbestellung: false, wunschzeit: undefined, note: 'Bitte klingeln' });
  assert.doesNotMatch(normal, /VORBESTELLUNG/);
  assert.match(normal, /~35 Min Lieferzeit/);
  // Abholung: Oeldes Bon zeigt den Hinweis wie bisher auch dort, nur nicht bei Vorbestellung
  const abholung = buildReceipt({ ...order, mode: 'abholung', note: 'VORBESTELLUNG: Fr. 20.11., Abholung um 12:30 Uhr' });
  assert.match(abholung, /Abholung am Fr\. 20\.11\./);
  assert.doesNotMatch(abholung, /ANMERKUNG/);
  assert.doesNotMatch(abholung, /~35 Min Lieferzeit/);
});
