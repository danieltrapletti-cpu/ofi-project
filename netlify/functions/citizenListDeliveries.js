// netlify/functions/citizenListDeliveries.js
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
    if (event.httpMethod === "OPTIONS") return json(200,{ok:true});
    if (event.httpMethod !== "POST") return json(405,{ok:false,error:"Use POST"});

    initAdmin();
    const decoded = await verifyBearer(event);
    const uid = decoded.uid;

    const db = admin.firestore();
    const now = new Date();

    // consegne per questo cittadino (solo se citizenUid è valorizzato)
    const snap = await db.collection("consegne_necrologi")
      .where("citizenUid","==",uid)
      .where("status","==","pending")
      .limit(20)
      .get();

    const items = [];
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const exp = d.expiresAt?.toDate?.() || null;
      if (exp && exp < now) {
        // auto-expire
        await doc.ref.update({
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        continue;
      }
      items.push({
        deliveryId: d.deliveryId || doc.id,
        necrologioId: d.necrologioId || null,
        citizenEmail: d.citizenEmail || null,
        expiresAt: exp ? exp.getTime() : null,
        token: d.token || null, // lo userai per costruire ?accept=
      });
    }

    return json(200,{ ok:true, items });
  }catch(e){
    console.error("citizenListDeliveries error", e);
    return json(500,{ok:false,error:e.message || String(e)});
  }
}
