// netlify/functions/shareNecrologio.js
const admin = require("firebase-admin");

function initFirebase() {
  if (admin.apps.length) return;

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  const pk = (FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !pk) {
    throw new Error(
      "Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY."
    );
  }

  const looksLikePem =
    pk.includes("-----BEGIN PRIVATE KEY-----") && pk.includes("-----END PRIVATE KEY-----");

  if (!looksLikePem) {
    throw new Error("FIREBASE_PRIVATE_KEY does not look like a PEM key (missing BEGIN/END PRIVATE KEY).");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    }),
  });
}

function safeText(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

// Nome “base” (se manca cognome)
function pickName(d) {
  const a = d?.answersSnapshot || {};
  return safeText(d?.nome || a?.nome || d?.nomeDefunto || a?.nomeDefunto || "Necrologio");
}

// Nome completo (Nome + Cognome) con fallback
function pickFullName(d) {
  const a = d?.answersSnapshot || {};

  const nome = safeText(a?.nome || d?.nome || d?.nomeDefunto || a?.nomeDefunto || "");
  const cognome = safeText(a?.cognome || d?.cognome || "");

  const full = [nome, cognome].filter(Boolean).join(" ").trim();
  return full || pickName(d);
}

function pickPlace(d) {
  const g = d?.geoFinale || {};
  const bits = [g?.comune, g?.provincia].map(safeText).filter(Boolean);
  return bits.join(" ");
}

// Foto: priorità robusta
function pickPhotoUrl(d) {
  const a = d?.answersSnapshot || {};

  const candidates = [d?.foto, d?.photoDataUrl, d?.photoURL, a?.foto, a?.photoURL]
    .map(safeText)
    .filter(Boolean);

  return candidates[0] || "";
}

function formatDate(d) {
  try {
    if (!d) return "";
    if (typeof d.toDate === "function") {
      const dt = d.toDate();
      return dt.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
    }
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return "";
  }
}

function absUrl(origin, maybeUrl) {
  const u = safeText(maybeUrl);
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return origin + u;
  return origin + "/" + u;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isCrawler(userAgentRaw) {
  const ua = String(userAgentRaw || "").toLowerCase();
  return /facebookexternalhit|facebot|twitterbot|telegrambot|whatsapp|pinterest|linkedinbot|discordbot|slackbot|googlebot|bingbot|yandex|duckduckbot/i.test(
    ua
  );
}

function buildHtml({ title, description, image, url, redirectTo, doRedirect }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const i = escapeHtml(image);
  const u = escapeHtml(url);
  const r = escapeHtml(redirectTo);

  const redirectBlock = doRedirect
    ? `
  <link rel="canonical" href="${u}">
  <meta http-equiv="refresh" content="0;url=${r}">
  <script>location.replace(${JSON.stringify(redirectTo)});</script>
`
    : `
  <link rel="canonical" href="${u}">
`;

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">

  <!-- Open Graph -->
  <meta property="og:locale" content="it_IT">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Onoranze Funebri Italia">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:image" content="${i}">
  <meta property="og:image:alt" content="${t}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${u}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${i}">

  ${redirectBlock}
</head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:18px;line-height:1.35;">
  <p><strong>Onoranze Funebri Italia</strong></p>
  <p>Stai aprendo il necrologio.</p>
  <p><a href="${r}">Continua</a></p>
</body>
</html>`;
}

exports.handler = async (event) => {
  try {
    initFirebase();

    const qs = event.queryStringParameters || {};
    const id = (qs.id || "").trim();

    const proto = event.headers?.["x-forwarded-proto"];
    const host = event.headers?.["host"];
    const origin = proto && host ? `${proto}://${host}` : "https://www.italiaofi.it";

    const canonicalUrl = `${origin}/share/necrologio?id=${encodeURIComponent(id)}`;

    const ua = event.headers?.["user-agent"] || "";
    const doRedirect = !isCrawler(ua);

    if (!id) {
      const html = buildHtml({
        title: "Necrologio | Onoranze Funebri Italia",
        description: "Necrologio pubblicato su Onoranze Funebri Italia.",
        image: absUrl(origin, "/images/OFI-Social.png"),
        url: `${origin}/necrologio.html`,
        redirectTo: `${origin}/necrologio.html`,
        doRedirect,
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: html,
      };
    }

    const db = admin.firestore();
    const snap = await db.collection("necrologi_pubblicati").doc(id).get();

    if (!snap.exists) {
      const html = buildHtml({
        title: "Necrologio non disponibile | OFI",
        description: "Questo necrologio non è disponibile o è stato rimosso.",
        image: absUrl(origin, "/images/OFI-Social.png"),
        url: canonicalUrl,
        redirectTo: canonicalUrl,
        doRedirect,
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: html,
      };
    }

    const data = snap.data() || {};

    const fullName = pickFullName(data);
    const place = pickPlace(data);
    const date = formatDate(data.publishedAt || data.updatedAt || data.createdAt);

    const title = `In memoria di ${fullName} — Necrologio`;
    const description = `🌹 OFI — Onoranze Funebri Italia · Necrologio di ${fullName}${
      place ? " · " + place : ""
    }${date ? " · " + date : ""}.`;

    const photo = pickPhotoUrl(data);
    const image = absUrl(origin, photo || "/images/OFI-Social.png");

    const html = buildHtml({
      title,
      description,
      image,
      url: canonicalUrl,
      redirectTo: canonicalUrl,
      doRedirect,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: html,
    };
  } catch (err) {
    console.error("shareNecrologio error:", err && err.message ? err.message : err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Errore share preview.",
    };
  }
};