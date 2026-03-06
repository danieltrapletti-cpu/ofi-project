// netlify/functions/sendWelcomeEmail.js  (DEBUG MODE via EE_DEBUG=1)
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
    headers: { "Content-Type": "application/json", "Content-Length": payload.length, "User-Agent": "OFI-NetlifyFn/1.2", ...headers },
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
  if (event.httpMethod === "GET")     return ok({ ok: true, fn: "sendWelcomeEmail", debug: !!process.env.EE_DEBUG });
  if (event.httpMethod !== "POST")    return bad(405, "Method Not Allowed");

  try {
    const { email, ruolo = "cittadino" } = JSON.parse(event.body || "{}");
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(400, "Email non valida");

    const API_KEY   = (process.env.ELASTICEMAIL_API_KEY || "").trim();
    const TEMPLATE  = (process.env.EE_TEMPLATE || "").trim();
    const FROM      = (process.env.EE_FROM_EMAIL || process.env.FROM_EMAIL || "").trim();
    const FROM_NAME = (process.env.EE_FROM_NAME  || process.env.SITE_BRAND || "OFI Italia").trim();
    const REPLY_TO  = (process.env.ADMIN_REPLY_TO || process.env.REPLY_TO || FROM).trim();
    const SUBJECT   = (process.env.MAIL_SUBJECT || "OFI Italia — Grazie per il tuo interesse").trim();
    const DEBUG     = !!process.env.EE_DEBUG;

    if (!API_KEY) return bad(500, "Missing ELASTICEMAIL_API_KEY");
    if (!FROM)    return bad(500, "Missing FROM (EE_FROM_EMAIL o FROM_EMAIL)");

    const endpoint = "https://api.elasticemail.com/v4/emails";

    const Content = { From: FROM, FromName: FROM_NAME, ReplyTo: REPLY_TO || undefined, Subject: SUBJECT };
    if (TEMPLATE) {
      Content.TemplateName = TEMPLATE;
      Content.Merge = { ruolo };
    } else {
      Content.Body = [{
        ContentType: "HTML",
        Content: `
          <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;font-size:16px;line-height:1.6">
            <h2 style="margin:0 0 12px">Grazie per il tuo interesse</h2>
            <p>Ti avviseremo quando OFI Italia sarà online.</p>
            <p style="margin-top:18px">Hai selezionato: <strong>${ruolo}</strong></p>
            <p style="margin-top:24px">Un caro saluto,<br>${FROM_NAME}</p>
          </div>`
      }];
    }

    // >>> NIENTE Options qui <<<
    const payload = { Recipients: [{ Email: email }], Content };

    const { status, body } = await postJSON(endpoint, { "X-ElasticEmail-ApiKey": API_KEY }, payload);

    let data; try { data = JSON.parse(body); } catch { data = { raw: body }; }
    const id = data?.TransactionID || data?.Messages?.[0]?.MessageID || null;

    if (process.env.EE_DEBUG && (status < 200 || status >= 300)) {
      const maskedKey = API_KEY ? API_KEY.slice(0, 6) + "…" + API_KEY.slice(-4) : null;
      return ok({ ok: false, reason: "ElasticEmail non 2xx (debug mode)", elastic: { status, data }, used: {
        endpoint, from: FROM, fromName: FROM_NAME, replyTo: REPLY_TO || null, subject: SUBJECT, template: TEMPLATE || null, apiKeyMasked: maskedKey
      }, sentPayload: payload });
    }

    if (status < 200 || status >= 300) return bad(502, `ElasticEmail error ${status}`, data || body);

    return ok({ status: "sent", id, provider: data });
  } catch (e) {
    return bad(500, "Server error", e?.message || String(e));
  }
};
