// shared/data.js — data-access facade. Τοπικό mode (χωρίς Supabase credentials στο config.js)
// χρησιμοποιεί το localStorage (data.local.js), αλλιώς όλα πάνε στο Supabase (data.supabase.js).
// Η υλοποίηση επιλέγεται μία φορά στο module load (top-level await).
import { CONFIG } from './config.js';

const impl = CONFIG.backend === 'supabase' ? await import('./data.supabase.js') : await import('./data.local.js');

export const BACKEND = CONFIG.backend;
export const loadAll = (...a) => impl.loadAll(...a);
export const create = (...a) => impl.create(...a);
export const update = (...a) => impl.update(...a);
export const remove = (...a) => impl.remove(...a);
export const upsertLeads = (...a) => impl.upsertLeads(...a);
