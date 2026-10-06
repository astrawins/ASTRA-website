/* Meta Pixel — φορτώνει ΜΟΝΟ μετά από συγκατάθεση (GDPR/ePrivacy). Όχι στις δικές μας επισκέψεις (?me=1) ή σε τοπικά αντίγραφα. */
(() => {
  const PIXEL_ID = '1959039078120264';
  const KEY = 'astra_consent'; // 'yes' | 'no'
  window.astraPixel = () => {};
  let internal = /^(file:|)$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  try { internal = internal || localStorage.getItem('astra_internal') === '1' || new URLSearchParams(location.search).get('me') === '1'; } catch (e) {}
  if (!PIXEL_ID || internal) return;

  function loadPixel() {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
    window.astraPixel = (event, params, eventID) => fbq('track', event, params || {}, eventID ? { eventID } : undefined);
  }

  let choice = null;
  try { if (new URLSearchParams(location.search).get('cookies') === 'reset') localStorage.removeItem(KEY); choice = localStorage.getItem(KEY); } catch (e) {}
  if (choice === 'yes') { loadPixel(); return; }
  if (choice === 'no') return;

  /* Banner συγκατάθεσης: ίδια επιλογή για «Απόρριψη» και κλείσιμο — μόνο η ρητή αποδοχή φορτώνει το pixel. */
  const el = document.createElement('div');
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Cookies');
  el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;background:#2A2118;color:#F2E9DA;border-radius:14px;padding:16px 18px;font:14px/1.5 Archivo,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35)';
  el.innerHTML = '<div style="margin-bottom:12px">Χρησιμοποιούμε cookies του Meta Pixel για να μετράμε την απόδοση των διαφημίσεών μας. Είναι προαιρετικά. <a href="/el/aporrito/" style="color:#EDDBC4">Πολιτική απορρήτου</a></div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-c="yes" style="background:#EDDBC4;color:#2A2118;border:0;border-radius:999px;padding:10px 18px;font-weight:600;cursor:pointer">Αποδοχή</button>'
    + '<button type="button" data-c="no" style="background:transparent;color:#F2E9DA;border:1px solid rgba(242,233,218,.4);border-radius:999px;padding:10px 18px;cursor:pointer">Απόρριψη</button></div>';
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]'); if (!b) return;
    try { localStorage.setItem(KEY, b.dataset.c); } catch (err) {}
    el.remove();
    if (b.dataset.c === 'yes') loadPixel();
  });
  const mount = () => document.body.appendChild(el);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
