// netlify/functions/resendDeliveryEmail.js
import admin from "firebase-admin";


const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function pickEnv(names) {
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (v) return v;
  }
  return "";
}
function requireAnyEnv(names, labelForError) {
  const v = pickEnv(names);
  if (!v) throw new Error(`Missing env: ${labelForError || names[0]}`);
  return v;
}

function initAdmin() {
  if (admin.apps.length) return;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const admin = require("./_firebaseAdmin");
  } else {
  const admin = require("./_firebaseAdmin");
}
}

async function verifyBearer(event) {
  const h = event.headers.authorization || event.headers.Authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) throw new Error("Missing Authorization Bearer token");
  return await admin.auth().verifyIdToken(t);
}

/** ElasticEmail V2 send (HTML + TEXT fallback) */
async function sendEmailElastic({ to, subject, html, text }) {
  const API_KEY = requireAnyEnv(["ELASTICEMAIL_API_KEY", "ELASTICEMAIL_KEY", "ELASTICEMAIL_APIKEY"], "ELASTICEMAIL_API_KEY");
  const FROM = requireAnyEnv(["ELASTICEMAIL_FROM", "EE_FROM_EMAIL", "FROM_EMAIL"], "ELASTICEMAIL_FROM/EE_FROM_EMAIL");
  const FROM_NAME = pickEnv(["ELASTICEMAIL_FROM_NAME", "EE_FROM_NAME", "SITE_BRAND"]) || "OFI";

  const params = new URLSearchParams();
  params.set("apikey", API_KEY);
  params.set("from", FROM);
  params.set("fromName", FROM_NAME);
  params.set("to", String(to || "").trim());
  params.set("subject", String(subject || "").trim());
  params.set("bodyHtml", String(html || ""));
  if (text) params.set("bodyText", String(text || ""));
  params.set("isTransactional", "true");

  const r = await fetch("https://api.elasticemail.com/v2/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) throw new Error(data?.error || data?.Error || "ElasticEmail send failed");
  return data;
}

/** Template email (professionale + istituzionale) — REINVIO */
function renderResendMail({ acceptUrl, baseUrl, expiresAtMs }) {
  const brandName = pickEnv(["SITE_BRAND", "BRAND_NAME"]) || "OFI — Onoranze Funebri Italia";
  const expires = expiresAtMs ? new Date(expiresAtMs) : null;
  const expiresStr = expires
    ? expires.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })
    : "entro 14 giorni";

  const preheader = "Ti ricordiamo che hai una consegna in attesa su OFI.";

  const text = [
    `${brandName}`,
    ``,
    `Promemoria: consegna in attesa`,
    `Ti reinviamo il link per accettare la consegna del necrologio nella tua area personale.`,
    ``,
    `Accetta la consegna entro: ${expiresStr}`,
    `Link: ${acceptUrl}`,
    ``,
    `Se non hai un account, potrai completare la registrazione prima di accettare.`,
    `FAQ/Assistenza: ${baseUrl}/faq.html`,
    ``,
    `${brandName}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Promemoria consegna in attesa</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${preheader}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6eaf2;">

          <tr>
            <td style="padding:18px 20px;background:linear-gradient(135deg,#0f2340,#12335a);color:#fff;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.92;">
                ${brandName}
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;line-height:1.25;margin-top:6px;">
                Promemoria: consegna in attesa
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;opacity:.92;line-height:1.45;margin-top:6px;">
                Ti reinviamo il link per completare l’accettazione.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 20px 6px 20px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;">
                Per confermare la consegna del necrologio nella tua area personale, utilizza il pulsante qui sotto.
              </div>

              <div style="margin-top:14px;padding:14px 14px;border-radius:14px;background:#f7f9ff;border:1px solid #e7ecf7;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#334155;line-height:1.55;">
                  <b>Validità:</b> fino a <b>${expiresStr}</b><br>
                  Se non hai un account, potrai completare la registrazione prima di accettare.
                </div>
              </div>

              <div style="margin:18px 0 8px 0;">
                <a href="${acceptUrl}"
                  style="display:inline-block;background:#caa03a;color:#0f2340;text-decoration:none;
                         font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:15px;
                         padding:12px 16px;border-radius:12px;border:1px solid #b58f31;">
                  Accetta consegna
                </a>
              </div>

              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#64748b;margin-top:10px;">
                Se il pulsante non funziona, copia e incolla questo link nel browser:<br>
                <a href="${acceptUrl}" style="color:#12335a;word-break:break-all;">${acceptUrl}</a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 20px 18px 20px;border-top:1px solid #eef2f7;background:#fbfcff;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#64748b;">
                Notifica automatica OFI – Consegna alla famiglia.<br>
                Assistenza e FAQ: <a href="${baseUrl}/faq.html" style="color:#12335a;">${baseUrl}/faq.html</a>
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;margin-top:10px;">
                © ${new Date().getFullYear()} ${brandName}
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text };
}

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Use POST" });

    initAdmin();
    const decoded = await verifyBearer(event);

    const body = JSON.parse(event.body || "{}");
    const deliveryId = String(body.deliveryId || "").trim();
    if (!deliveryId) return json(400, { ok: false, error: "deliveryId mancante" });

    const db = admin.firestore();
    const ref = db.collection("consegne_necrologi").doc(deliveryId);
    const snap = await ref.get();
    if (!snap.exists) return json(404, { ok: false, error: "Consegna non trovata" });

    const d = snap.data() || {};
    if (d.createdByUid !== decoded.uid) return json(403, { ok: false, error: "Non autorizzato" });
    if (d.status !== "pending") return json(400, { ok: false, error: "Puoi reinviare solo se la consegna è in attesa" });

    const expMs = d.expiresAt?.toDate?.()?.getTime?.() || 0;
    if (expMs && expMs < Date.now()) {
      await ref.update({
        status: "expired",
        expiredAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return json(400, { ok: false, error: "Questa consegna è scaduta. Invia una nuova consegna." });
    }

    const token = String(d.token || "").trim();
    if (!token) return json(400, { ok: false, error: "Token mancante: consegna non reinviabile" });

    const baseUrl = pickEnv(["FRONTEND_BASE_URL", "PUBLIC_BASE_URL", "DASHBOARD_URL"]) || "https://www.italiaofi.it";
    const acceptUrl = `${baseUrl}/cittadini/necrologi-miei.html?accept=${token}`;

    const subject = "OFI — Promemoria: consegna necrologio in attesa";

    const { html, text } = renderResendMail({ acceptUrl, baseUrl, expiresAtMs: expMs });

    const elasticResp = await sendEmailElastic({
      to: d.citizenEmail,
      subject,
      html,
      text,
    });

    await ref.update({
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
      sendCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return json(200, { ok: true, emailSent: true, elastic: { success: elasticResp?.success ?? true } });
  } catch (e) {
    console.error("resendDeliveryEmail error", e);
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
