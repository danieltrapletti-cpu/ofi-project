import admin from "firebase-admin";


const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
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

function isAdminDecoded(decoded) {
  if (!decoded) return false;
  // usa claim admin oppure whitelist UID (coerente alle tue rules)
  const adminUids = new Set(["k1yxKXHiWyX5G5k9ZoEbwuNIXa63"]);
  return decoded.admin === true || adminUids.has(decoded.uid);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") return json(405, { ok: false, error: "Metodo non consentito (usa GET)" });

    initAdmin();
    const decoded = await verifyBearer(event);
    if (!isAdminDecoded(decoded)) return json(403, { ok: false, error: "Non autorizzato" });

    const db = admin.firestore();

    // filtri opzionali: ?status=pending|accepted|expired  &  ?limit=50
    const url = new URL(event.rawUrl || "https://dummy.local");
    const status = (url.searchParams.get("status") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

    let q = db.collection("consegne_necrologi").orderBy("createdAt", "desc").limit(limit);
    if (status) q = db.collection("consegne_necrologi").where("status", "==", status).orderBy("createdAt", "desc").limit(limit);

    const snap = await q.get();

    const items = snap.docs.map((d) => {
      const x = d.data() || {};
      // ✅ NIENTE token in output
      return {
        deliveryId: d.id,
        status: x.status || null,
        necrologioId: x.necrologioId || null,
        citizenEmail: x.citizenEmail || null,
        citizenUid: x.citizenUid || null,
        createdAt: x.createdAt?.toDate ? x.createdAt.toDate().toISOString() : x.createdAt || null,
        expiresAt: x.expiresAt?.toDate ? x.expiresAt.toDate().toISOString() : x.expiresAt || null,
        acceptedAt: x.acceptedAt?.toDate ? x.acceptedAt.toDate().toISOString() : x.acceptedAt || null,
        expiredAt: x.expiredAt?.toDate ? x.expiredAt.toDate().toISOString() : x.expiredAt || null,
        createdBy: x.createdBy || null,
      };
    });

    return json(200, { ok: true, count: items.length, items });
  } catch (e) {
    console.error("adminListDeliveries error", e);
    return json(500, { ok: false, error: e.message || String(e) });
  }
}
