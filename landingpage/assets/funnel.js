/* astra lead tracking
   Sends the form answers and the Calendly booking to the Google Apps Script web app,
   which builds the Leads tab. Paste your web-app URL below. */
(() => {
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbwSIgmmwuxX7ZgElldaDcWAhEfmsZsCE3kShe1XJboo6e-TmsXNlrDoVdbVARYEKdUOIw/exec'; // e.g. https://script.google.com/macros/s/XXXX/exec

  const store = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const qs = new URLSearchParams(location.search);

  // Your own visits are never counted: open the page once with ?me=1 on each browser/phone you use
  // (?me=0 undoes it). Local copies (file://, localhost) are always skipped.
  const flag = qs.get('me');
  try {
    if (flag === '1') localStorage.setItem('astra_internal', '1');
    if (flag === '0') localStorage.removeItem('astra_internal');
  } catch (e) {}
  let internal = /^(file:|)$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  try { internal = internal || localStorage.getItem('astra_internal') === '1'; } catch (e) {}
  window.astraInternal = internal;

  let sid = qs.get('sid') || store.get('astra_sid', null);
  // Internal sessions carry an "internal-" prefix into Calendly, so the sheet skips those bookings too
  if (internal && sid && !sid.startsWith('internal-')) sid = null;
  if (!sid) sid = (internal ? 'internal-' : '') + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  store.set('astra_sid', sid);

  // Keep the ad source for the whole visit
  const utm = store.get('astra_utm', {});
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'].forEach(k => { if (qs.get(k)) utm[k] = qs.get(k); });
  store.set('astra_utm', utm);

  const device = matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';

  function send(payload) {
    const body = JSON.stringify({ sid, device, referrer: document.referrer, page: location.pathname, ...utm, ...payload });
    if (!ENDPOINT || internal) { console.info('[funnel] not sent' + (internal ? ' (your own visit)' : ''), body); return; }
    // text/plain avoids a CORS preflight, which Apps Script cannot answer
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob))) {
      fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }).catch(() => {});
    }
  }

  const sent = new Set(store.get('astra_sent', []));
  window.Funnel = {
    sid,
    internal,
    // Page steps are kept in the browser only (nothing is sent), so the page can call them freely
    track(stage) { if (!sent.has(stage)) { sent.add(stage); store.set('astra_sent', [...sent]); } },
    metric() {},
    // Form answers: stored until the person books
    lead(data) { send({ event: 'lead', ...data }); },
    // Calendly booking: the sheet fetches name, email, phone and answers from Calendly
    booked(data) { send({ event: 'booked', ...data }); },
  };
})();
