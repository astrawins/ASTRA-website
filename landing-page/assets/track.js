// Tracking for every page: Meta Pixel + the funnel log in the Google Sheet (tab "Events").
// Your own visits: open any page once with ?me=1 to stop counting them (?me=0 undoes it).
(function () {
  const store = {
    get(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} }
  };
  const qs = new URLSearchParams(location.search);
  if (qs.get('me') === '1') store.set('astra_me', '1');
  if (qs.get('me') === '0') { try { localStorage.removeItem('astra_me'); } catch (e) {} }
  const isMe = store.get('astra_me') === '1';

  // Visitor (kept across visits) and session (this tab) ids, for unique counts
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let visitor = store.get('astra_vid'); if (!visitor) { visitor = rid(); store.set('astra_vid', visitor); }
  let session = store.get('astra_sid', true); if (!session) { session = rid(); store.set('astra_sid', session, true); }

  // First-touch UTMs for this session, so the inner pages keep the campaign of the ad click
  const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  let utm = {}; try { utm = JSON.parse(store.get('astra_utm', true) || '{}'); } catch (e) {}
  if (UTM.some(k => qs.get(k)) || qs.get('fbclid')) {
    utm = {}; UTM.forEach(k => { if (qs.get(k)) utm[k] = qs.get(k); });
    if (qs.get('fbclid')) utm.fbclid = qs.get('fbclid');
    store.set('astra_utm', JSON.stringify(utm), true);
  }
  if (!store.get('astra_ref', true)) store.set('astra_ref', document.referrer || 'direct', true);

  const device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : (/iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'desktop');
  const page = (location.pathname.split('/').pop() || 'index.html').replace(/\?.*$/, '') || 'index.html';

  // Shared context, also added to the lead rows
  window.astraCtx = function () {
    return Object.assign({ visitor_id: visitor, session_id: session, device, referrer: store.get('astra_ref', true) || '' }, utm);
  };

  // Meta Pixel
  const id = window.CONFIG && CONFIG.pixelId;
  if (id && !isMe) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', id); fbq('track', 'PageView');
  }

  // One row per event in the Sheet. sendBeacon survives page changes (form submit → next page).
  function log(name, data) {
    const url = window.CONFIG && CONFIG.sheetUrl;
    if (!url || isMe) return;
    const row = Object.assign({ source: 'event', event: name, page, ts: new Date().toISOString() }, window.astraCtx(), data || {});
    const body = new URLSearchParams();
    Object.keys(row).forEach(k => { const v = row[k]; if (v !== undefined && v !== null && typeof v !== 'object') body.append(k, String(v)); });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, body)) return;
    } catch (e) {}
    fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, body }).catch(() => {});
  }

  // Standard Meta events go through fbq('track'), everything else through trackCustom.
  const STANDARD = { lead: 'Lead', schedule: 'Schedule', complete_registration: 'CompleteRegistration' };
  // data.meta === false → only the Sheet is logged, nothing is sent to the Pixel
  window.track = function (name, data) {
    if (isMe) return;
    data = Object.assign({}, data || {});
    const toMeta = data.meta !== false; delete data.meta;
    if (toMeta && window.fbq && name !== 'page_view') STANDARD[name] ? fbq('track', STANDARD[name], data) : fbq('trackCustom', name, data);
    if (window.dataLayer) dataLayer.push(Object.assign({ event: name }, data));
    log(name, data);
  };

  // Every page load counts as a view
  window.track('page_view');
})();
