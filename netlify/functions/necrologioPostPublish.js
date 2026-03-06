// netlify/functions/necrologioPostPublish.js
const admin = require("firebase-admin");

// ✅ fetch polyfill (runtime Netlify non-18)

const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

let _fetch = global.fetch;
if (!_fetch) {
  try {
    const nf = require("node-fetch");
    _fetch = nf.default || nf;
  } catch (e) {
    _fetch = null;
  }
}

let _inited = false;
function initAdmin() {
  if (_inited) return;
  const admin = require("./_firebaseAdmin");
  _inited = true;
}

function getBaseUrl() {
  const base = process.env.FRONTEND_BASE_URL || "https://ofi-test-daniel.netlify.app";
  return String(base).replace(/\/+$/, "");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pickDefuntoNomeCompleto(necro) {
  const a = necro || {};
  const direct =
    a.defuntoNomeCompleto ||
    a.nomeDefuntoCompleto ||
    a.nomeCompletoDefunto ||
    a.defuntoNome ||
    a.nomeDefunto ||
    a.nomeCompleto;

  if (direct) return String(direct).trim();

  const nome = (a.nome || a.nome_defunto || a.nomeDefunto || "").toString().trim();
  const cognome = (a.cognome || a.cognome_defunto || a.cognomeDefunto || "").toString().trim();
  const joined = [nome, cognome].filter(Boolean).join(" ").trim();
  if (joined) return joined;

  const snap = a.answersSnapshot || {};
  const snapDirect =
    snap.defuntoNomeCompleto ||
    snap.nomeDefuntoCompleto ||
    snap.nomeCompletoDefunto ||
    snap.nomeDefunto ||
    snap.nomeCompleto;

  if (snapDirect) return String(snapDirect).trim();

  const snapNome = (snap.nome || snap.nomeDefunto || snap.nome_defunto || "").toString().trim();
  const snapCognome = (snap.cognome || snap.cognomeDefunto || snap.cognome_defunto || "").toString().trim();
  const snapJoined = [snapNome, snapCognome].filter(Boolean).join(" ").trim();
  if (snapJoined) return snapJoined;

  return "il tuo necrologio";
}

function pickCitta(necro) {
  const a = necro || {};
  const snap = a.answersSnapshot || {};
  const c =
    a.citta ||
    a.comune ||
    a.comuneRigaFinale ||
    a.comuneFinale ||
    a.luogo ||
    a.luogoDecesso ||
    snap.citta ||
    snap.comune ||
    snap.comuneRigaFinale ||
    snap.comuneFinale ||
    snap.luogo ||
    snap.luogoDecesso ||
    snap.localita ||
    snap.localitaDecesso;

  const s = String(c || "").trim();
  return s || "—";
}

function toDateAny(x) {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (typeof x === "object" && typeof x.toDate === "function") return x.toDate();
  if (typeof x === "string") {
    const t = Date.parse(x);
    if (!Number.isNaN(t)) return new Date(t);
  }
  if (typeof x === "number" && Number.isFinite(x)) return new Date(x);
  return null;
}

function pickPublishedDate(necro) {
  const a = necro || {};
  const snap = a.answersSnapshot || {};
  const d =
    a.publishedAt ||
    a.pubblicatoAt ||
    a.dataPubblicazione ||
    a.createdAt ||
    a.updatedAt ||
    snap.publishedAt ||
    snap.dataPubblicazione ||
    snap.createdAt;

  const dt = toDateAny(d);
  return dt || new Date();
}

function fmtItDate(d) {
  if (!d) return "—";
  try {
    return d.toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  } catch (_) {
    return String(d);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  if (!_fetch) throw new Error("fetch non disponibile. Imposta Node 18+ su Netlify oppure installa node-fetch.");
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await _fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function sendElasticEmail({ to, subject, html, text }) {
  const apiKey = process.env.ELASTICEMAIL_API_KEY;
  const fromEmail = process.env.EE_FROM_EMAIL || process.env.FROM_EMAIL;
  const fromName = process.env.EE_FROM_NAME || process.env.SITE_BRAND || "OFI";
  const replyTo = process.env.REPLY_TO || process.env.ADMIN_REPLY_TO || fromEmail;

  if (!apiKey) throw new Error("Manca ELASTICEMAIL_API_KEY su Netlify.");
  if (!fromEmail) throw new Error("Manca EE_FROM_EMAIL (o FROM_EMAIL) su Netlify.");
  if (!to) throw new Error("Destinatario email mancante (to).");

  const params = new URLSearchParams({
    apikey: apiKey,
    from: fromEmail,
    fromName,
    to,
    subject: String(subject || "Notifica OFI"),
    bodyHtml: String(html || ""),
    bodyText: String(text || ""),
    isTransactional: "true",
    replyTo,
    charset: "utf-8",
  });

  const resp = await fetchWithTimeout("https://api.elasticemail.com/v2/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: params.toString(),
  });

  const raw = await resp.text().catch(() => "");
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) { data = null; }

  if (!resp.ok || !data || data.success !== true) {
    const details = data || { raw };
    const msg =
      details && (details.error || details.message)
        ? `ElasticEmail failed: ${details.error || details.message}`
        : `ElasticEmail failed: ${JSON.stringify(details).slice(0, 2000)}`;
    const err = new Error(msg);
    err.ee = details;
    err.status = resp.status;
    throw err;
  }

  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "ok" };
  }

  const headers = { ...corsHeaders(), "Content-Type": "application/json" };
  let necrologioIdForLog = "";

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }

    initAdmin();
    const db = admin.firestore();

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch (_) { body = {}; }

    const necrologioId = (body.necrologioId || "").toString().trim();
    necrologioIdForLog = necrologioId;

    // ✅ action: "publish" | "update"
    const action = (body.action || "publish").toString().trim().toLowerCase();
    const isUpdate = action === "update" || action === "edit" || action === "updated";

    const force = body.force === true;

    // ✅ punti SOLO per pubblicazione, NON per modifica
const puntiDefault = isUpdate ? 0 : 10;
const punti = Number.isFinite(+body.puntiAssegnati)
  ? +body.puntiAssegnati
  : puntiDefault;

    let emailImpresa = (body.emailImpresa || "").toString().trim();
    let impresaName = (body.impresaName || "").toString().trim();

    if (!necrologioId) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Missing necrologioId" }) };
    }

    const ref = db.collection("necrologi_pubblicati").doc(necrologioId);
    const snap = await ref.get();

    if (!snap.exists) {
      return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: "Necrologio non trovato" }) };
    }

    const necro = snap.data() || {};
    const mail = necro.mail || {};

    // ✅ anti-doppio invio separato publish/update
    const alreadyOk = isUpdate ? (mail.lastUpdateSentOk === true) : (mail.lastPublishSentOk === true);
    if (!force && alreadyOk) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          skipped: true,
          reason: `Mail già inviata per action=${isUpdate ? "update" : "publish"} (usa force:true per reinviare).`,
          necrologioId,
          action: isUpdate ? "update" : "publish",
          publicUrl: mail.publicUrl || null,
        }),
      };
    }

    if (!emailImpresa) {
      emailImpresa = (necro.emailImpresa || necro.email_impresa || necro.email || "").toString().trim();
    }

    if (!emailImpresa) {
      await ref.set(
        { mail: { lastAnySentAt: admin.firestore.FieldValue.serverTimestamp(), lastAnySentOk: false, lastError: "Email impresa mancante." } },
        { merge: true }
      );
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "emailImpresa mancante" }) };
    }

    // nome impresa (best effort)
    try {
      const impSnap = await db.collection("imprese_registrate").doc(emailImpresa).get();
      if (impSnap.exists) {
        const impData = impSnap.data() || {};
        impresaName = (
          impData.nome ||
          impData.nome_impresa ||
          impData.nomeImpresa ||
          impData.ragioneSociale ||
          impresaName ||
          ""
        ).toString().trim();
      }
    } catch (e) {}

    if (!impresaName) {
      impresaName =
        (necro.nomeImpresa ||
          necro.nome_impresa ||
          necro.impresaName ||
          (necro.answersSnapshot && (necro.answersSnapshot.nomeImpresa || necro.answersSnapshot.nome_impresa)) ||
          "").toString().trim();
    }
    if (!impresaName) impresaName = "Impresa OFI";

    const baseUrl = getBaseUrl();
    const publicUrl = `${baseUrl}/necrologio.html?id=${encodeURIComponent(necrologioId)}`;
    const downloadUrl = `${baseUrl}/locandina.html?id=${encodeURIComponent(necrologioId)}`;
    const dashUrl = `${baseUrl}/imprese/imprese-dashboard.html#necrologi`;

    const assetV = (process.env.OFI_ASSET_VERSION || "").toString().trim() || String(Math.floor(Date.now() / 86400000));
    const ofiLogoUrl = `${baseUrl}/images/logo-ofi.png?v=${encodeURIComponent(assetV)}`;
    const agenteOfiImageUrl = `${baseUrl}/images/agente-ofi.png?v=${encodeURIComponent(assetV)}`;

    const defuntoNomeCompleto = pickDefuntoNomeCompleto(necro);
    const safeName = String(defuntoNomeCompleto || "").replace(/\s+/g, " ").trim() || "Necrologio";
    const citta = pickCitta(necro);

    const when = fmtItDate(pickPublishedDate(necro));

    const supportEmail = (
      process.env.SUPPORT_EMAIL ||
      process.env.REPLY_TO ||
      process.env.ADMIN_REPLY_TO ||
      process.env.EE_FROM_EMAIL ||
      "support@onoranzefunebritalia.it"
    ).toString().trim();

    const subject = isUpdate
      ? `OFI — Necrologio aggiornato • ${safeName}`
      : `OFI — Necrologio pubblicato • ${safeName}`;

    const text = [
      "Onoranze Funebri Italia (OFI)",
      "",
      `Gentile ${impresaName},`,
      isUpdate
        ? `il necrologio di ${safeName} è stato aggiornato ed è già visibile pubblicamente su OFI.`
        : `il necrologio di ${safeName} è ora visibile pubblicamente su OFI.`,
      "",
      `+${punti} punti assegnati per ${isUpdate ? "l’aggiornamento" : "la pubblicazione"}.`,
      "",
      `Visualizza: ${publicUrl}`,
      `Locandina A4: ${downloadUrl}`,
      `Dashboard: ${dashUrl}`,
      "",
      `Supporto: ${supportEmail}`,
    ].join("\n");

    const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isUpdate ? "Aggiornamento" : "Pubblicazione"} completata – OFI</title></head>
<body style="margin:0;padding:0;background:#071a3a;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:26px 0;">
    <tr><td align="center" style="padding:0 10px;">
      <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;border-radius:18px;overflow:hidden;">
        <tr><td style="background:#c79a2e;height:6px;font-size:0;line-height:6px;">&nbsp;</td></tr>
        <tr><td style="background:#0b2a5b;padding:18px 22px;color:#fff;">
          <table role="presentation" width="100%"><tr>
            <td valign="middle" style="width:54px;padding-right:12px;">
              <table role="presentation" style="background:#fff;border-radius:12px;"><tr><td style="padding:6px 8px;border-radius:12px;">
                <img src="${ofiLogoUrl}" alt="OFI" width="42" style="display:block;border:0;width:42px;height:auto;">
              </td></tr></table>
            </td>
            <td valign="middle">
              <div style="font-size:12px;letter-spacing:1.2px;text-transform:uppercase;opacity:.92;">Onoranze Funebri Italia</div>
              <div style="font-size:18px;font-weight:900;margin-top:6px;">
                ${isUpdate ? "Aggiornamento completato" : "Pubblicazione completata"}
              </div>
            </td>
            <td align="right" valign="middle" style="font-size:12px;opacity:.9;">
              <div style="font-size:11px;opacity:.8;">RIF.</div>
              <div style="font-weight:900;">${escapeHtml(necrologioId)}</div>
            </td>
          </tr></table>
          <div style="margin-top:10px;color:#dfe8ff;font-size:13px;line-height:1.6;">
            Il necrologio di <strong>${escapeHtml(safeName)}</strong> è ${isUpdate ? "stato aggiornato" : "ora visibile"} pubblicamente.
          </div>
        </td></tr>

        <tr><td style="background:#eef2f8;padding:18px;">
          <table role="presentation" width="100%" style="background:#fff;border-radius:16px;padding:18px;">
            <tr><td style="color:#0f1f3a;font-size:14px;line-height:1.7;">
              Gentile <strong>${escapeHtml(impresaName)}</strong>,<br>
              ${isUpdate ? "l’aggiornamento è stato registrato e i link restano invariati." : "la pubblicazione è stata registrata e i materiali sono pronti."}
              <div style="margin-top:12px;padding:14px;border-radius:14px;background:#fff7e6;border:1px solid #f0d9a5;">
                <strong>+${escapeHtml(punti)} punti</strong> per ${isUpdate ? "l’aggiornamento" : "la pubblicazione"}.
              </div>

              <div style="margin-top:14px;font-size:13px;color:#22324b;">
                <div><strong>Defunto:</strong> ${escapeHtml(safeName)}</div>
                <div><strong>Città:</strong> ${escapeHtml(citta)}</div>
                <div><strong>Data/Ora:</strong> ${escapeHtml(when)}</div>
              </div>

              <div style="margin-top:16px;text-align:center;">
                <a href="${publicUrl}" style="display:inline-block;background:#0b2a5b;color:#fff;text-decoration:none;font-weight:900;padding:12px 16px;border-radius:12px;">
                  Visualizza necrologio
                </a>
                <div style="height:10px;"></div>
                <a href="${downloadUrl}" style="display:inline-block;background:#c79a2e;color:#0b1b33;text-decoration:none;font-weight:900;padding:12px 16px;border-radius:12px;">
                  Scarica locandina A4
                </a>
              </div>

              <div style="margin-top:14px;font-size:12px;color:#60708a;line-height:1.7;">
                Supporto OFI: <strong>${escapeHtml(supportEmail)}</strong><br>
                Se i pulsanti non funzionano, copia e incolla:<br>
                <span style="word-break:break-all;color:#0b2a5b;">${publicUrl}</span>
              </div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await sendElasticEmail({ to: emailImpresa, subject, html, text });

    const mailPatch = {
      lastAnySentAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAnySentOk: true,
      lastError: null,
      publicUrl,
      downloadUrl,
      dashUrl,
      impresaName,
      puntiAssegnati: punti,
      ofiLogoUrl,
      agenteOfiImageUrl,
      defuntoNomeCompleto: defuntoNomeCompleto || null,
      citta,
      whenText: when,
      lastAction: isUpdate ? "update" : "publish",
    };

    if (isUpdate) {
      mailPatch.lastUpdateSentAt = admin.firestore.FieldValue.serverTimestamp();
      mailPatch.lastUpdateSentOk = true;
    } else {
      mailPatch.lastPublishSentAt = admin.firestore.FieldValue.serverTimestamp();
      mailPatch.lastPublishSentOk = true;
    }

    await ref.set({ mail: mailPatch }, { merge: true });

    await db.collection("azioni_log").add({
      type: isUpdate ? "NECROLOGIO_AGGIORNATO_MAIL" : "NECROLOGIO_PUBBLICATO_MAIL",
      points: punti,
      emailImpresa,
      impresaName,
      necrologioId,
      publicUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source: "necrologioPostPublish",
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, action: isUpdate ? "update" : "publish", necrologioId, publicUrl, downloadUrl, dashUrl }),
    };
  } catch (e) {
    console.error("necrologioPostPublish error:", e?.message || e, e?.ee || "");

    try {
      initAdmin();
      const db = admin.firestore();
      if (necrologioIdForLog) {
        await db.collection("necrologi_pubblicati").doc(necrologioIdForLog).set(
          {
            mail: {
              lastAnySentAt: admin.firestore.FieldValue.serverTimestamp(),
              lastAnySentOk: false,
              lastError: String(e?.message || e),
              lastElasticDetails: e?.ee ? e.ee : null,
            },
          },
          { merge: true }
        );
      }
    } catch (_) {}

    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(e?.message || e), elastic: e?.ee || null }) };
  }
};
