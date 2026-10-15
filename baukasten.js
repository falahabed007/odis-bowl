/* Baukasten - ein Artikel, der sich in Schritten zusammensetzt (Bowl, Wrap, Acai).
 *
 * Webseite und Kasse laden dieselbe Datei; die Konfiguration steht in
 * window.BAUKASTEN und wird von karte-einsetzen.js aus Menue/menu.json erzeugt.
 *
 *   openBaukasten(el)               Webseite: el traegt data-bk="<Artikelnummer>"
 *   openBaukasten('B1', fertig)     Kasse: fertig(name, preis, extraDetails, note)
 *
 * Preis eines Schritts: je Option ihr Gruppenzuschlag (Fleisch +1,50), dazu
 * fuer jede Wahl ueber "inklusive" hinaus der "aufpreis". Die Wahl landet als
 * eine Zeile je Schritt in extraDetails - so steht sie auf Bon und Bestellmail
 * genau wie die Extras einer Pizza.
 */
(function () {
  'use strict';

  const eur = (v) => v.toFixed(2).replace('.', ',') + ' €';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Ausverkauft: auf der Webseite setzt der Statusabgleich window.AUSVERKAUFT,
  // im Dashboard fuehrt die Kasse soldOutList.
  function ausverkauft() {
    if (Array.isArray(window.AUSVERKAUFT)) return window.AUSVERKAUFT;
    try { if (Array.isArray(soldOutList)) return soldOutList; } catch (e) {}
    return [];
  }

  // Optionen eines Schritts mit ihrem Einzelzuschlag, flach.
  function optionen(schritt) {
    if (schritt.gruppen) {
      return schritt.gruppen.flatMap(g =>
        g.optionen.map(n => ({ name: n, zuschlag: g.zuschlag || 0, gruppe: g.titel })));
    }
    return schritt.optionen.map(n => ({ name: n, zuschlag: 0 }));
  }

  function schrittPreis(schritt, gewaehlt) {
    const opt = optionen(schritt);
    let p = gewaehlt.reduce((s, n) => s + (opt.find(o => o.name === n)?.zuschlag || 0), 0);
    if (schritt.inklusive != null && schritt.aufpreis) {
      p += Math.max(0, gewaehlt.length - schritt.inklusive) * schritt.aufpreis;
    }
    return p;
  }

  function regel(schritt) {
    const min = schritt.min || 0, max = schritt.max;
    if (schritt.hinweis) return schritt.hinweis;
    if (max === 1 && min === 1) return 'bitte eins wählen';
    if (max === 1) return 'optional, eins';
    if (min > 0) return `mindestens ${min}`;
    return 'optional, gern mehrere';
  }

  // ── Stil, einmal eingehaengt ─────────────────────────────────
  // Farben aus der Tokenschicht des Standorts, mit dem Rot der Karte als
  // Rueckfall, solange erscheinungsbild.js noch nicht gelaufen ist.
  const CSS = `
  .bk-ov{position:fixed;inset:0;background:rgba(20,16,12,.55);z-index:9999990;display:flex;align-items:flex-end;justify-content:center}
  @media(min-width:700px){.bk-ov{align-items:center}}
  .bk{--bk-a:var(--odis-akzent,#c8473b);--bk-auf:var(--odis-auf-akzent,#fff);--bk-txt:var(--odis-schrift,#2f2b28);--bk-leise:var(--odis-schrift-leise,#6b625b);--bk-fl:var(--odis-flaeche,#fffaf3);--bk-rand:var(--odis-rahmen,#e6ddd2);
    background:var(--bk-fl);color:var(--bk-txt);width:100%;max-width:640px;max-height:92vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.25);font-family:inherit}
  @media(min-width:700px){.bk{border-radius:18px;max-height:88vh}}
  .bk-kopf{padding:18px 20px 12px;border-bottom:1px solid var(--bk-rand);position:relative}
  .bk-kopf h2{margin:0;font-size:1.35rem;color:var(--bk-a)}
  .bk-kopf p{margin:4px 0 0;color:var(--bk-leise);font-size:.88rem}
  .bk-zu{position:absolute;right:14px;top:10px;background:none;border:0;font-size:28px;line-height:1;color:var(--bk-leise);cursor:pointer;padding:4px 8px}
  .bk-rumpf{overflow-y:auto;padding:6px 20px 16px;-webkit-overflow-scrolling:touch}
  .bk-schritt{padding:14px 0;border-bottom:1px dashed var(--bk-rand)}
  .bk-schritt:last-child{border-bottom:0}
  .bk-st{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .bk-nr{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--bk-a);color:var(--bk-auf);font-weight:700;font-size:.85rem;flex:none}
  .bk-st h3{margin:0;font-size:1.02rem}
  .bk-regel{font-size:.8rem;color:var(--bk-leise)}
  .bk-zahl{margin-left:auto;font-size:.8rem;font-weight:700;color:var(--bk-a)}
  .bk-schritt.bk-fehlt .bk-regel{color:#b3261e;font-weight:700}
  .bk-gruppe{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--bk-leise);margin:10px 0 6px}
  .bk-chips{display:flex;flex-wrap:wrap;gap:8px}
  .bk-chip{border:1.5px solid var(--bk-rand);background:#fff;color:var(--bk-txt);border-radius:999px;padding:8px 14px;font:inherit;font-size:.9rem;cursor:pointer;min-height:40px;transition:background .15s,border-color .15s}
  .bk-chip small{color:var(--bk-leise);margin-left:4px}
  .bk-chip[aria-pressed="true"]{background:var(--bk-a);border-color:var(--bk-a);color:var(--bk-auf)}
  .bk-chip[aria-pressed="true"] small{color:inherit;opacity:.85}
  .bk-chip:disabled{opacity:.45;cursor:not-allowed;text-decoration:line-through}
  .bk-chip:focus-visible{outline:3px solid var(--bk-a);outline-offset:2px}
  .bk select,.bk textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--bk-rand);border-radius:10px;padding:10px 12px;font:inherit;font-size:.92rem;background:#fff;color:var(--bk-txt)}
  .bk textarea{resize:none;min-height:64px;margin-top:4px}
  .bk-fuss{padding:12px 20px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--bk-rand)}
  .bk-los{width:100%;display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--bk-a);color:var(--bk-auf);border:0;border-radius:12px;padding:15px 18px;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
  .bk-los.bk-unfertig{opacity:.6}
  .bk-meld{font-size:.82rem;color:#b3261e;min-height:1.1em;margin:0 0 8px}
  @media (prefers-reduced-motion:reduce){.bk-chip{transition:none}}`;

  function stilEinhaengen() {
    if (document.getElementById('bk-stil')) return;
    const st = document.createElement('style');
    st.id = 'bk-stil';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ── Popup ────────────────────────────────────────────────────
  let zustand = null;

  function openBaukasten(quelle, fertig) {
    const num = typeof quelle === 'string' ? quelle : quelle?.dataset?.bk;
    const art = (window.BAUKASTEN || {})[num];
    if (!art) { console.error('Baukasten: keine Konfiguration fuer', num); return; }
    stilEinhaengen();
    schliessen();

    const groessen = art.groessen ? Object.keys(art.groessen) : [];
    zustand = {
      num, art, fertig: fertig || inWarenkorb,
      groesse: groessen[0] || null,
      wahl: art.schritte.map(() => []),
      menue: false, getraenk: '',
    };

    const ov = document.createElement('div');
    ov.className = 'bk-ov';
    ov.id = 'bk-popup';
    ov.addEventListener('click', e => { if (e.target === ov) schliessen(); });
    ov.innerHTML = `<div class="bk" role="dialog" aria-modal="true" aria-labelledby="bk-titel"
        ${art.farbe ? `style="--bk-a:${esc(art.farbe)}"` : ''}>
      <div class="bk-kopf">
        <h2 id="bk-titel">${esc(art.name)}</h2>
        <p>Stell dir deine${art.name.endsWith('Wrap') ? 'n' : ''} ${esc(art.name)} zusammen.</p>
        <button class="bk-zu" type="button" aria-label="Schließen">&times;</button>
      </div>
      <div class="bk-rumpf">${rumpfHtml()}</div>
      <div class="bk-fuss">
        <p class="bk-meld" aria-live="polite"></p>
        <button class="bk-los" type="button"><span>Hinzufügen</span><span class="bk-summe"></span></button>
      </div>
    </div>`;
    document.body.appendChild(ov);

    ov.querySelector('.bk-zu').onclick = schliessen;
    ov.querySelector('.bk-los').onclick = bestaetigen;
    ov.querySelectorAll('.bk-chip').forEach(b => b.onclick = () => waehle(b));
    const sel = ov.querySelector('#bk-getraenk');
    if (sel) sel.onchange = () => { zustand.getraenk = sel.value; zustand.menue = !!sel.value; aktualisieren(); };
    document.addEventListener('keydown', escTaste);
    aktualisieren();
    ov.querySelector('.bk-chip:not(:disabled)')?.focus({ preventScroll: true });
  }

  function rumpfHtml() {
    const { art } = zustand;
    const aus = ausverkauft();
    const chip = (si, o) => {
      const weg = aus.includes(o.name);
      const zu = o.zuschlag ? `<small>+${eur(o.zuschlag)}</small>` : '';
      return `<button type="button" class="bk-chip" data-s="${si}" data-o="${esc(o.name)}"
        aria-pressed="false" ${weg ? 'disabled title="ausverkauft"' : ''}>${esc(o.name)}${weg ? ' <small>aus</small>' : zu}</button>`;
    };

    let html = '';
    let nr = 1;
    if (art.groessen) {
      html += `<div class="bk-schritt" data-g="1"><div class="bk-st"><span class="bk-nr">${nr++}</span><h3>Größe</h3><span class="bk-regel">bitte eine wählen</span></div><div class="bk-chips">` +
        Object.entries(art.groessen).map(([g, p]) =>
          `<button type="button" class="bk-chip" data-g="${esc(g)}" aria-pressed="false">${esc(g)} <small>${eur(p)}</small></button>`).join('') +
        `</div></div>`;
    }
    art.schritte.forEach((s, si) => {
      html += `<div class="bk-schritt" data-schritt="${si}"><div class="bk-st"><span class="bk-nr">${nr++}</span><h3>${esc(s.titel)}</h3><span class="bk-regel">${esc(regel(s))}</span><span class="bk-zahl"></span></div>`;
      if (s.gruppen) {
        const opt = optionen(s);
        s.gruppen.forEach(g => {
          html += `<div class="bk-gruppe">${esc(g.titel)}${g.zuschlag ? ' · +' + eur(g.zuschlag) : ''}</div><div class="bk-chips">` +
            opt.filter(o => o.gruppe === g.titel).map(o => chip(si, { ...o, zuschlag: 0 })).join('') + `</div>`;
        });
      } else {
        html += `<div class="bk-chips">${optionen(s).map(o => chip(si, o)).join('')}</div>`;
      }
      html += `</div>`;
    });
    if (art.menue) {
      html += `<div class="bk-schritt"><div class="bk-st"><span class="bk-nr">${nr++}</span><h3>Als Menü</h3><span class="bk-regel">mit Getränk nach Wahl, +${eur(art.menue.aufpreis)}</span></div>
        <select id="bk-getraenk" aria-label="Getränk zum Menü"><option value="">Kein Menü</option>` +
        art.menue.getraenke.map(g => `<option ${aus.includes(g) ? 'disabled' : ''}>${esc(g)}</option>`).join('') +
        `</select></div>`;
    }
    html += `<div class="bk-schritt"><label for="bk-notiz" class="bk-regel">Anmerkung (optional)</label>
      <textarea id="bk-notiz" maxlength="150" placeholder="z. B. Sauce extra, ohne Zwiebeln"></textarea></div>`;
    return html;
  }

  function waehle(btn) {
    const ov = document.getElementById('bk-popup');
    if (btn.dataset.g) {
      zustand.groesse = btn.dataset.g;
      return aktualisieren();
    }
    const si = +btn.dataset.s, name = btn.dataset.o;
    const s = zustand.art.schritte[si];
    const liste = zustand.wahl[si];
    const i = liste.indexOf(name);
    if (i >= 0) liste.splice(i, 1);
    else if (s.max === 1) { liste.length = 0; liste.push(name); }
    else if (s.max && liste.length >= s.max) {
      ov.querySelector('.bk-meld').textContent = `Bei „${s.titel}“ höchstens ${s.max}.`;
      return;
    } else liste.push(name);
    aktualisieren();
  }

  function preis() {
    const { art } = zustand;
    let p = art.groessen ? art.groessen[zustand.groesse] : art.preis;
    art.schritte.forEach((s, si) => p += schrittPreis(s, zustand.wahl[si]));
    if (zustand.menue) p += art.menue.aufpreis;
    return Math.round(p * 100) / 100;
  }

  function fehlend() {
    return zustand.art.schritte
      .map((s, si) => ((s.min || 0) > zustand.wahl[si].length ? si : -1))
      .filter(si => si >= 0);
  }

  function aktualisieren() {
    const ov = document.getElementById('bk-popup');
    if (!ov) return;
    ov.querySelectorAll('.bk-chip[data-g]').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.g === zustand.groesse)));
    ov.querySelectorAll('.bk-chip[data-s]').forEach(b =>
      b.setAttribute('aria-pressed', String(zustand.wahl[+b.dataset.s].includes(b.dataset.o))));
    zustand.art.schritte.forEach((s, si) => {
      const n = zustand.wahl[si].length;
      const extra = schrittPreis(s, zustand.wahl[si]);
      const z = ov.querySelector(`[data-schritt="${si}"] .bk-zahl`);
      if (z) z.textContent = n ? `${n} gewählt${extra ? ' · +' + eur(extra) : ''}` : '';
    });
    const offen = fehlend();
    ov.querySelectorAll('[data-schritt]').forEach(el =>
      el.classList.toggle('bk-fehlt', offen.includes(+el.dataset.schritt) && el.dataset.versucht === '1'));
    ov.querySelector('.bk-summe').textContent = eur(preis());
    // Bewusst nicht disabled: Der Klick erklaert, welcher Schritt noch fehlt.
    ov.querySelector('.bk-los').classList.toggle('bk-unfertig', offen.length > 0);
    if (!offen.length) ov.querySelector('.bk-meld').textContent = '';
  }

  function bestaetigen() {
    const ov = document.getElementById('bk-popup');
    const offen = fehlend();
    if (offen.length) {
      offen.forEach(si => ov.querySelector(`[data-schritt="${si}"]`).dataset.versucht = '1');
      const s = zustand.art.schritte[offen[0]];
      ov.querySelector('.bk-meld').textContent = `Bitte noch „${s.titel}“ wählen.`;
      ov.querySelector(`[data-schritt="${offen[0]}"]`).scrollIntoView({ block: 'center', behavior: 'smooth' });
      aktualisieren();
      return;
    }
    const { art } = zustand;
    const name = art.name + (zustand.groesse ? ' ' + zustand.groesse : '') + (zustand.menue ? ' (Menü)' : '');
    const extraDetails = [];
    art.schritte.forEach((s, si) => {
      const w = zustand.wahl[si];
      if (w.length) extraDetails.push({ name: `${s.titel}: ${w.join(', ')}`, price: schrittPreis(s, w) });
    });
    if (zustand.menue) extraDetails.push({ name: `Getränk: ${zustand.getraenk}`, price: art.menue.aufpreis });
    const note = (ov.querySelector('#bk-notiz')?.value || '').trim();
    const fertig = zustand.fertig;
    const p = preis();
    schliessen();
    fertig(name, p, extraDetails, note);
  }

  function escTaste(e) { if (e.key === 'Escape') schliessen(); }

  function schliessen() {
    document.getElementById('bk-popup')?.remove();
    document.removeEventListener('keydown', escTaste);
  }

  // Webseite: in denselben Warenkorb wie jedes andere Popup.
  function inWarenkorb(name, preis, extraDetails, note) {
    const key = extraDetails.map(e => e.name).join(',');
    const da = warenkorb.find(i => i.name === name && (i.extraDetails || []).map(e => e.name).join(',') === key
                                 && (i.note || '') === note && !i.isFree);
    if (da) { da.qty = (da.qty || 1) + 1; da.preis = preis * da.qty; }
    else warenkorb.push({ id: Date.now(), name, preis, basePreis: preis, qty: 1, extraDetails, note });
    if (typeof addFreePizzaIfNeeded === 'function') addFreePizzaIfNeeded();
    renderWarenkorb();
  }

  window.openBaukasten = openBaukasten;
  window.closeBaukasten = schliessen;
})();
