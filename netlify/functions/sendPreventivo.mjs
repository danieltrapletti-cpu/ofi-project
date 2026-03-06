// netlify/functions/sendPreventivo.mjs
import admin from "firebase-admin";

/* ============================
   Firebase Admin init (SOLO env separate)
   ============================ */
function initAdmin() {
  if (admin.apps.length) return admin.app();

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  const pk = (FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !pk) {
    throw new Error(
      "Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY."
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    }),
  });

  return admin.app();
}

/* ============================
   Auth helper (consigliato)
   - richiede header Authorization: Bearer <idToken>
   - se vuoi, puoi restringere ad admin claim
   ============================ */
async function requireUser(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("Missing Authorization Bearer token");

  initAdmin();
  const decoded = await admin.auth().verifyIdToken(m[1]);

  // Se vuoi limitare SOLO agli admin:
  // if (!decoded.admin) throw new Error("Not allowed (admin only)");

  return decoded; // { uid, ... }
}

const db = (() => {
  initAdmin();
  return admin.firestore();
})();

/* ============================
   Helper: verifica impresa registrata
   (doc id = email) -> come stai usando tu
   ============================ */
async function checkImpresaRegistrata(email) {
  const ref = db.collection("imprese_registrate").doc(email);
  const snap = await ref.get();
  return snap.exists;
}

/* ============================
   Invio email via ElasticEmail
   ============================ */
async function sendEmailElastic({ to, template, placeholders }) {
  const apiKey = process.env.ELASTICEMAIL_API_KEY;
  if (!apiKey) throw new Error("Missing ELASTICEMAIL_API_KEY");

  const fromEmail = process.env.FROM_EMAIL || process.env.EE_FROM_EMAIL || "info@onoranzefunebritalia.it";
  const fromName = process.env.EE_FROM_NAME || "Onoranze Funebri Italia";
  const replyTo = process.env.REPLY_TO || fromEmail;

  const params = new URLSearchParams({
    apikey: apiKey,
    from: fromEmail,
    fromName,
    to,
    replyTo,
    subject: "Hai ricevuto una richiesta di preventivo",
    template,

    // Merge fields (coerenti con il tuo template)
    merge_luogo: placeholders.luogo ?? "Località non specificata",
    merge_servizio: placeholders.servizio ?? "Servizio richiesto",
    merge_nomeImpresa: placeholders.nomeImpresa ?? "Impresa",
    merge_email: to,
  });

  const resp = await fetch("https://api.elasticemail.com/v2/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || data?.success === false) {
    const msg = data?.error || data?.message || `ElasticEmail status ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

/* ============================
   Handler
   ============================ */
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Method Not Allowed (use POST)" }),
      };
    }

    // ✅ Consigliato: richiedi utente loggato
    const user = await requireUser(event);

    const payload = JSON.parse(event.body || "{}");
    const preventivo = payload.preventivo;

    if (!preventivo || !Array.isArray(preventivo.imprese) || preventivo.imprese.length === 0) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Payload non valido: manca preventivo.imprese" }),
      };
    }

    const luogo = preventivo.luogoServizio || "Località non specificata";
    const servizio = preventivo.servizioDesiderato || "Servizio richiesto";

    const tplRegistrata = process.env.EE_TEMPLATE_PREVENTIVO || process.env.EE_TEMPLATE || "preventivo_ofi";
    const tplNonRegistrata = process.env.EE_TEMPLATE_INVITO || "email-invito-non-registrati";

    const tasks = preventivo.imprese.map(async (email) => {
      try {
        const registrata = await checkImpresaRegistrata(email);
        const template = registrata ? tplRegistrata : tplNonRegistrata;

        const res = await sendEmailElastic({
          to: email,
          template,
          placeholders: {
            luogo,
            servizio,
            nomeImpresa: (email.split("@")[0] || "Impresa").trim(),
          },
        });

        return { email, ok: true, registrata, template, res };
      } catch (e) {
        return { email, ok: false, error: String(e?.message || e) };
      }
    });

    const esiti = await Promise.all(tasks);

    // Log best-effort
    try {
      await db.collection("log_invio_preventivi").add({
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        byUid: user?.uid || null,
        payload: { imprese: preventivo.imprese, luogo, servizio },
        esiti,
      });
    } catch (_) {}

    const okCount = esiti.filter((x) => x.ok).length;
    const failCount = esiti.length - okCount;

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, inviati: okCount, falliti: failCount, dettagli: esiti }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(err?.message || err) }),
    };
  }
}