/* Public pages: no context menu, copy/paste, selection, dragging or dev-tool shortcuts.
   Form fields stay fully usable. */
(function () {
  var isField = function (el) {
    return el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]');
  };
  var block = function (e) { if (!isField(e.target)) e.preventDefault(); };
  ['contextmenu', 'copy', 'cut', 'paste', 'selectstart', 'dragstart'].forEach(function (t) {
    document.addEventListener(t, block, true);
  });
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (
      k === 'f12' ||
      (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c' || k === 'k')) ||
      (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c' || k === 'u')) ||
      (mod && (k === 'u' || k === 's' || k === 'p')) ||
      (mod && !isField(e.target) && (k === 'c' || k === 'x' || k === 'v' || k === 'a'))
    ) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  var st = document.createElement('style');
  st.textContent = 'html{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
    'input,textarea,select,[contenteditable="true"]{-webkit-user-select:text;user-select:text}' +
    'img,svg{-webkit-user-drag:none;user-drag:none}';
  document.head.appendChild(st);
})();
