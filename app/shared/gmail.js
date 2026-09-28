// shared/gmail.js — αποστολή email μέσω Gmail API με τη μόνιμη σύνδεση Google της ομάδας.
// Το email φεύγει από τον λογαριασμό Google που έκανε τη σύνδεση.
import { ensureToken } from './gcal.js';

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encHeader = (s) => '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';

export async function sendEmail(clientId, { to, subject, html }) {
  const token = await ensureToken(clientId);
  const mime = [
    'To: ' + to,
    'Subject: ' + encHeader(subject),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html))),
  ].join('\r\n');
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(mime) }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error('Το Gmail δεν έχει δοθεί — πάτα «Επανασύνδεση Google» στις Ρυθμίσεις (τσέκαρε και το Gmail).');
  if (!r.ok) throw new Error(j.error && j.error.message ? 'Gmail: ' + j.error.message : 'Η αποστολή email απέτυχε (' + r.status + ')');
  return j.id;
}

/* Το πρότυπο καλωσορίσματος πελάτη στο Client Portal — Astra branding. */
export function welcomeEmail({ clinicName, email, password, portalUrl }) {
  const subject = 'Astra Marketing — Πρόσβαση στα στατιστικά σας';
  const html = `<!DOCTYPE html><html lang="el"><body style="margin:0;padding:0;background:#EDDBC4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#221A12;border-radius:14px 14px 0 0;padding:22px 28px;">
      <span style="color:#FDFBF7;font-size:22px;font-weight:bold;letter-spacing:-0.5px;">astra</span>
      <span style="color:#BCAC90;font-size:11px;letter-spacing:3px;margin-left:8px;">CLIENT PORTAL</span>
    </div>
    <div style="background:#FDFBF7;border-radius:0 0 14px 14px;padding:30px 28px;color:#2A2118;">
      <p style="font-size:17px;font-weight:bold;margin:0 0 6px;">Καλωσήρθατε${clinicName ? ' — ' + clinicName : ''}!</p>
      <p style="font-size:14px;line-height:1.6;color:#5A4936;margin:0 0 22px;">
        Δημιουργήσαμε τον προσωπικό σας χώρο, όπου μπορείτε να παρακολουθείτε ζωντανά την πορεία
        της συνεργασίας μας: νέα ενδιαφερόμενα άτομα, ραντεβού, νέους ασθενείς και την απόδοση των καμπανιών σας.
      </p>
      <div style="background:#F4E9D4;border-radius:10px;padding:18px 20px;margin:0 0 22px;">
        <p style="margin:0 0 10px;font-size:12px;letter-spacing:1px;color:#8F5B1C;font-weight:bold;">ΣΤΟΙΧΕΙΑ ΣΥΝΔΕΣΗΣ</p>
        <p style="margin:0 0 6px;font-size:14px;">Σύνδεσμος: <a href="${portalUrl}" style="color:#6B4526;">${portalUrl}</a></p>
        <p style="margin:0 0 6px;font-size:14px;">Email: <b>${email}</b></p>
        <p style="margin:0;font-size:14px;">Κωδικός: <b style="font-family:monospace;font-size:15px;">${password}</b></p>
      </div>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:#6B4526;border-radius:99px;">
        <a href="${portalUrl}" style="display:inline-block;padding:12px 28px;color:#FDFBF7;font-size:14px;font-weight:bold;text-decoration:none;">Είσοδος στον χώρο σας</a>
      </td></tr></table>
      <p style="font-size:12.5px;line-height:1.6;color:#5A4936;margin:0;">
        Τα στοιχεία είναι προσωπικά — μη τα κοινοποιείτε. Με την πρώτη σύνδεση, αλλάξτε τον κωδικό σας από την καρτέλα «Λογαριασμός». Για οποιαδήποτε απορία, απαντήστε σε αυτό το email
        ή καλέστε μας. Με εκτίμηση,<br><b style="color:#2A2118;">Η ομάδα της Astra Marketing</b> · astramarketing.gr
      </p>
    </div>
  </div></body></html>`;
  return { subject, html };
}

/* Email μηνιαίας χρέωσης: ραντεβού × αμοιβή, με λίστα ονομάτων (απόδειξη). */
export function billingEmail({ clinicName, monthLabel, appts, fee, total, vat, gross, names, portalUrl }) {
  const subject = `Astra Marketing — Εκκαθάριση ${monthLabel}: ${appts} ραντεβού`;
  const rows = names.map((n, i) => `<tr><td style="padding:4px 10px;font-size:12.5px;color:#5A4936;">${i + 1}.</td><td style="padding:4px 10px;font-size:12.5px;">${n.name}</td><td style="padding:4px 10px;font-size:12.5px;color:#5A4936;">${n.date}</td></tr>`).join('');
  const html = `<!DOCTYPE html><html lang="el"><body style="margin:0;padding:0;background:#EDDBC4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#221A12;border-radius:14px 14px 0 0;padding:22px 28px;"><span style="color:#FDFBF7;font-size:22px;font-weight:bold;">astra</span><span style="color:#BCAC90;font-size:11px;letter-spacing:3px;margin-left:8px;">ΕΚΚΑΘΑΡΙΣΗ</span></div>
    <div style="background:#FDFBF7;border-radius:0 0 14px 14px;padding:30px 28px;color:#2A2118;">
      <p style="font-size:16px;font-weight:bold;margin:0 0 4px;">${clinicName} — ${monthLabel}</p>
      <p style="font-size:13.5px;color:#5A4936;margin:0 0 18px;">Συνοπτικά τα ραντεβού που κλείστηκαν μέσω των καμπανιών μας:</p>
      <div style="background:#F4E9D4;border-radius:10px;padding:16px 20px;margin:0 0 18px;">
        <p style="margin:0;font-size:15px;"><b>${appts} ραντεβού × ${fee}€ = ${total.toFixed(2)}€</b></p>
        <p style="margin:6px 0 0;font-size:13px;color:#5A4936;">ΦΠΑ 24%: ${vat.toFixed(2)}€ &nbsp;·&nbsp; Σύνολο: <b>${gross.toFixed(2)}€</b></p>
      </div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${rows}</table>
      <p style="font-size:12.5px;color:#5A4936;margin:0;">Αναλυτικά στοιχεία στον χώρο σας: <a href="${portalUrl}" style="color:#6B4526;">${portalUrl}</a><br>Με εκτίμηση, <b style="color:#2A2118;">Astra Marketing</b></p>
    </div></div></body></html>`;
  return { subject, html };
}

/* Email μηνιαίας αναφοράς προς τον γιατρό. */
export function reportEmail({ clinicName, monthLabel, s, fee, portalUrl }) {
  const subject = `Astra Marketing — Αναφορά ${monthLabel} · ${clinicName}`;
  const row = (a, b) => `<tr><td style="padding:7px 12px;font-size:13.5px;color:#5A4936;border-bottom:1px solid #EDE2CF;">${a}</td><td style="padding:7px 12px;font-size:14px;font-weight:bold;text-align:right;border-bottom:1px solid #EDE2CF;">${b}</td></tr>`;
  const html = `<!DOCTYPE html><html lang="el"><body style="margin:0;padding:0;background:#EDDBC4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#221A12;border-radius:14px 14px 0 0;padding:22px 28px;"><span style="color:#FDFBF7;font-size:22px;font-weight:bold;">astra</span><span style="color:#BCAC90;font-size:11px;letter-spacing:3px;margin-left:8px;">ΜΗΝΙΑΙΑ ΑΝΑΦΟΡΑ</span></div>
    <div style="background:#FDFBF7;border-radius:0 0 14px 14px;padding:30px 28px;color:#2A2118;">
      <p style="font-size:16px;font-weight:bold;margin:0 0 14px;">${clinicName} — ${monthLabel}</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        ${row('Νέα ενδιαφερόμενα άτομα', s.leads)}
        ${row('Πληρωμένα ραντεβού', s.rv)}
        ${row('Ήρθαν στο ιατρείο', s.shows)}
        ${row('Νέοι ασθενείς', s.sales)}
        ${row('Έσοδα από νέους ασθενείς', s.revenue.toFixed(0) + '€')}
        ${row('Διαφημιστική δαπάνη', s.spend.toFixed(0) + '€')}
        ${s.spend > 0 ? row('Απόδοση (ROAS)', s.roas.toFixed(2) + '×') : ''}
      </table>
      <table cellpadding="0" cellspacing="0"><tr><td style="background:#6B4526;border-radius:99px;">
        <a href="${portalUrl}" style="display:inline-block;padding:12px 26px;color:#FDFBF7;font-size:14px;font-weight:bold;text-decoration:none;">Δείτε αναλυτικά</a></td></tr></table>
      <p style="font-size:12.5px;color:#5A4936;margin:18px 0 0;">Με εκτίμηση, <b style="color:#2A2118;">Η ομάδα της Astra Marketing</b> · astramarketing.gr</p>
    </div></div></body></html>`;
  return { subject, html };
}
