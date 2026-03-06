// netlify/functions/getDeliveryStatus.js
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

    const body = JSON.parse(event.body || "{}");
    const necrologioId = String(body.necrologioId || "").trim();
    if (!necrologioId) return json(400,{ok:false,error:"necrologioId mancante"});

    const db = admin.firestore();
    const createdByUid = decoded.uid;

    const snap = await db.collection("consegne_necrologi")
      .where("necrologioId","==",necrologioId)
      .where("createdByUid","==",createdByUid)
      .limit(25)
      .get();

    if (snap.empty) return json(200,{ok:true, delivery:{ status:"not_sent" }});

    // scegliamo la "migliore" (accepted > pending > expired > revoked) e più recente
    const docs = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    const rank = (s)=> (s==="accepted"?4 : s==="pending"?3 : s==="expired"?2 : s==="revoked"?1 : 0);

    docs.sort((a,b)=>{
      const ra = rank(String(a.status||""));
      const rb = rank(String(b.status||""));
      if (rb !== ra) return rb - ra;
      const ta = a.createdAt?.toDate?.()?.getTime?.() || 0;
      const tb = b.createdAt?.toDate?.()?.getTime?.() || 0;
      return tb - ta;
    });

    let d = docs[0] || {};
    const nowMs = Date.now();

    // FIX: se pending ma scaduta → treat as expired + update Firestore
    if (String(d.status) === "pending") {
      const expMs = d.expiresAt?.toDate?.()?.getTime?.() || 0;
      if (expMs && expMs < nowMs) {
        const ref = db.collection("consegne_necrologi").doc(d.deliveryId || d.id);
        await ref.update({
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        d.status = "expired";
      }
    }

    const baseUrl = pickEnv(["FRONTEND_BASE_URL","PUBLIC_BASE_URL","DASHBOARD_URL"]) || "https://www.italiaofi.it";
    const token = String(d.token || "").trim();

    const acceptUrl = (String(d.status) === "pending" && token)
      ? `${baseUrl}/cittadini/necrologi-miei.html?accept=${token}`
      : null;

    return json(200,{
      ok:true,
      delivery:{
        deliveryId: d.deliveryId || d.id,
        status: d.status || "unknown",
        citizenEmail: d.citizenEmail || null,
        expiresAt: d.expiresAt?.toDate?.()?.getTime?.() || null,
        acceptedAt: d.acceptedAt?.toDate?.()?.getTime?.() || null,
        revokedAt: d.revokedAt?.toDate?.()?.getTime?.() || null,
        expiredAt: d.expiredAt?.toDate?.()?.getTime?.() || null,
        acceptUrl
      }
    });

  }catch(e){
    console.error("getDeliveryStatus error", e);
    return json(500,{ok:false,error:e.message || String(e)});
  }
}
