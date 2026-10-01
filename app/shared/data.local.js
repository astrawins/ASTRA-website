// shared/data.local.js — τοπικό backend: όλα στο localStorage του browser.
// Ίδιο συμβόλαιο με το data.supabase.js, ώστε το facade να τα εναλλάσσει.
import { uid } from './util.js';

const KEY = 'astra_db';
const EMPTY = { clinics: [], leads: [], campaigns: [], finance: [], recurring: [], activity: [], settings: [], tasks: [], creatives: [], monthly_stats: [], trash: [], accountant: [], client_log: [], billing: [], subscriptions: [] };

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    return j && typeof j === 'object' ? { ...EMPTY, ...j } : { ...EMPTY };
  } catch { return { ...EMPTY }; }
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage blocked */ }
}

export async function loadAll() { return load(); }

export async function create(coll, data, id) {
  const db = load();
  const row = { id: id || uid(), ...data };
  db[coll] = db[coll].filter((r) => r.id !== row.id).concat([row]);
  save(db);
  return row;
}

export async function update(coll, id, patch) {
  const db = load();
  const row = db[coll].find((r) => r.id === id);
  if (!row) throw new Error('not-found');
  Object.assign(row, patch);
  save(db);
  return row;
}

export async function remove(coll, id) {
  const db = load();
  db[coll] = db[coll].filter((r) => r.id !== id);
  save(db);
}

/* Προσθέτει μόνο leads που δεν υπάρχουν ήδη (με βάση το id). Επιστρέφει πόσα μπήκαν. */
export async function upsertLeads(rows) {
  const db = load();
  const existing = new Set(db.leads.map((l) => l.id));
  let added = 0;
  for (const r of rows) {
    if (existing.has(r.id)) continue;
    db.leads.push(r); existing.add(r.id); added++;
  }
  save(db);
  return added;
}
