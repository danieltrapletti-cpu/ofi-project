// netlify/functions/deliverNecrologioToCitizen.js
import admin from "firebase-admin";
import crypto from "crypto";


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
  if (!v) throw new Error(`Missing env: ${labelForError || names[0]} (tried: ${names.join(", ")})`);
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
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Missing Authorization Bearer token");
  return await admin.auth().verifyIdToken(token);
}

function safeEmail(s) {
  return String(s || "").trim().toLowerCase();
}

/** ElasticEmail V2 send (HTML + TEXT fallback) */
async function sendEmailElastic({ to, subject, html, text }) {
  const API_KEY = requireAnyEnv(
    ["ELASTICEMAIL_API_KEY", "ELASTICEMAIL_KEY", "ELASTICEMAIL_APIKEY"],
    "ELASTICEMAIL_API_KEY"
  );
  const FROM = requireAnyEnv(
    ["ELASTICEMAIL_FROM", "EE_FROM_EMAIL", "FROM_EMAIL"],
    "ELASTICEMAIL_FROM/EE_FROM_EMAIL"
  );
  const FROM_NAME = pickEnv(["ELASTICEMAIL_FROM_NAME", "EE_FROM_NAME", "SITE_BRAND"]) || "OFI";

  const params = new URLSearchParams();
  params.set("apikey", API_KEY);
  params.set("from", FROM);
  params.set("fromName", FROM_NAME);
  params.set("to", to);
  params.set("subject", subject);
  params.set("bodyHtml", html);
  if (text) params.set("bodyText", text);

  const r = await fetch("https://api.elasticemail.com/v2/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) {
    const msg = data?.error || data?.Error || "ElasticEmail send failed";
    throw new Error(msg);
  }
  return data;
}

/** Email template (professionale + istituzionale) */
function renderMail({ acceptUrl, baseUrl, expiresAtMs }) {
  const brandName = pickEnv(["SITE_BRAND", "BRAND_NAME"]) || "OFI — Onoranze Funebri Italia";

  const expires = expiresAtMs ? new Date(expiresAtMs) : null;
  const expiresStr = expires
    ? expires.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })
    : "entro 14 giorni";

  const preheader = "Un’impresa ti ha inviato un necrologio da custodire nella tua area personale OFI.";

  const text = [
    `${brandName}`,
    ``,
    `Hai una consegna in attesa.`,
    `Un’impresa ti ha inviato un necrologio da custodire nella tua area personale su OFI.`,
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
  <title>Consegna in attesa</title>
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
                Hai una consegna in attesa
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;opacity:.92;line-height:1.45;margin-top:6px;">
                Un’impresa ti ha inviato un necrologio da custodire nella tua area personale.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 20px 6px 20px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;">
                Per completare l’operazione, accetta la consegna tramite il pulsante qui sotto.
              </div>

              <div style="margin-top:14px;padding:14px 14px;border-radius:14px;background:#f7f9ff;border:1px solid #e7ecf7;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#334155;line-height:1.45;">
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
                Hai ricevuto questa email perché un’impresa ha avviato una consegna verso la tua area OFI.<br>
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
    const necrologioId = String(body.necrologioId || "").trim();
    const citizenEmail = safeEmail(body.citizenEmail);
    const type = String(body.type || "necrologio").trim();

    if (!necrologioId) return json(400, { ok: false, error: "necrologioId mancante" });
    if (!citizenEmail || !citizenEmail.includes("@")) return json(400, { ok: false, error: "Email non valida" });

    const db = admin.firestore();

    // 0) anti-doppione: se già accepted → stop
    const acceptedSnap = await db
      .collection("consegne_necrologi")
      .where("necrologioId", "==", necrologioId)
      .where("status", "==", "accepted")
      .limit(1)
      .get();

    if (!acceptedSnap.empty) {
      const d = acceptedSnap.docs[0].data() || {};
      return json(409, {
        ok: false,
        error: "Questo necrologio è già stato consegnato e accettato. Non è possibile inviarlo di nuovo.",
        status: "accepted",
        citizenEmail: d.citizenEmail || null,
        acceptedAt: d.acceptedAt?.toDate?.()?.getTime?.() || null,
      });
    }

    // 1) citizenUid se email registrata
    let citizenUid = null;
    try {
      const u = await admin.auth().getUserByEmail(citizenEmail);
      citizenUid = u?.uid || null;
    } catch {
      citizenUid = null;
    }

    const createdByUid = decoded.uid;

    const baseUrl =
      pickEnv(["FRONTEND_BASE_URL", "PUBLIC_BASE_URL", "DASHBOARD_URL"]) || "https://www.italiaofi.it";

    const subject = "OFI — Hai ricevuto un necrologio (consegna in attesa)";

    // 2) se esiste già pending per stesso necrologio + stessa impresa + stessa email
    const pendingList = await db
      .collection("consegne_necrologi")
      .where("necrologioId", "==", necrologioId)
      .where("createdByUid", "==", createdByUid)
      .limit(25)
      .get();

    const nowMs = Date.now();
    let pendingDoc = null;

    pendingList.forEach((doc) => {
      const d = doc.data() || {};
      const sameEmail = String(d.citizenEmail || "").toLowerCase() === citizenEmail;
      if (d.status === "pending" && sameEmail) pendingDoc = { id: doc.id, ref: doc.ref, data: d };
    });

    // 2a) se pending esiste ma è scaduta → marchia expired e NON la riuso
    if (pendingDoc) {
      const expMs = pendingDoc.data.expiresAt?.toDate?.()?.getTime?.() || 0;
      if (expMs && expMs < nowMs) {
        await pendingDoc.ref.update({
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        pendingDoc = null;
      }
    }

    // 2b) REUSE pending valida
    if (pendingDoc) {
      let token = String(pendingDoc.data.token || "").trim();
      if (!token) {
        token = crypto.randomBytes(32).toString("hex");
        await pendingDoc.ref.update({ token });
      }

      const acceptUrl = `${baseUrl}/cittadini/necrologi-miei.html?accept=${token}`;
      const expMs = pendingDoc.data.expiresAt?.toDate?.()?.getTime?.() || 0;

      const { html, text } = renderMail({ acceptUrl, baseUrl, expiresAtMs: expMs });

      const elasticResp = await sendEmailElastic({
        to: citizenEmail,
        subject,
        html,
        text,
      });

      await pendingDoc.ref.update({
        lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
        sendCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return json(200, {
        ok: true,
        emailSent: true,
        reused: true,
        deliveryId: pendingDoc.id,
        status: "pending",
        citizenRegistered: !!citizenUid,
        acceptUrl,
        citizenEmail,
        elastic: { success: elasticResp?.success ?? true },
      });
    }

    // 3) nuova consegna (14 giorni da ORA)
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAtMs = nowMs + 14 * 24 * 60 * 60 * 1000;

    const deliveryRef = db.collection("consegne_necrologi").doc();
    const deliveryId = deliveryRef.id;

    await deliveryRef.set({
      deliveryId,
      token,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
      sendCount: 1,
      expiresAt: new Date(expiresAtMs),
      necrologioId,
      type,
      citizenEmail,
      citizenUid: citizenUid || null,

      createdByUid,
      createdByEmail: decoded.email || null,
      createdBy: { uid: decoded.uid, email: decoded.email || null },
    });

    const acceptUrl = `${baseUrl}/cittadini/necrologi-miei.html?accept=${token}`;
    const { html, text } = renderMail({ acceptUrl, baseUrl, expiresAtMs });

    const elasticResp = await sendEmailElastic({
      to: citizenEmail,
      subject,
      html,
      text,
    });

    return json(200, {
      ok: true,
      emailSent: true,
      deliveryId,
      status: "pending",
      expiresAt: expiresAtMs,
      citizenRegistered: !!citizenUid,
      acceptUrl,
      citizenEmail,
      elastic: { success: elasticResp?.success ?? true },
    });
  } catch (e) {
    console.error("deliverNecrologioToCitizen error", e);
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
