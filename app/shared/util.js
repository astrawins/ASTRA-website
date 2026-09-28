// shared/util.js — μορφοποίηση, σταθερές, μικρά UI helpers.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const eur = (n) => new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n || 0);
export const num = (n) => new Intl.NumberFormat('el-GR').format(n || 0);
export const parseNum = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, '')); return isNaN(n) ? 0 : n; };

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const monthKey = (d) => String(d || '').slice(0, 7);
export const nowMonth = () => new Date().toISOString().slice(0, 7);
export const GR_MONTHS = ['Ιαν', 'Φεβ', 'Μάρ', 'Απρ', 'Μάι', 'Ιούν', 'Ιούλ', 'Αύγ', 'Σεπ', 'Οκτ', 'Νοέ', 'Δεκ'];
export const mLabel = (k) => { const [y, m] = String(k).split('-'); return GR_MONTHS[+m - 1] + ' ’' + String(y).slice(2); };
export function lastMonths(n) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.toISOString().slice(0, 7)); }
  return out;
}

export const STATUS = { neo: 'Νέο', epik: 'Επικοινωνία', rv: 'Ραντεβού', show: 'Ήρθε', won: 'Πελάτης', lost: 'Χαμένο' };
export const CATS = {
  income: ['Αμοιβή διαχείρισης', 'Χρέωση ad spend', 'Setup fee', 'Δημιουργικό / Παραγωγή', 'Άλλο έσοδο'],
  expense: ['Διαφημιστική δαπάνη (Meta)', 'Διαφημιστική δαπάνη (Google)', 'Εργαλεία / Συνδρομές', 'Μισθοδοσία / Συνεργάτες', 'Λογιστής', 'Ενοίκιο / Λειτουργικά', 'Άλλο έξοδο'],
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let toastT = null;
export function toast(msg) {
  let t = document.querySelector('.toast'); if (t) t.remove();
  t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 4200);
}

export function quarterOf(dateStr) {
  const d = new Date(dateStr); if (isNaN(d)) return null;
  return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
}
export function inQuarter(dateStr, qk) { return quarterOf(dateStr) === qk; }

export function addDays(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Κατέβασμα CSV με BOM ώστε το Excel να διαβάζει σωστά τα ελληνικά. */
export function downloadCSV(filename, header, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
