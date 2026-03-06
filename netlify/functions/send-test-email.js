// netlify/functions/send-test-email.js
import { sendEmail, ok, bad, handleOptions } from './_email.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();

  try {
    // Accetto sia GET ?to=... che POST {to:"..."}
    const input = event.httpMethod === 'POST'
      ? JSON.parse(event.body || '{}')
      : Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));

    const to = input.to;
    if (!to) return bad({ message: 'Missing "to" parameter' }, 422);

    const brand = process.env.SITE_BRAND || 'Italia OFI';
    const subject = `Test invio email da ${brand}`;
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5">
        <h2 style="margin:0 0 12px">${brand} – Test Email</h2>
        <p>Se stai leggendo questa email, l'invio tramite Netlify Functions + Elastic Email funziona ✅</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
        <p style="font-size:12px;color:#777">Mittente: ${process.env.EE_FROM_EMAIL}</p>
      </div>
    `;

    const data = await sendEmail({ to, subject, html, text: `${brand} – Test OK` });
    return ok({ ok: true, to, data });
  } catch (e) {
    return bad({ message: e.message || String(e) }, 500);
  }
}
