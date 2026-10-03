// nozoom.js — Κλείδωμα zoom (ζήτηση χρήστη): pinch & double-tap απενεργοποιημένα — το iOS αγνοεί το user-scalable=no.
// Εξωτερικό αρχείο (όχι inline) ώστε να περνά το Content-Security-Policy (script-src 'self').
document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
document.addEventListener('gesturechange', function (e) { e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', function (e) { if (e.scale !== undefined && e.scale !== 1) e.preventDefault(); }, { passive: false });
var __lt = 0;
document.addEventListener('touchend', function (e) { var n = Date.now(); if (n - __lt < 300 && !e.target.closest('input,textarea,select')) e.preventDefault(); __lt = n; }, { passive: false });
