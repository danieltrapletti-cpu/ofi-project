// netlify/functions/toggleNecrologioHeart.js
const admin = require("firebase-admin");


const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

let _inited = false;
function initAdmin() {
  if (_inited) return;
  const admin = require("./_firebaseAdmin");
  _inited = true;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function isLiveDoc(data) {
  const st = typeof data?.status === "string" ? data.status : "";
  const deleted = data?.deleted === true;
  return ["published", "live", "public", "pubblico"].includes(st) && !deleted;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "ok" };
  }

  const headers = { ...corsHeaders(), "Content-Type": "application/json" };

  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ ok: false, error: "Method Not Allowed" }),
      };
    }

    initAdmin();
    const db = admin.firestore();

    // ---- Auth: Bearer <FirebaseIdToken>
    const authz = event.headers.authorization || event.headers.Authorization || "";
    const m = String(authz).match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Missing Authorization Bearer token",
        }),
      };
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(m[1]);
    } catch (e) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ ok: false, error: "Invalid token" }),
      };
    }

    const uid = decoded.uid;
    const emailLower = String(decoded.email || "").trim().toLowerCase();

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      body = {};
    }

    const necrologioId = String(body.necrologioId || "").trim();
    if (!necrologioId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ ok: false, error: "Missing necrologioId" }),
      };
    }

    const necroRef = db.collection("necrologi_pubblicati").doc(necrologioId);
    const reactColl = necroRef.collection("reazioni");
    const reactRef = reactColl.doc(uid);

    // ---- actor (impresa/cittadino/utente)
    let actor = {
      role: "utente",
      displayName: decoded.name || decoded.email || "Utente",
      photoURL: decoded.picture || null,
    };

    // prova impresa (docId = email)
    try {
      if (emailLower) {
        const impSnap = await db.collection("imprese_registrate").doc(emailLower).get();
        if (impSnap.exists) {
          const d = impSnap.data() || {};
          actor = {
            role: "impresa",
            displayName: String(
              d.nome || d.ragioneSociale || d.nomeImpresa || actor.displayName || "Impresa"
            ).trim(),
            photoURL: String(d.logo_url || actor.photoURL || "").trim() || null,
          };
        }
      }
    } catch (_) {}

    // prova cittadino (docId = uid) -> se esiste, ha priorità
    try {
      const citSnap = await db.collection("utenti_cittadini").doc(uid).get();
      if (citSnap.exists) {
        const d = citSnap.data() || {};
        const dn = String(
          d.nome_utente ||
            [d.nome, d.cognome].filter(Boolean).join(" ") ||
            actor.displayName ||
            "Utente"
        ).trim();
        actor = {
          role: "cittadino",
          displayName: dn,
          photoURL: d.foto || actor.photoURL || null,
        };
      }
    } catch (_) {}

    const impresaUrl = emailLower
      ? `/imprese/profilo.html?id=${encodeURIComponent(emailLower)}`
      : null;
    const cittadinoUrl = `/cittadini/autore-pubblico.html?id=${encodeURIComponent(uid)}`;
    const profileUrl = actor.role === "impresa" ? impresaUrl : cittadinoUrl;

    // ---- Transaction: toggle + dedup definitivo
    let action = "none";
    let myHeart = false;

    await db.runTransaction(async (tx) => {
      const necroSnap = await tx.get(necroRef);
      if (!necroSnap.exists) throw new Error("Necrologio non trovato.");
      const necro = necroSnap.data() || {};
      if (!isLiveDoc(necro)) throw new Error("Necrologio non disponibile (non live/deleted).");

      // 1) stato attuale
      const reactSnap = await tx.get(reactRef);
      const currentlyOn = reactSnap.exists;

      // 2) dedup: elimina SEMPRE eventuali doppioni riconducibili all'utente
      // - docId=email (legacy)
      // - docs con uid == uid
      // - docs con emailLower == emailLower
      const toDelete = [];

      // legacy docId=email
      if (emailLower && emailLower !== uid) {
        toDelete.push(reactColl.doc(emailLower));
      }

      // query uid
      const qUid = await tx.get(reactColl.where("uid", "==", uid));
      qUid.docs.forEach((d) => {
        if (d.id !== uid) toDelete.push(d.ref);
      });

      // query emailLower
      if (emailLower) {
        const qEmail = await tx.get(reactColl.where("emailLower", "==", emailLower));
        qEmail.docs.forEach((d) => {
          if (d.id !== uid) toDelete.push(d.ref);
        });
      }

      // eseguo delete dedup (senza duplicati)
      const seen = new Set();
      toDelete.forEach((ref) => {
        if (!seen.has(ref.path)) {
          tx.delete(ref);
          seen.add(ref.path);
        }
      });

      // 3) toggle reale
      if (currentlyOn) {
        tx.delete(reactRef);
        action = "removed";
        myHeart = false;
      } else {
        tx.set(reactRef, {
          uid,
          emailLower: emailLower || null,
          role: actor.role,
          displayName: actor.displayName,
          photoURL: actor.photoURL || null,
          profileUrl: profileUrl || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        action = "added";
        myHeart = true;
      }
    });

    // ✅ RECONCILE: contatore = numero doc reali (sempre)
    let total = 0;
    try {
      const countSnap = await reactColl.count().get();
      total = Number(countSnap.data().count || 0);
      await necroRef.update({ reactionsHeartTotal: total });
    } catch (e) {
      const necroNow = await necroRef.get();
      total = Number(necroNow.data()?.reactionsHeartTotal || 0);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, action, total, myHeart }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(e?.message || e) }),
    };
  }
};
