// netlify/functions/admin.js
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";


const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

function parseMaybeBase64(s) {
  if (!s) return null;
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  }
  // può essere base64
  try {
    const txt = Buffer.from(trimmed, "base64").toString("utf8");
    return JSON.parse(txt);
  } catch { return null; }
}

function buildFromSplitVars() {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey    = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) return null;
  // FIX \n per chiavi incollate da Netlify
  privateKey = privateKey.replace(/\\n/g, "\n");
  return {
    type: "service_account",
    project_id: projectId,
    private_key_id: "unknown",
    private_key: privateKey,
    client_email: clientEmail,
    client_id: "unknown",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: ""
  };
}

function getServiceAccount() {
  // 1) tua variabile già esistente
  const svc1 = parseMaybeBase64(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (svc1) return svc1;

  // 2) alternativa JSON (se in futuro volessi usarla)
  const svc2 = parseMaybeBase64(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (svc2) return svc2;

  // 3) triple separate
  const svc3 = buildFromSplitVars();
  if (svc3) return svc3;

  throw new Error("Nessuna credenziale Admin valida trovata nelle env.");
}

if (!getApps().length) {
  const serviceAccount = getServiceAccount();
  initializeApp({ credential: cert(serviceAccount) });
}

export const db = getFirestore();
