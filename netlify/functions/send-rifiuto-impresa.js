// netlify/functions/send-rifiuto-impresa.js
// Elastic Email v4 — rifiuto: template obbligatorio, niente motivo, niente link dashboard

const https = require("https");
const { URL } = require("url");

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
});
const ok  = (b) => ({ statusCode: 200, headers: corsHeaders(), body: JSON.stringify(b, null, 2) });
const bad = (c, m, e) => ({ statusCode: c, headers: corsHeaders(), body: JSON.stringify({ error: m, extra: e }, null, 2) });

function postJSON(urlStr, headers, data, timeoutMs = 12000) {
  const url = new URL(urlStr);
  const payload = Buffer.from(JSON.stringify(data));
  const options = {
    method: "POST",
    hostname: url.hostname,
    path: url.pathname + (url.search || ""),
    port: url.port || 443,
    headers: { "Content-Type": "application/json", "Content-Length": payload.length, "User-Agent": "OFI-NetlifyFn/RIFIUTO-1.1", ...headers },
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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({ ok: true });
  const DEBUG = !!process.env.EE_DEBUG;

  const API_KEY   = (process.env.ELASTICEMAIL_API_KEY || "").trim();
  const FROM      = (process.env.EE_FROM_EMAIL || process.env.FROM_EMAIL || "").trim();
  const FROM_NAME = (process.env.EE_FROM_NAME  || process.env.SITE_BRAND || "OFI Italia").trim();
  const REPLY_TO  = (process.env.ADMIN_REPLY_TO || process.env.REPLY_TO || FROM).trim();
  const SUBJECT   = (process.env.RIFIUTO_SUBJECT || "OFI – Comunicazione sulla registrazione").trim();
  const TEMPLATE  = (process.env.EE_TEMPLATE_RIFIUTO || "rifiuto_impresa_ofi").trim();

  if (event.httpMethod === "GET") {
    return ok({
      fn: "send-rifiuto-impresa",
      debug: DEBUG,
      envSeen: {
        FROM, FROM_NAME, REPLY_TO, SUBJECT,
        TEMPLATE,
        API_KEY_present: !!API_KEY
      }
    });
  }
  if (event.httpMethod !== "POST") return bad(405, "Method Not Allowed");

  try {
    if (!API_KEY) return bad(500, "Missing ELASTICEMAIL_API_KEY");
    if (!FROM)    return bad(500, "Missing FROM (EE_FROM_EMAIL o FROM_EMAIL)");
    if (!TEMPLATE) return bad(500, "Template rifiuto non configurato (EE_TEMPLATE_RIFIUTO)");

    const body = JSON.parse(event.body || "{}");
    const to   = (body.to || body.email || body.dest || "").trim();
    const ragione_sociale = (body.ragione_sociale || body.nome_impresa || body.nome || body.ragioneSociale || "").trim();

    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
      return bad(400, "Email destinatario non valida", { received: body });

    const impresa_nome  = ragione_sociale || "Impresa";
    const email_impresa = to;

    const endpoint = "https://api.elasticemail.com/v4/emails";
    const Content = {
      From: FROM,
      FromName: FROM_NAME,
      ReplyTo: REPLY_TO || undefined,
      Subject: SUBJECT,
      TemplateName: TEMPLATE,
      Merge: { impresa_nome, email_impresa }
    };
    const payload = { Recipients: [{ Email: to }], Content };

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
        used: { endpoint, from: FROM, fromName: FROM_NAME, replyTo: REPLY_TO || null, subject: SUBJECT, template: TEMPLATE, apiKeyMasked: maskedKey },
        normalizedInput: { to, impresa_nome, email_impresa },
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
