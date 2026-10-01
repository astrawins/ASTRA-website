// shared/data.supabase.js — backend Supabase μέσω PostgREST. Στήλες snake_case στη βάση,
// camelCase στην εφαρμογή· η μετατροπή γίνεται γενικά εδώ.
import { rest } from './supabase.js';

const toSnake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const toCamel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowOut = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [toCamel(k), v]));
const rowIn = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [toSnake(k), v]));

const QUERY = {
  clinics: 'clinics?select=*&order=created_at.asc',
  leads: 'leads?select=*&order=created_time.desc',
  campaigns: 'campaigns?select=*&order=month.desc',
  finance: 'finance?select=*&order=date.desc',
  recurring: 'recurring?select=*&order=created_at.asc',
  activity: 'activity?select=*&order=at.desc&limit=800',
  settings: 'settings?select=*',
  tasks: 'tasks?select=*&order=date.desc&limit=500',
  creatives: 'creatives?select=*&order=created_at.asc',
  monthly_stats: 'monthly_stats?select=*&order=month.desc&limit=600',
  trash: 'trash?select=*&order=deleted_at.desc&limit=200',
  accountant: 'accountant?select=*&order=id.desc&limit=36',
  client_log: 'client_log?select=*&order=at.desc&limit=500',
  billing: 'billing?select=*&order=month.desc&limit=200',
  subscriptions: 'subscriptions?select=*&order=renew_date.asc',
};

export async function loadAll() {
  const keys = Object.keys(QUERY);
  const res = await Promise.all(keys.map((k) => rest(QUERY[k])));
  return Object.fromEntries(keys.map((k, i) => [k, res[i].map(rowOut)]));
}

export async function create(coll, data, id) {
  const body = rowIn(id ? { id, ...data } : data);
  const rows = await rest(coll, { method: 'POST', body });
  return rowOut(rows[0]);
}

export async function update(coll, id, patch) {
  const rows = await rest(`${coll}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: rowIn(patch) });
  return rows && rows[0] ? rowOut(rows[0]) : null;
}

export async function remove(coll, id) {
  await rest(`${coll}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

/* Εισάγει μόνο νέα leads (σύγκρουση στο id → αγνοείται). Επιστρέφει πόσα μπήκαν. */
export async function upsertLeads(rows) {
  if (!rows.length) return 0;
  const inserted = await rest('leads?on_conflict=id', {
    method: 'POST',
    body: rows.map(rowIn),
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  return inserted ? inserted.length : 0;
}
