// netlify/functions/acceptDelivery.js
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

function initAdmin() {
  if (admin.apps.length) return;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n") }),
    });
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

function toMs(ts) {
  try {
    if (!ts) return NaN;
    if (ts.toDate) return ts.toDate().getTime();
    const d = new Date(ts);
    return d.getTime();
  } catch {
    return NaN;
  }
}

/* ========= ElasticEmail helpers ========= */
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
  if (!r.ok || data?.success === false) {
    const msg = data?.error || data?.Error || "ElasticEmail send failed";
    throw new Error(msg);
  }
  return data;
}

/** Template email professionale: Impresa ← consegna accettata */
function renderImpresaAcceptedMail({ necrologioId, acceptedAtStr, dashboardUrl, baseUrl }) {
  const brandName = pickEnv(["SITE_BRAND", "BRAND_NAME"]) || "OFI — Onoranze Funebri Italia";
  const preheader = "La famiglia ha accettato la consegna del necrologio su OFI.";

  const text = [
    `${brandName}`,
    ``,
    `Consegna accettata ✅`,
    `La famiglia ha accettato la consegna del necrologio su OFI.`,
    ``,
    `Necrologio ID: ${necrologioId || "-"}`,
    `Accettato il: ${acceptedAtStr || "-"}`,
    `Dashboard: ${dashboardUrl}`,
    ``,
    `FAQ/Assistenza: ${baseUrl}/faq.html`,
    `${brandName}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Consegna accettata</title>
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
                Consegna accettata ✅
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;opacity:.92;line-height:1.45;margin-top:6px;">
                La famiglia ha confermato la consegna del necrologio.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 20px 6px 20px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;">
                La consegna è stata completata correttamente e il necrologio risulta ora disponibile nell’area personale del cittadino.
              </div>

              <div style="margin-top:14px;padding:14px 14px;border-radius:14px;background:#f7f9ff;border:1px solid #e7ecf7;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#334155;line-height:1.55;">
                  <b>Necrologio ID:</b> ${necrologioId || "-"}<br>
                  <b>Accettato il:</b> ${acceptedAtStr || "-"}
                </div>
              </div>

              <div style="margin:18px 0 8px 0;">
                <a href="${dashboardUrl}"
                  style="display:inline-block;background:#caa03a;color:#0f2340;text-decoration:none;
                         font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:15px;
                         padding:12px 16px;border-radius:12px;border:1px solid #b58f31;">
                  Apri in dashboard
                </a>
              </div>

              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#64748b;margin-top:10px;">
                Se il pulsante non funziona, copia e incolla questo link nel browser:<br>
                <a href="${dashboardUrl}" style="color:#12335a;word-break:break-all;">${dashboardUrl}</a>
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

/* ========= handler ========= */
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders(), body: "ok" };
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Metodo non consentito (usa POST)." });

  try {
    initAdmin();
    const decoded = await verifyBearer(event);
    const uid = decoded.uid;

    const body = JSON.parse(event.body || "{}");
    const token = String(body.token || "").trim();
    const deliveryIdFromClient = String(body.deliveryId || "").trim();

    if (!token && !deliveryIdFromClient) return json(400, { ok: false, error: "token o deliveryId mancante" });

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 1) Trova consegna
    let docSnap = null;

    if (deliveryIdFromClient) {
      const s = await db.collection("consegne_necrologi").doc(deliveryIdFromClient).get();
      if (s.exists) docSnap = s;
    }

    if (!docSnap && token) {
      const q = await db.collection("consegne_necrologi").where("token", "==", token).limit(1).get();
      if (!q.empty) docSnap = q.docs[0];
    }

    if (!docSnap) return json(404, { ok: false, error: "Consegna non trovata (link già usato o revocato)" });

    const deliveryId = docSnap.id;
    const d = docSnap.data() || {};
    const necrologioId = String(d.necrologioId || "").trim();
    if (!necrologioId) return json(500, { ok: false, error: "necrologioId mancante nel record consegna" });

    // 2) Scadenza
    const expiresAtMs = toMs(d.expiresAt);
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      if (d.status !== "expired") {
        await docSnap.ref.update({ status: "expired", expiredAt: now });
      }
      return json(400, { ok: false, error: "Consegna scaduta" });
    }

    // 3) Stati
    if (d.status === "accepted") {
      if (d.citizenUid && d.citizenUid !== uid) {
        return json(403, { ok: false, error: "Consegna già accettata da un altro utente" });
      }
      return json(200, { ok: true, deliveryId, necrologioId, alreadyAccepted: true });
    }
    if (d.status === "revoked") return json(400, { ok: false, error: "Consegna revocata" });
    if (d.status && d.status !== "pending") return json(400, { ok: false, error: "Consegna non in attesa" });

    // 4) Scrittura atomica
    const citizenRef = db.collection("utenti_cittadini").doc(uid);
    const receivedRef = citizenRef.collection("necrologi_consegnati").doc(necrologioId);

    await db.runTransaction(async (tx) => {
      const live = await tx.get(docSnap.ref);
      if (!live.exists) throw new Error("Consegna non più disponibile");
      const liveData = live.data() || {};

      if (liveData.status === "accepted" && liveData.citizenUid && liveData.citizenUid !== uid) {
        throw new Error("Consegna già accettata da un altro utente");
      }
      if (liveData.status && liveData.status !== "pending" && liveData.status !== "accepted") {
        throw new Error("Consegna non in attesa");
      }

      tx.set(citizenRef, { updatedAt: now }, { merge: true });

      // ✅ accepted + rimuovo token monouso
      tx.update(docSnap.ref, {
        status: "accepted",
        acceptedAt: now,
        citizenUid: uid,
        token: admin.firestore.FieldValue.delete(),
      });

      tx.set(
        receivedRef,
        {
          necrologioId,
          deliveryId,
          citizenUid: uid,
          citizenEmail: liveData.citizenEmail || d.citizenEmail || null,
          source: "impresa",
          deliveredBy: liveData.createdBy || d.createdBy || null,
          deliveredAt: now,
          acceptedAt: now,
          expiresAt: liveData.expiresAt || d.expiresAt || null,
        },
        { merge: true }
      );

      tx.set(db.collection("log_consegne_necrologi").doc(), {
        at: now,
        deliveryId,
        necrologioId,
        citizenUid: uid,
        citizenEmail: liveData.citizenEmail || d.citizenEmail || null,
        byUid: (liveData.createdBy?.uid || d.createdBy?.uid) || null,
        byEmail: (liveData.createdBy?.email || d.createdBy?.email) || null,
        status: "accepted",
      });
    });

    // 5) Notifica email all'impresa (NON blocca l'accettazione)
    const afterSnap = await docSnap.ref.get();
    const afterData = afterSnap.data() || {};
    const impresaEmailRaw = (afterData.createdBy?.email || afterData.createdByEmail || "").trim().toLowerCase();

    if (impresaEmailRaw && impresaEmailRaw.includes("@")) {
      const baseUrl = pickEnv(["FRONTEND_BASE_URL", "PUBLIC_BASE_URL", "DASHBOARD_URL"]) || "https://www.italiaofi.it";
      const dashboardUrl = `${baseUrl}/imprese/imprese-dashboard.html`;

      const acceptedAtStr = new Date().toLocaleString("it-IT", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      try {
        const { html, text } = renderImpresaAcceptedMail({
          necrologioId,
          acceptedAtStr,
          dashboardUrl,
          baseUrl,
        });

        const elasticResp = await sendEmailElastic({
          to: impresaEmailRaw,
          subject: "OFI — Consegna accettata dalla famiglia",
          html,
          text,
        });

        await docSnap.ref.update({
          "impresaNotify.acceptedEmailAt": admin.firestore.FieldValue.serverTimestamp(),
          "impresaNotify.acceptedEmailTo": impresaEmailRaw,
          "impresaNotify.acceptedEmailOk": true,
          "impresaNotify.acceptedEmailElastic": elasticResp || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        await docSnap.ref.update({
          "impresaNotify.acceptedEmailAt": admin.firestore.FieldValue.serverTimestamp(),
          "impresaNotify.acceptedEmailTo": impresaEmailRaw,
          "impresaNotify.acceptedEmailOk": false,
          "impresaNotify.acceptedEmailError": String(err?.message || err),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

// 6) Email di conferma al cittadino (NON blocca l'accettazione)
try {
  const citizenEmail = (afterData.citizenEmail || "").trim().toLowerCase();
  if (citizenEmail && citizenEmail.includes("@")) {

    const baseUrl = pickEnv(["FRONTEND_BASE_URL", "PUBLIC_BASE_URL", "DASHBOARD_URL"]) || "https://www.italiaofi.it";
    const dashboardUrl = `${baseUrl}/cittadini/necrologi-miei.html`;

    const acceptedAtStr = new Date().toLocaleString("it-IT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const brandName = pickEnv(["SITE_BRAND", "BRAND_NAME"]) || "OFI — Onoranze Funebri Italia";

    const subject = "OFI — Consegna completata con successo";

    const text = `
${brandName}

Consegna completata.

Hai accettato correttamente la consegna del necrologio nella tua area personale.

Necrologio ID: ${necrologioId}
Data accettazione: ${acceptedAtStr}

Puoi consultarlo in qualsiasi momento da:
${dashboardUrl}

${brandName}
`.trim();

    const html = `
<!doctype html>
<html lang="it">
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <div style="max-width:640px;margin:24px auto;background:#ffffff;border-radius:16px;border:1px solid #e6eaf2;overflow:hidden;">
    
    <div style="padding:18px 20px;background:linear-gradient(135deg,#0f2340,#12335a);color:#fff;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.92;">
        ${brandName}
      </div>
      <div style="font-size:22px;font-weight:800;margin-top:6px;">
        Consegna completata ✅
      </div>
    </div>

    <div style="padding:18px 20px;color:#0f172a;font-size:15px;line-height:1.6;">
      Hai accettato correttamente la consegna del necrologio nella tua area personale OFI.
      
      <div style="margin-top:14px;padding:14px;border-radius:14px;background:#f7f9ff;border:1px solid #e7ecf7;">
        <b>Necrologio ID:</b> ${necrologioId}<br>
        <b>Data accettazione:</b> ${acceptedAtStr}
      </div>

      <div style="margin:18px 0;">
        <a href="${dashboardUrl}"
           style="display:inline-block;background:#caa03a;color:#0f2340;text-decoration:none;
                  font-weight:800;padding:12px 16px;border-radius:12px;border:1px solid #b58f31;">
          Vai ai tuoi Necrologi
        </a>
      </div>

      <div style="font-size:12px;color:#64748b;">
        Potrai consultare il necrologio in qualsiasi momento dalla tua area personale.
      </div>
    </div>

    <div style="padding:14px 20px;border-top:1px solid #eef2f7;background:#fbfcff;font-size:12px;color:#64748b;">
      © ${new Date().getFullYear()} ${brandName}
    </div>

  </div>
</body>
</html>
`;

    await sendEmailElastic({
      to: citizenEmail,
      subject,
      html,
      text,
    });

    await docSnap.ref.update({
      "citizenNotify.completedEmailAt": admin.firestore.FieldValue.serverTimestamp(),
      "citizenNotify.completedEmailOk": true,
    });
  }
} catch (err) {
  console.error("Email cittadino completamento fallita", err);
  await docSnap.ref.update({
    "citizenNotify.completedEmailAt": admin.firestore.FieldValue.serverTimestamp(),
    "citizenNotify.completedEmailOk": false,
    "citizenNotify.completedEmailError": String(err?.message || err),
  });
}

    return json(200, { ok: true, deliveryId, necrologioId });
  } catch (e) {
    console.error("acceptDelivery error", e);
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
