// netlify/functions/stripeWebhook.js
const Stripe = require("stripe");
const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return;

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
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secretKey) return { statusCode: 500, body: "Missing STRIPE_SECRET_KEY" };
    if (!whSecret) return { statusCode: 500, body: "Missing STRIPE_WEBHOOK_SECRET" };

    const stripe = new Stripe(secretKey);

    // Header firma (Netlify normalizza in lowercase quasi sempre)
    const sig =
      event.headers["stripe-signature"] ||
      event.headers["Stripe-Signature"] ||
      event.headers["STRIPE-SIGNATURE"];

    if (!sig) return { statusCode: 400, body: "Missing Stripe signature" };

    // Netlify: body può arrivare base64
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, whSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err && err.message ? err.message : err);
      return { statusCode: 400, body: "Webhook signature verification failed." };
    }

    if (stripeEvent.type === "checkout.session.completed") {
      const session = stripeEvent.data.object;
      const md = session.metadata || {};
      const luogoId = (md.luogoId || "").toString();
      const videoId = (md.videoId || "").toString();
      const uid = (md.uid || "").toString();

      if (luogoId && videoId) {
        initAdmin();
        const db = admin.firestore();

        const videoRef = db.doc(`luoghi_memoria/${luogoId}/videos/${videoId}`);

        // Aggiorno a “paid” in modo autoritativo
        await videoRef.set(
          {
            paymentStatus: "paid",
            locked: false,
            hasWatermark: false,
            isOfficial: true,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paidByUid: uid || null,
            stripeSessionId: session.id,
          },
          { merge: true }
        );

        // (Opzionale) log
        await db
          .collection(`luoghi_memoria/${luogoId}/logs`)
          .add({
            type: "video_paid",
            videoId,
            uid: uid || null,
            stripeSessionId: session.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
          .catch(() => {});
      }
    }

    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error("stripeWebhook fatal:", e && e.message ? e.message : e);
    return { statusCode: 500, body: `Internal error: ${e.message || "unknown"}` };
  }
};