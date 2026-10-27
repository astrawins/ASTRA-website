// nozoom.js — Κλείδωμα zoom (ζήτηση χρήστη) + σταθερότητα της κάτω μπάρας στο iPhone.
// Εξωτερικό αρχείο (όχι inline) ώστε να περνά το Content-Security-Policy (script-src 'self').
(function () {
  // 1) Pinch-zoom: μπλοκάρεται. Το double-tap zoom το κόβει το CSS (touch-action: manipulation) —
  //    ΟΧΙ preventDefault στο touchend, γιατί έτρωγε τα γρήγορα διαδοχικά πατήματα («κολλούσε» το app).
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function (e) { if (e.scale !== undefined && e.scale !== 1) e.preventDefault(); }, { passive: false });

  // 2) Πληκτρολόγιο / επιστροφή από άλλη εφαρμογή (SMS, Viber, Gmail): το iOS αφήνει πότε-πότε τη σελίδα
  //    μετατοπισμένη και τα fixed στοιχεία (κάτω μπάρα) «κολλημένα» ψηλά. Κρύβουμε τη μπάρα όσο είναι ανοιχτό το
  //    πληκτρολόγιο και «ξυπνάμε» το layout όταν κλείνει ή όταν επιστρέφουμε στο app.
  var root = document.documentElement, vv = window.visualViewport;
  function nudge() {
    var y = window.scrollY;
    window.scrollTo(window.scrollX, y + 1); window.scrollTo(window.scrollX, y);
    root.style.transform = 'translateZ(0)'; requestAnimationFrame(function () { root.style.transform = ''; });
  }
  function kbdCheck() {
    if (!vv) return;
    var open = vv.height < window.innerHeight * 0.78 && /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
    var was = root.classList.contains('kbd');
    root.classList.toggle('kbd', open);
    if (was && !open) setTimeout(nudge, 60);
  }
  if (vv) { vv.addEventListener('resize', kbdCheck); vv.addEventListener('scroll', function () { if (!root.classList.contains('kbd') && vv.offsetTop > 0) nudge(); }); }
  document.addEventListener('focusout', function () { setTimeout(function () { kbdCheck(); if (!/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { root.classList.remove('kbd'); nudge(); } }, 120); });
  function back() { root.classList.remove('kbd'); setTimeout(nudge, 80); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') back(); });
  window.addEventListener('pageshow', back);
  window.addEventListener('orientationchange', function () { setTimeout(nudge, 300); });
})();
