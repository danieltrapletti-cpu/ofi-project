// netlify/functions/createCheckoutSession.js
const Stripe = require("stripe");
const admin = require("firebase-admin");

function getSiteUrl() {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || "http://localhost:8888";
}

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

async function verifyUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("Missing Authorization Bearer token");
  const idToken = m[1];

  initAdmin();
  return admin.auth().verifyIdToken(idToken);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing STRIPE_SECRET_KEY" }) };
    }

    const priceId = process.env.STRIPE_PRICE_VIDEO_OFFICIAL;
    if (!priceId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: "Missing STRIPE_PRICE_VIDEO_OFFICIAL env var" }),
      };
    }

    const user = await verifyUser(event);

    const body = JSON.parse(event.body || "{}");
    const luogoId = (body.luogoId || "").toString();
    const videoId = (body.videoId || "").toString();

    if (!luogoId || !videoId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing luogoId/videoId" }) };
    }

    initAdmin();
    const db = admin.firestore();

    const videoRef = db.doc(`luoghi_memoria/${luogoId}/videos/${videoId}`);
    const snap = await videoRef.get();
    if (!snap.exists) {
      return { statusCode: 404, body: JSON.stringify({ ok: false, error: "Video not found" }) };
    }

    const v = snap.data() || {};
    const custodeUid = (v.custodeUid || "").toString();

    if (custodeUid !== user.uid) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: "Not allowed" }) };
    }

    if ((v.paymentStatus || "") === "paid") {
      return { statusCode: 409, body: JSON.stringify({ ok: false, error: "Already paid" }) };
    }

    // ✅ Idempotenza: se esiste già una sessione in processing, riusiamola (evita doppio checkout)
    if ((v.paymentStatus || "") === "processing" && v.checkoutSessionUrl) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, url: v.checkoutSessionUrl, reused: true }),
      };
    }

    const stripe = new Stripe(stripeKey);

    const siteUrl = getSiteUrl();
    const successUrl = `${siteUrl}/cittadini/video-checkout.html?status=success&luogoId=${encodeURIComponent(
      luogoId
    )}&videoId=${encodeURIComponent(videoId)}`;
    const cancelUrl = `${siteUrl}/cittadini/video-checkout.html?status=cancel&luogoId=${encodeURIComponent(
      luogoId
    )}&videoId=${encodeURIComponent(videoId)}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.uid,
      metadata: { luogoId, videoId, uid: user.uid },
    });

    await videoRef.set(
      {
        paymentStatus: "processing",
        checkoutSessionId: session.id,
        checkoutSessionUrl: session.url || null,
        checkoutCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, url: session.url }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message || "Internal error" }),
    };
  }
};