/* Meta Pixel. Paste your Pixel ID below; until then nothing loads. */
(() => {
  const PIXEL_ID = '1959039078120264'; // e.g. 123456789012345

  window.astraPixel = () => {};
  // Same rule as funnel.js: no pixel on your own visits (?me=1) or on local copies
  let internal = /^(file:|)$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  try { internal = internal || localStorage.getItem('astra_internal') === '1' || new URLSearchParams(location.search).get('me') === '1'; } catch (e) {}
  if (!PIXEL_ID || internal) return;

  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');

  window.astraPixel = (event, params, eventID) => fbq('track', event, params || {}, eventID ? { eventID } : undefined);
})();
