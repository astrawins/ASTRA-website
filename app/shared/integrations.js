// shared/integrations.js — προαιρετικές εξωτερικές συνδέσεις: Meta Graph API.
// Και οι δύο είναι αδρανείς μέχρι να μπουν tokens στις Ρυθμίσεις.

/* Τραβάει spend/impressions/clicks ανά καμπάνια για τον τρέχοντα μήνα.
   token: Meta access token με ads_read, account: 'act_XXXXXXXX'. */
export async function metaInsights(token, account, since) {
  const acc = account.startsWith('act_') ? account : 'act_' + account;
  // since (YYYY-MM-DD, μέσα στον τρέχοντα μήνα): μόνο από εκείνη τη μέρα ως σήμερα· αλλιώς όλος ο μήνας
  const d = new Date(); const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const range = since ? `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` : 'date_preset=this_month';
  const url = `https://graph.facebook.com/v21.0/${acc}/insights?level=campaign&fields=campaign_name,spend,impressions,clicks&${range}&limit=200&access_token=${encodeURIComponent(token)}`;
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
