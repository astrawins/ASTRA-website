/* Design του Astra HQ: προεπιλογή «d» = Χαρτί + Liquid Glass (από 9/11/2026).
   Δοκιμή άλλου: ?skin=a|b|c|d (μένει στον browser) · ?skin=0 = το παλιό design · ?skin=default = επιστροφή στην προεπιλογή */
(function () {
  try {
    var q = new URLSearchParams(location.search).get('skin');
    if (q !== null) {
      if (/^[abcd0]$/.test(q)) localStorage.setItem('astra-skin', q); else localStorage.removeItem('astra-skin');
    }
  } catch (e) { /* storage blocked */ }
  var s = 'd';
  try { s = localStorage.getItem('astra-skin') || 'd'; } catch (e) { /* storage blocked */ }
  var h = document.documentElement;
  if (s === 'd') {
    h.setAttribute('data-skin', 'a'); h.setAttribute('data-glass', '');
    document.write('<link rel="stylesheet" href="/app/shared/skins/a.css"><link rel="stylesheet" href="/app/shared/skins/d.css">');
  } else if (/^[abc]$/.test(s)) {
    h.setAttribute('data-skin', s);
    document.write('<link rel="stylesheet" href="/app/shared/skins/' + s + '.css">');
  }
})();
