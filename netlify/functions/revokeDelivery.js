// netlify/functions/revokeDelivery.js
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
  return { statusCode, headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) };
}
function initAdmin(){
  if (admin.apps.length) return;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const admin = require("./_firebaseAdmin");
  } else {
  const admin = require("./_firebaseAdmin");
}
}
async function verifyBearer(event){
  const h = event.headers.authorization || event.headers.Authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) throw new Error("Missing Authorization Bearer token");
  return await admin.auth().verifyIdToken(t);
}

export async function handler(event){
  try{
    if (event.httpMethod !== "POST") return json(405,{ok:false,error:"Use POST"});
    initAdmin();
    const decoded = await verifyBearer(event);

    const body = JSON.parse(event.body || "{}");
    const deliveryId = String(body.deliveryId || "").trim();
    if (!deliveryId) return json(400,{ok:false,error:"deliveryId mancante"});

    const db = admin.firestore();
    const ref = db.collection("consegne_necrologi").doc(deliveryId);

    await db.runTransaction(async (tx)=>{
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Consegna non trovata");
      const d = snap.data() || {};

      if (d.createdByUid !== decoded.uid) throw new Error("Non autorizzato");
      if (d.status === "accepted") throw new Error("Consegna già accettata: non puoi revocarla");
      if (d.status !== "pending") throw new Error("Puoi revocare solo una consegna in attesa");

      tx.update(ref, {
        status: "revoked",
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        token: admin.firestore.FieldValue.delete()
      });
    });

    return json(200,{ok:true});
  }catch(e){
    console.error("revokeDelivery error", e);
    return json(500,{ok:false,error:e.message || String(e)});
  }
}
