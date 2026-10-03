// shared/integrations.js — προαιρετικές εξωτερικές συνδέσεις: Meta Graph API.
// Και οι δύο είναι αδρανείς μέχρι να μπουν tokens στις Ρυθμίσεις.

/* Τραβάει spend/impressions/clicks ανά καμπάνια για τον τρέχοντα μήνα.
   token: Meta access token με ads_read, account: 'act_XXXXXXXX'. */
export async function metaInsights(token, account) {
  const acc = account.startsWith('act_') ? account : 'act_' + account;
  const url = `https://graph.facebook.com/v21.0/${acc}/insights?level=campaign&fields=campaign_name,spend,impressions,clicks&date_preset=this_month&limit=200&access_token=${encodeURIComponent(token)}`;
  let r, j;
  try { r = await fetch(url); j = await r.json(); }
  catch { throw new Error('Δεν ήταν δυνατή η σύνδεση με το Meta Graph API.'); }
  if (j.error) throw new Error('Meta API: ' + (j.error.message || 'σφάλμα token/δικαιωμάτων'));
  return (j.data || []).map((d) => ({
    name: d.campaign_name || '',
    spend: parseFloat(d.spend || 0),
    impressions: parseInt(d.impressions || 0, 10),
    clicks: parseInt(d.clicks || 0, 10),
  }));
}
