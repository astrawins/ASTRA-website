/* Δοκιμαστικά designs: ?skin=a|b|c (μένει στον browser) · ?skin=0 = το κανονικό */
(function () {
  try {
    var q = new URLSearchParams(location.search).get('skin');
    if (q !== null) { if (/^[abc]$/.test(q)) localStorage.setItem('astra-skin', q); else localStorage.removeItem('astra-skin'); }
    var s = localStorage.getItem('astra-skin');
    if (/^[abc]$/.test(s)) {
      document.documentElement.setAttribute('data-skin', s);
      document.write('<link rel="stylesheet" href="/app/shared/skins/' + s + '.css">');
    }
  } catch (e) { /* storage blocked */ }
})();
