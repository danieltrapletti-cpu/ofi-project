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

function json(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
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

function isAdminDecoded(decoded) {
  const adminUids = new Set(["k1yxKXHiWyX5G5k9ZoEbwuNIXa63"]);
  return decoded?.admin === true || adminUids.has(decoded?.uid);
}

async function sendEmailElastic({ to, subject, html }) {
  const API_KEY = requireEnv("ELASTICEMAIL_API_KEY");
  const FROM = requireEnv("ELASTICEMAIL_FROM");
  const FROM_NAME = process.env.ELASTICEMAIL_FROM_NAME || "OFI";

  const params = new URLSearchParams();
  params.set("apikey", API_KEY);
  params.set("from", FROM);
  params.set("fromName", FROM_NAME);
  params.set("to", to);
  params.set("subject", subject);
  params.set("bodyHtml", html);

  const r = await fetch("https://api.elasticemail.com/v2/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) throw new Error(data?.error || "ElasticEmail send failed");
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Metodo non consentito (usa POST)" });

    initAdmin();
    const decoded = await verifyBearer(event);
    if (!isAdminDecoded(decoded)) return json(403, { ok: false, error: "Non autorizzato" });

    const body = JSON.parse(event.body || "{}");
    const deliveryId = String(body.deliveryId || "").trim();
    const newEmail = String(body.citizenEmail || "").trim().toLowerCase();

    if (!deliveryId) return json(400, { ok: false, error: "deliveryId mancante" });
    if (!newEmail || !newEmail.includes("@")) return json(400, { ok: false, error: "Email non valida" });

    const db = admin.firestore();
    const ref = db.collection("consegne_necrologi").doc(deliveryId);
    const snap = await ref.get();
    if (!snap.exists) return json(404, { ok: false, error: "Consegna non trovata" });

    const d = snap.data() || {};
    if (d.status === "accepted") return json(400, { ok: false, error: "Consegna già accettata: non puoi rigenerare" });

    // nuovo token + nuova scadenza
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAtMs = Date.now() + 14 * 24 * 60 * 60 * 1000;

    // prova a capire se la nuova email è già registrata
    let citizenUid = null;
    try {
      const u = await admin.auth().getUserByEmail(newEmail);
      citizenUid = u?.uid || null;
    } catch {
      citizenUid = null;
    }

    await ref.update({
      token,
      status: "pending",
      citizenEmail: newEmail,
      citizenUid: citizenUid || null,
      expiresAt: new Date(expiresAtMs),
      reissuedAt: admin.firestore.FieldValue.serverTimestamp(),
      reissuedBy: { uid: decoded.uid, email: decoded.email || null },
    });

    const baseUrl = process.env.PUBLIC_BASE_URL || "https://ofi-test-daniel.netlify.app";
    const acceptUrl = `${baseUrl}/cittadini/necrologi-miei.html?accept=${token}`;

    const subject = "OFI — Consegna necrologio (nuovo invio)";
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 10px">Hai una consegna in attesa</h2>
        <p>È stato inviato un necrologio da custodire nella tua area personale su OFI.</p>
        <p><b>Per accettare</b> clicca qui (valido 14 giorni):</p>
        <p><a href="${acceptUrl}" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#0b3a66;color:#fff;text-decoration:none">Accetta consegna</a></p>
      </div>
    `;

    await sendEmailElastic({ to: newEmail, subject, html });

    return json(200, { ok: true, deliveryId, status: "pending", expiresAt: expiresAtMs, citizenRegistered: !!citizenUid });
  } catch (e) {
    console.error("adminReissueDelivery error", e);
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
