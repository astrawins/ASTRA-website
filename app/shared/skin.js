/* Δοκιμαστικά designs: ?skin=a|b|c|d (μένει στον browser) · ?skin=0 = το κανονικό · d = a + Liquid Glass */
(function () {
  try {
    var q = new URLSearchParams(location.search).get('skin');
    if (q !== null) { if (/^[abcd]$/.test(q)) localStorage.setItem('astra-skin', q); else localStorage.removeItem('astra-skin'); }
    var s = localStorage.getItem('astra-skin');
    if (s === 'd') {
      document.documentElement.setAttribute('data-skin', 'a');
      document.documentElement.setAttribute('data-glass', '');
      document.write('<link rel="stylesheet" href="/app/shared/skins/a.css"><link rel="stylesheet" href="/app/shared/skins/d.css">');
    } else if (/^[abc]$/.test(s)) {
      document.documentElement.setAttribute('data-skin', s);
      document.write('<link rel="stylesheet" href="/app/shared/skins/' + s + '.css">');
    }
  } catch (e) { /* storage blocked */ }
})();
