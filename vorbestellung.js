// ─── Vorbestellung: wann darf bestellt werden? ───────────────────
// Gemeinsame Prüfung für POST /api/orders (bar), /api/create-stripe-checkout
// und GET /api/zeiten. Reine Funktionen ohne Datenbank: server.js liest den
// Eintrag Settings('restaurant') und reicht ihn herein (Tests:
// test/vorbestellung.test.js). Die Zeiten selbst stehen in oeffnungszeiten.js.
// Unverändert aus Odi’s Bowl Ahaus übernommen (Oelde, 20.11.2026). In Oelde geht
// dieselbe Prüfung auch vor /api/create-paypal-order (Route offen, Seite ohne PayPal).
//
// Zustände (Abed, 19.11.2026):
// - online                          → sofort bestellen, Vorbestellung zusätzlich
// - geschlossen wegen der Uhrzeit   → nur Vorbestellung
// - geschlossen von Hand (Urlaub …)
//   oder neutral                    → gar nichts, auch keine Vorbestellung
// Die Kassen-App kennt kein eigenes Feld für die Wunschzeit. Damit sie und ihr
// Bon die Vorbestellung trotzdem zeigen, steht sie in der ersten Zeile von note.

const Zeiten = require('./oeffnungszeiten');

const ARTEN = ['abholung', 'lieferung'];
const NOTIZ_PRAEFIX = 'VORBESTELLUNG:';

const TEXT = {
  zuUhrzeit:   'Wir haben gerade geschlossen. Du kannst jetzt vorbestellen – wähle Tag und Uhrzeit.',
  zuVonHand:   'Online-Bestellungen sind gerade nicht möglich.',
  neutral:     'Online-Bestellungen sind gerade nicht möglich – wir arbeiten an unserem Bestellsystem.',
  ohneZeit:    'Der Laden ist gerade geschlossen. Bitte wähle eine Uhrzeit für deine Vorbestellung.',
  keineArt:    'Bitte wähle Abholung oder Lieferung.',
};

/**
 * Bestellzustand aus dem Settings-Eintrag. Fehlt er (oder war die Datenbank
 * nicht lesbar: settings = null), gilt der aus der Uhrzeit berechnete Modus.
 * Ohne manualOverride zählt immer die Uhrzeit, nicht der gespeicherte Modus:
 * Den schreibt der Cron erst bis zu eine Minute später.
 */
function bestellZustand({ settings, jetzt }) {
  const manuell = Boolean(settings && settings.manualOverride);
  let modus = Zeiten.modusAusUhrzeit(jetzt);
  if (manuell) {
    modus = settings.mode || (settings.isOpen === false ? 'geschlossen' : 'online');
    if (!['online', 'geschlossen', 'neutral'].includes(modus)) modus = 'geschlossen';
  }
  const jetztOffen = modus === 'online';
  const vorbestellung = modus === 'online' || (modus === 'geschlossen' && !manuell);
  const hinweis = jetztOffen ? ''
    : modus === 'neutral' ? TEXT.neutral
    : manuell ? TEXT.zuVonHand
    : TEXT.zuUhrzeit;
  return { modus, manuell, jetztOffen, bestellbar: jetztOffen || vorbestellung,
           sofort: jetztOffen, vorbestellung, hinweis };
}

/** Erste Zeile für note, Kasse und Bon: "VORBESTELLUNG: Fr. 20.11., Abholung um 12:30 Uhr" */
function notizZeile(wunschzeit, art) {
  const [tag, uhr] = Zeiten.zeitText(wunschzeit).split(', ');
  return `${NOTIZ_PRAEFIX} ${tag}, ${art === 'lieferung' ? 'Lieferung' : 'Abholung'} um ${uhr}`;
}

/** Die Notiz des Gastes ohne die Vorbestellungszeile (für Mails, Bon, Re-Order) */
function gastNotiz(order) {
  const note = String((order && order.note) || '');
  if (!order || !order.vorbestellung) return note;
  const zeilen = note.split('\n');
  if (zeilen[0].startsWith(NOTIZ_PRAEFIX)) zeilen.shift();
  return zeilen.join('\n').trim();
}

/**
 * Die gemeinsame Prüfung beider Bestellwege.
 * @param {{ body: object, zustand: object, jetzt: Date }} o
 * @returns {{ fehler: string, zeit: boolean }
 *         | { wunschzeit: Date|null, vorbestellung: boolean, note: string }}
 */
function pruefeBestellzeit({ body, zustand, jetzt }) {
  const b = body && typeof body === 'object' ? body : {};
  if (!zustand.bestellbar) return { fehler: zustand.hinweis || TEXT.zuVonHand, zeit: false };
  const art = b.mode;
  if (!ARTEN.includes(art)) return { fehler: TEXT.keineArt, zeit: false };

  // Die Notiz des Gastes: nie mit einer Zeile beginnen lassen, die wie unsere aussieht
  let gast = typeof b.note === 'string' ? b.note.trim() : '';
  if (/^\s*vorbestellung/i.test(gast)) gast = 'Anmerkung: ' + gast;

  const roh = b.wunschzeit;
  const ohneZeit = roh === undefined || roh === null || roh === '';
  if (ohneZeit) {
    if (!zustand.sofort) return { fehler: TEXT.ohneZeit, zeit: true };
    return { wunschzeit: null, vorbestellung: false, note: gast };
  }
  if (!zustand.vorbestellung) return { fehler: zustand.hinweis || TEXT.zuVonHand, zeit: false };
  const r = Zeiten.pruefeWunschzeit(roh, { jetzt, modus: art });
  if (!r.ok) return { fehler: r.fehler, zeit: true };
  const zeile = notizZeile(r.zeitpunkt, art);
  return { wunschzeit: r.zeitpunkt, vorbestellung: true, note: gast ? `${zeile}\n${gast}` : zeile };
}

/** Antwort für GET /api/zeiten */
function zeitenAntwort({ zustand, jetzt, art }) {
  return {
    modus: zustand.modus,
    manuell: zustand.manuell,
    jetztOffen: zustand.jetztOffen,
    bestellbar: zustand.bestellbar,
    sofort: zustand.sofort,
    vorbestellung: zustand.vorbestellung,
    hinweis: zustand.hinweis,
    art,
    tage: zustand.vorbestellung ? Zeiten.slots({ jetzt, modus: art }) : [],
  };
}

module.exports = { ARTEN, NOTIZ_PRAEFIX, TEXT, bestellZustand, pruefeBestellzeit, notizZeile, gastNotiz, zeitenAntwort };
