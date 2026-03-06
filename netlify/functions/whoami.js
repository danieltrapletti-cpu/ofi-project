import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return admin.app();

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      "Missing Firebase env vars (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)"
    );
  }

  // Converte \n in newline reali (classico formato Netlify)
  const pk = FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n").trim();

  // Check minimo (non stampa nulla di sensibile)
  const looksLikePem =
    pk.includes("-----BEGIN PRIVATE KEY-----") && pk.includes("-----END PRIVATE KEY-----");

  if (!looksLikePem) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY does not look like a PEM key. It must include BEGIN/END PRIVATE KEY lines."
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

function hintFromError(err) {
  const msg = String(err || "");
  if (msg.includes("DECODER routines::unsupported")) {
    return "Private key non valida/formatto PEM errato. Controlla BEGIN/END, \\n, spazi, caratteri strani.";
  }
  if (msg.includes("Failed to parse private key")) {
    return "Private key non parseabile: spesso manca \\n oppure ci sono virgolette residue.";
  }
  if (msg.includes("permission-denied") || msg.includes("Permission denied")) {
    return "Firebase Admin inizializzato, ma Firestore nega l’accesso: controlla project/credenziali o regole.";
  }
  return null;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Method not allowed (use GET)" }),
      };
    }

    const app = initAdmin();
    const db = app.firestore();

    // Query minima
    const snap = await db.collection("imprese_registrate").limit(1).get();

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        projectId: process.env.FIREBASE_PROJECT_ID,
        adminApps: admin.apps.length,
        found_docs: snap.size,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: String(e),
        hint: hintFromError(e),
      }),
    };
  }
};