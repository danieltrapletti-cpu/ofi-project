// netlify/functions/send-approvazione-impresa.js
// Elastic Email v4 — invio con TEMPLATE + merge fields coerenti (CTA_URL + continue_login_url)

const https = require("https");
const { URL } = require("url");

/* ===== util CORS/HTTP ===== */
const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
});
const ok  = (b) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(b, null, 2) });
const bad = (c, m, e) => ({ statusCode: c, headers: corsHeaders(), body: JSON.stringify({ error: m, extra: e }, null, 2) });

/* ===== HTTP POST helper ===== */
function postJSON(urlStr, headers, data, timeoutMs = 12000) {
  const url = new URL(urlStr);
  const payload = Buffer.from(JSON.stringify(data));
  const options = {
    method: "POST",
    hostname: url.hostname,
    path: url.pathname + (url.search || ""),
    port: url.port || 443,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": payload.length,
      "User-Agent": "OFI-NetlifyFn/2.0",
      ...headers
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("EE request timeout")); });
    req.write(payload);
    req.end();
  });
}

/* ===== formattazione data IT ===== */
function formatFreeEndHuman(v) {
  if (!v) return "";
  let d = null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    d = new Date(v);
  } else if (v && typeof v === "object" && "seconds" in v) {
    d = new Date(v.seconds * 1000);
  } else {
    const tryD = new Date(v);
    if (!isNaN(tryD)) d = tryD;
  }
  if (!d || isNaN(d)) return String(v);
  const it = new Intl.DateTimeFormat("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);
  const parts = it.split(", ");
  if (parts.length === 2) return `${parts[0]} ore ${parts[1]}`;
  return it.replace(",", " ore");
}

/* ===== handler ===== */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  const DEBUG = !!process.env.EE_DEBUG;

  // ENV richieste
  const API_KEY   = (process.env.ELASTICEMAIL_API_KEY || "").trim();
  const FROM      = (process.env.EE_FROM_EMAIL || process.env.FROM_EMAIL || "").trim();
  const FROM_NAME = (process.env.EE_FROM_NAME  || process.env.SITE_BRAND || "OFI Italia").trim();
  const REPLY_TO  = (process.env.ADMIN_REPLY_TO || process.env.REPLY_TO || FROM).trim();
  const SUBJECT   = (process.env.APPROVAZIONE_SUBJECT || "OFI – Registrazione approvata ✅ Benvenuta/o").trim();
  const BASE      = (process.env.FRONTEND_BASE_URL || "https://www.italiaofi.it").replace(/\/+$/,"");

  // Template Elastic Email
  const TEMPLATE  = (process.env.EE_TEMPLATE_APPROVAZIONE || "approvazione_impresa_ofi").trim();

  // GET = diagnostica (non invia)
  if (event.httpMethod === "GET") {
    return ok({
      fn: "send-approvazione-impresa",
      debug: DEBUG,
      envSeen: {
        FROM, FROM_NAME, REPLY_TO, SUBJECT, TEMPLATE, BASE,
        API_KEY_present: !!API_KEY
      }
    });
  }

  if (event.httpMethod !== "POST") return bad(405, "Method Not Allowed");

  try {
    if (!API_KEY)   return bad(500, "Missing ELASTICEMAIL_API_KEY");
    if (!FROM)      return bad(500, "Missing FROM (EE_FROM_EMAIL o FROM_EMAIL)");
    if (!TEMPLATE)  return bad(500, "Template approvazione non configurato (EE_TEMPLATE_APPROVAZIONE)");

    // ==== input ====
    const body = JSON.parse(event.body || "{}");
    const to   = (body.to || body.email || body.dest || "").trim();
    const ragione_sociale =
      (body.ragione_sociale || body.nome_impresa || body.nome || body.ragioneSociale || "").trim();
    const free_end_raw =
      (body.free_end || body.abbonamento_free_until || body.scadenza || "").toString().trim();
    const codice_ofi = (body.codice_ofi || body.codiceOfi || "").trim();

    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
      return bad(400, "Email destinatario non valida", { received: body });

    // ==== merge fields usati nel template ====
    const impresa_nome   = ragione_sociale || "Impresa";
    const email_impresa  = to;
    const free_end_human = formatFreeEndHuman(free_end_raw);

    // URL utili (link principale = Benvenuto; alternativo = login con continue)
    const LOGIN_URL      = `${BASE}/imprese/login-imprese.html`;
    const BENVENUTO_URL  = `${BASE}/imprese/benvenuto-impresa.html`;

    const CTA_URL = `${BENVENUTO_URL}?email=${encodeURIComponent(to)}`;
    const continue_login_url = `${LOGIN_URL}?continue=${
      encodeURIComponent(`/imprese/benvenuto-impresa.html?email=${encodeURIComponent(to)}`)
    }&email=${encodeURIComponent(to)}`;

    // ==== payload Elastic Email v4 ====
    const endpoint = "https://api.elasticemail.com/v4/emails";
    const payload = {
      Recipients: [{ Email: to }],
      Content: {
        From: FROM,
        FromName: FROM_NAME,
        ReplyTo: REPLY_TO || undefined,
        Subject: SUBJECT,
        TemplateName: TEMPLATE,
        Merge: {
          impresa_nome,
          codice_ofi,
          email_impresa,
          free_end: free_end_human,
          CTA_URL,
          continue_login_url
        }
      }
    };

    const { status, body: respBody } = await postJSON(
      endpoint,
      { "X-ElasticEmail-ApiKey": API_KEY },
      payload
    );

    let data; try { data = JSON.parse(respBody); } catch { data = { raw: respBody }; }

    if (DEBUG && (status < 200 || status >= 300)) {
      const maskedKey = API_KEY ? API_KEY.slice(0, 6) + "…" + API_KEY.slice(-4) : null;
      return ok({
        ok: false,
        reason: "ElasticEmail non 2xx (debug mode)",
        elastic: { status, data },
        used: {
          endpoint, from: FROM, fromName: FROM_NAME, replyTo: REPLY_TO || null,
          subject: SUBJECT, template: TEMPLATE, apiKeyMasked: maskedKey
        },
        normalizedInput: {
          to, impresa_nome, email_impresa, free_end_human, codice_ofi,
          CTA_URL, continue_login_url
        },
        sentPayload: payload
      });
    }

    if (status < 200 || status >= 300) return bad(502, `ElasticEmail error ${status}`, data || respBody);

    const id = data?.TransactionID || data?.Messages?.[0]?.MessageID || null;
    return ok({ status: "sent", id, provider: data, usedTemplate: TEMPLATE });
  } catch (e) {
    return bad(500, "Server error", e?.message || String(e));
  }
};
