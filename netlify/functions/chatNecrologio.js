// netlify/functions/chatNecrologio.js
// - mode: "segments"               → rielabora/normalizza singoli campi (JSON) (per necrologio AI avanzato)
// - mode: "finalize"               → riscrive SOLO il corpo narrativo (testo) e produce 3 varianti (per AI avanzato)
// - mode: "final_check"            → super revisione finale + ritorna ok/reason + sanitizedHtml (per pubblicazione)
// - mode: "proofread_tradizionale" → SOLO correzioni formali + blocco contenuti non idonei (per necrologio tradizionale)
// - mode: "image_check"            → moderazione immagine (URL) per foto necrologio
// ✅ NEW: mode: "publish_edit"      → verifica utente + verifica owner + final_check + scrive lastApprovedHtml su Firestore (Admin SDK)

const admin = require("firebase-admin");


const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

function initAdmin() {
  if (admin.apps.length) return;
  admin.initializeApp({
    credential: admin.credential.cert(__OFI_FIREBASE_SVC__),
  });
}

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;

  // Modelli (env)
  const MODEL_SEGMENTS = process.env.OPENAI_MODEL_SEGMENTS || "gpt-4.1-mini";
  const MODEL_FINALIZE = process.env.OPENAI_MODEL_FINALIZE || "gpt-4.1";
  const MODEL_CHECK = process.env.OPENAI_MODEL_CHECK || "gpt-4.1-mini";
  const MODEL_PROOFREAD = process.env.OPENAI_MODEL_PROOFREAD || "gpt-4.1-mini";
  // Moderation (immagini + testo)
  const MODEL_IMAGE_CHECK = process.env.OPENAI_MODEL_IMAGE_CHECK || "omni-moderation-latest";

  if (!apiKey) {
    console.error("OPENAI_API_KEY mancante nelle variabili Netlify");
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "OPENAI_API_KEY non configurata" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    console.error("Errore parse body:", err);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "JSON non valido" }),
    };
  }

  const mode = (payload.mode || "").toString();
  const draft = (payload.draft || "").toString();
  const tone = (payload.tone || "sobrio").toString();
  const structuredData = payload.structuredData || null;

  // NEW: oggi passato dal frontend (se non presente uso oggi server)
  const todayISO =
    payload.todayISO && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.todayISO))
      ? String(payload.todayISO)
      : new Date().toISOString().slice(0, 10);

  // Timeout anti-504
  const withTimeout = async (ms, fn) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(t);
    }
  };

  const buildChatBody = ({ model, messages, jsonMode, maxTokens }) => {
    const body = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: typeof maxTokens === "number" ? maxTokens : 900,
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    return body;
  };

  // =====================================================
  // Helper: “se sembra un’istruzione”
  // =====================================================
  const looksLikeInstruction = (txt) => {
    const s = (txt || "").toLowerCase().trim();
    if (!s) return false;
    const patterns = [
      "scrivi",
      "scrivila",
      "scrivilo",
      "scrivi per me",
      "pensaci tu",
      "fai tu",
      "decidi tu",
      "si metti",
      "sì metti",
      "metti",
      "inserisci",
      "una frase",
      "una cosa semplice",
      "una citazione",
      "con autore",
      "citazione famosa",
    ];
    return patterns.some((p) => s.includes(p));
  };

  // Helper rapidissimo anti-link/spam (prima ancora dell'AI)
  const looksLikeLinkOrSpam = (txt) => {
    const s = (txt || "").toLowerCase();
    if (!s.trim()) return false;
    if (s.includes("http://") || s.includes("https://") || s.includes("www.")) return true;
    if (s.includes("@") && s.includes(".")) return true; // email nel testo
    const spamWords = ["compra", "sconto", "offerta", "promo", "bitcoin", "guadagna", "casino", "onlyfans"];
    return spamWords.some((w) => s.includes(w));
  };

  const CLEAR_TOKEN = "__CLEAR__";
  const cleanFactual = (v) => (looksLikeInstruction(v) ? CLEAR_TOKEN : (v || "").toString());
  const keepCreative = (v) => (v || "").toString();

  // =====================================================
  // SANITIZE HTML (server-side, rapido e “prudente”)
  // =====================================================
  const sanitizeHtmlBasic = (html) => {
    let s = (html || "").toString();

    // Rimuovi script e style
    s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

    // Rimuovi attributi on* (onclick, onerror, ecc.)
    s = s.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
    s = s.replace(/\son\w+\s*=\s*[^ >]+/gi, "");

    // Blocca javascript: in href/src
    s = s.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, "");

    // Rimuovi tutti i link <a ...>...</a>
    s = s.replace(/<a\b[^>]*>/gi, "");
    s = s.replace(/<\/a>/gi, "");

    // Normalizza spazi
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");

    return s.trim();
  };

  // =====================================================
  // Helper: verifica token Firebase (per mode publish_edit)
  // =====================================================
  const verifyFirebaseUser = async () => {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    try {
      initAdmin();
      const decoded = await admin.auth().verifyIdToken(m[1]);
      return decoded; // { uid, email, ... }
    } catch (e) {
      return null;
    }
  };

  // =====================================================
  // Helper: FINAL_CHECK riusabile (usata da final_check e publish_edit)
  // =====================================================
  const runFinalCheck = async (htmlRaw) => {
    const htmlSanitized0 = sanitizeHtmlBasic(htmlRaw);

    const systemPromptCheck = `
Sei "Agente OFI - Super Revisione Finale" per necrologi (Italia).

DATA DI RIFERIMENTO (oggi): ${todayISO}

NOTA SULLE DATE:
- È normale che un necrologio contenga date FUTURE (es. funerale tra 1–15 giorni).
- NON bloccare un necrologio solo perché contiene una data futura.
- Considera "sospetto" solo se il testo sembra chiaramente finto/promozionale o contiene date future molto lontane (es. mesi/anni) INSIEME ad altri segnali di non idoneità.

Devi:
1) Valutare se il contenuto è PUBBLICABILE subito.
2) Se pubblicabile, restituisci anche un HTML "sanitizedHtml" (uguale all'input ma senza: link, spam, frasi da istruzione tipo "scrivi/metti", ripetizioni palesi).

FORMATO DI RISPOSTA (solo JSON):
{
  "ok": true/false,
  "reason": "..." ,
  "sanitizedHtml": "..."
}

REGOLE BLOCCO (ok=false) se trovi:
- volgarità, insulti, hate, minacce
- spam/promozioni/marketing/telefono ripetuto/numeri sospetti
- link o inviti a cliccare/contattare fuori contesto
- contenuti sessuali espliciti, violenza gratuita, o non coerenti con un necrologio
- testo che è chiaramente un prompt/istruzione (es: "scrivi una frase", "metti una citazione...") rimasto nel testo finale

REGOLE ok=true:
- testo coerente con necrologio (anche se semplice), senza elementi sopra.

VINCOLI:
- NON inventare nomi/date/luoghi.
- NON aggiungere informazioni nuove.
- "reason" max 140 caratteri, italiano.
- "sanitizedHtml": se ok=true deve essere valorizzato (può essere uguale all'input se già perfetto).
- Se ok=false, sanitizedHtml può essere vuoto "".
`;

    const userPromptCheck = `
HTML (già ripulito server-side):
"""${htmlSanitized0}"""
`;

    // ✅ robust call (timeout 25s + 1 retry)
    const callOpenAIOnce = async () => {
      // (Aumentato da 12000 → 25000)
      return await withTimeout(25000, async (signal) => {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildChatBody({
              model: MODEL_CHECK,
              messages: [
                { role: "system", content: systemPromptCheck },
                { role: "user", content: userPromptCheck },
              ],
              jsonMode: true,
              maxTokens: 650,
            })
          ),
          signal,
        });

        const text = await response.text();
        if (!response.ok) {
          // log utile: status e snippet
          console.warn("final_check OpenAI not ok:", response.status, text?.slice?.(0, 280) || text);
          throw new Error(`OpenAI final_check ${response.status}: ${text}`);
        }
        return JSON.parse(text);
      });
    };

    try {
      let result;
      try {
        result = await callOpenAIOnce();
      } catch (e1) {
        // Retry 1 volta
        await new Promise((r) => setTimeout(r, 600));
        result = await callOpenAIOnce();
      }

      const content = result?.choices?.[0]?.message?.content || "{}";

      let out = { ok: false, reason: "Verifica non riuscita.", sanitizedHtml: "" };

      try {
        const parsed = JSON.parse(content);
        out.ok = !!parsed.ok;
        out.reason = (parsed.reason || "").toString().trim();
        out.sanitizedHtml = (parsed.sanitizedHtml || "").toString().trim();
      } catch {
        out = { ok: false, reason: "Verifica non riuscita.", sanitizedHtml: "" };
      }

      // Hardening finale: sanitizedHtml passa SEMPRE dal sanitize base
      if (out.ok) {
        const safe = sanitizeHtmlBasic(out.sanitizedHtml || htmlSanitized0);
        out.sanitizedHtml = safe;
        if (!out.sanitizedHtml) {
          out.ok = false;
          out.reason = "Testo vuoto dopo la revisione.";
        }
      } else {
        if (!out.reason) out.reason = "Contenuto non idoneo.";
        out.sanitizedHtml = "";
      }

      return out;
    } catch (err) {
      console.warn("final_check timeout/errore:", err?.message || err);
      // Scelta OFI: se non posso controllare, NON pubblico.
      return { ok: false, reason: "Verifica non disponibile. Riprova tra poco.", sanitizedHtml: "" };
    }
  };

  // =====================================================
  // ✅ NEW MODE: PUBLISH_EDIT (AI check + write Firestore via Admin SDK)
  // payload: { mode:"publish_edit", necrologioId:"...", html:"..." }
  // headers: Authorization: Bearer <firebaseIdToken>
  // =====================================================
  if (mode === "publish_edit") {
    try {
      const decoded = await verifyFirebaseUser();
      if (!decoded?.uid) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, reason: "Non autorizzato. Effettua il login." }),
        };
      }

      const necrologioId = (payload.necrologioId || "").toString().trim();
      const htmlRaw = (payload.html || "").toString().trim();

      if (!necrologioId || !htmlRaw) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, reason: "Dati mancanti (necrologioId/html)." }),
        };
      }

      // 1) Leggi doc necrologio
      initAdmin();
      const db = admin.firestore();
      const ref = db.collection("necrologi_pubblicati").doc(necrologioId);
      const snap = await ref.get();

      if (!snap.exists) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, reason: "Necrologio non trovato." }),
        };
      }

      const data = snap.data() || {};
      const ownerUid = data.uidImpresa || data.uidCittadino || null;

      if (!ownerUid || ownerUid !== decoded.uid) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, reason: "Permessi insufficienti." }),
        };
      }

      // 2) AI check (final_check) sul contenuto completo
      const check = await runFinalCheck(htmlRaw);

      if (!check.ok) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, reason: check.reason || "Contenuto non idoneo." }),
        };
      }

      // 3) Scrivi su Firestore SOLO server-side (Admin SDK)
      const updates = {
  lastApprovedHtml: check.sanitizedHtml,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};

// ✅ salva anche snapshot e meta (se arrivano dal frontend)
if (payload.answersSnapshot && typeof payload.answersSnapshot === "object") {
  updates.answersSnapshot = payload.answersSnapshot;
}
if (payload.photoURL) {
  updates.photoURL = String(payload.photoURL);
  updates.foto = String(payload.photoURL); // compatibilità: alcune pagine leggono "foto"
}
if (payload.variantKey) updates.variantKey = String(payload.variantKey);
if (payload.ornamentKey) updates.ornamentKey = String(payload.ornamentKey);
if (payload.geoFinale) updates.geoFinale = payload.geoFinale;

await ref.update(updates);


      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          reason: "Modifica approvata e pubblicata.",
          sanitizedHtml: check.sanitizedHtml,
        }),
      };
    } catch (err) {
      console.error("publish_edit error:", err);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, reason: "Errore pubblicazione. Riprova." }),
      };
    }
  }

  // =====================================================
  // MODE: IMAGE_CHECK (moderazione immagine)
  // =====================================================
  if (mode === "image_check") {
    const imageUrl = (payload.imageUrl || "").toString().trim();
    if (!imageUrl) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "imageUrl mancante per image_check" }),
      };
    }

    if (!/^https?:\/\//i.test(imageUrl)) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, reason: "URL immagine non valido.", flagged: true }),
      };
    }

    try {
      const result = await withTimeout(12000, async (signal) => {
        const response = await fetch("https://api.openai.com/v1/moderations", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL_IMAGE_CHECK,
            input: [{ type: "image_url", image_url: { url: imageUrl } }],
          }),
          signal,
        });

        const text = await response.text();
        if (!response.ok) throw new Error(`OpenAI image_check ${response.status}: ${text}`);
        return JSON.parse(text);
      });

      const r0 = result?.results?.[0] || {};
      const flagged = !!r0.flagged;
      const categories = r0.categories || {};
      const categoryScores = r0.category_scores || {};

      if (flagged) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: false,
            reason: "Immagine non idonea per pubblicazione (verifica OFI).",
            flagged,
            categories,
            categoryScores,
          }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, reason: "OK", flagged, categories, categoryScores }),
      };
    } catch (err) {
      console.warn("image_check timeout/errore:", err?.message || err);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, reason: "Verifica immagine non disponibile. Riprova tra poco." }),
      };
    }
  }

  // =====================================================
  // MODE: PROOFREAD_TRADIZIONALE
  // =====================================================
  if (mode === "proofread_tradizionale") {
    const fields = payload.fields || {};
    if (!fields || typeof fields !== "object") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "fields mancante per proofread_tradizionale" }),
      };
    }

    for (const k of Object.keys(fields)) {
      const v = (fields[k] || "").toString();
      if (looksLikeLinkOrSpam(v)) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, reason: "Testo non idoneo: link/spam non consentiti.", corrected: {} }),
        };
      }
      if (looksLikeInstruction(v)) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: false,
            reason: "Testo non idoneo: presenti istruzioni invece di contenuto.",
            corrected: {},
          }),
        };
      }
    }

    const systemPromptProofread = `
Sei "Agente OFI – Correzione Tradizionale" (Italia).

Ricevi un oggetto JSON "fields" con testi scritti dall'utente per un necrologio TRADIZIONALE.
Devi fare SOLO:
- correggere refusi, grammatica, maiuscole/minuscole, punteggiatura, spazi doppi
- rendere le frasi più pulite MA SENZA cambiare il significato
- NON aggiungere contenuti nuovi
- NON inventare nulla
- NON cambiare nomi, date, orari, luoghi, indirizzi, numeri civici

BLOCCO (ok=false) se trovi:
- volgarità / insulti / odio / minacce
- spam / marketing / inviti a comprare / promozioni
- link (http/https/www) o email nel testo
- istruzioni rimaste nel testo tipo "scrivi", "metti", "decidi tu", "fai tu", "una cosa semplice" ecc.

Se ok=true restituisci i campi corretti, mantenendo le stesse chiavi.

FORMATO RISPOSTA (solo JSON):
{
  "ok": true/false,
  "reason": "max 140 caratteri, italiano",
  "corrected": { ...stesse chiavi di input... }
}

VINCOLI:
- Se un campo è vuoto, restituisci stringa vuota.
- Mantieni il più possibile le parole originali: correzioni minime.
- NESSUN HTML, solo testo.
`;

    const userPromptProofread = `fields:\n${JSON.stringify(fields)}`;

    try {
      const result = await withTimeout(12000, async (signal) => {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildChatBody({
              model: MODEL_PROOFREAD,
              messages: [
                { role: "system", content: systemPromptProofread },
                { role: "user", content: userPromptProofread },
              ],
              jsonMode: true,
              maxTokens: 900,
            })
          ),
          signal,
        });

        const text = await response.text();
        if (!response.ok) throw new Error(`OpenAI proofread ${response.status}: ${text}`);
        return JSON.parse(text);
      });

      const content = result?.choices?.[0]?.message?.content || "{}";

      let out = { ok: false, reason: "Verifica non riuscita.", corrected: {} };

      try {
        const parsed = JSON.parse(content);
        out.ok = !!parsed.ok;
        out.reason = (parsed.reason || "").toString().trim();
        out.corrected = parsed.corrected && typeof parsed.corrected === "object" ? parsed.corrected : {};
      } catch {
        out = { ok: false, reason: "Verifica non riuscita.", corrected: {} };
      }

      if (out.ok) {
        const corrected = {};
        for (const k of Object.keys(fields)) {
          const v = out.corrected?.[k];
          corrected[k] = typeof v === "string" ? v : (fields[k] || "").toString();

          if (looksLikeInstruction(corrected[k])) {
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({
                ok: false,
                reason: "Testo non idoneo: presenti istruzioni invece di contenuto.",
                corrected: {},
              }),
            };
          }
          if (looksLikeLinkOrSpam(corrected[k])) {
            return {
              statusCode: 200,
              headers: corsHeaders,
              body: JSON.stringify({ ok: false, reason: "Testo non idoneo: link/spam non consentiti.", corrected: {} }),
            };
          }
        }
        out.corrected = corrected;
        if (!out.reason) out.reason = "OK";
      } else {
        if (!out.reason) out.reason = "Contenuto non idoneo.";
        out.corrected = {};
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(out) };
    } catch (err) {
      console.warn("proofread_tradizionale timeout/errore:", err?.message || err);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, reason: "Proofread non disponibile, proseguo.", corrected: fields }),
      };
    }
  }

  // =====================================================
  // MODE: SEGMENTS
  // =====================================================
  if (mode === "segments") {
    if (!structuredData) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "structuredData mancante per mode=segments" }),
      };
    }

    const sd = JSON.parse(JSON.stringify(structuredData));

    const mustClear = {
      luogoSalma: looksLikeInstruction(sd?.rito?.luogoSalma),
      orariVisita: looksLikeInstruction(sd?.rito?.orariVisita),
      veglia: looksLikeInstruction(sd?.rito?.veglia),
      cremazioneCimitero: looksLikeInstruction(sd?.rito?.cremazioneCimitero),
    };

    if (sd?.rito?.luogoSalma && mustClear.luogoSalma) sd.rito.luogoSalma = "";
    if (sd?.rito?.orariVisita && mustClear.orariVisita) sd.rito.orariVisita = "";
    if (sd?.rito?.veglia && mustClear.veglia) sd.rito.veglia = "";
    if (sd?.rito?.cremazioneCimitero && mustClear.cremazioneCimitero) sd.rito.cremazioneCimitero = "";

    if (sd?.strutturaTesto) {
      sd.strutturaTesto.citazione = keepCreative(sd.strutturaTesto.citazione);
      sd.strutturaTesto.fraseApertura = keepCreative(sd.strutturaTesto.fraseApertura);
      sd.strutturaTesto.fraseRicordo = keepCreative(sd.strutturaTesto.fraseRicordo);
      sd.strutturaTesto.fraseRingraziamentoFinale = keepCreative(sd.strutturaTesto.fraseRingraziamentoFinale);
      sd.strutturaTesto.ringraziamentiAssistenza = keepCreative(sd.strutturaTesto.ringraziamentiAssistenza);
      sd.strutturaTesto.chiAnnuncia = (sd.strutturaTesto.chiAnnuncia || "").toString();
    }

    if (sd?.rito) {
      sd.rito.luogoSalma = cleanFactual(sd.rito.luogoSalma);
      sd.rito.orariVisita = cleanFactual(sd.rito.orariVisita);
      sd.rito.veglia = cleanFactual(sd.rito.veglia);
      sd.rito.cremazioneCimitero = cleanFactual(sd.rito.cremazioneCimitero);
    }

    const systemPrompt = `
Sei l'Agente OFI, assistente editoriale per necrologi di Onoranze Funebri Italia.

Ricevi "structuredData" con campi testuali.
Devi restituire SOLO questo JSON:

{
  "segments": {
    "citazione": "",
    "fraseApertura": "",
    "chiAnnuncia": "",
    "luogoSalma": "",
    "orariVisita": "",
    "veglia": "",
    "cremazioneCimitero": "",
    "fraseRicordo": "",
    "ringraziamentiAssistenza": "",
    "fraseRingraziamentoFinale": ""
  }
}

REGOLE:
- Mantieni intatti nomi, date, orari, luoghi, indirizzi presenti.
- Non aggiungere informazioni FATTUALI mancanti.
- 1–2 frasi per campo. Nessun a capo nei campi.
- Se un campo è vuoto → restituisci "".
- Se datiPersona.vedIn è presente (es. "ved. Bianchi" / "in Bianchi"), considera la persona FEMMINILE.
  Quindi, nelle frasi generiche usa "mancata" / "cara".
- Se non ci sono indizi certi sul genere, usa formule NEUTRE (es. "Ci ha lasciato.").

GESTIONE “ISTRUZIONI” (solo per campi creativi):
- Se citazione / fraseApertura / fraseRicordo / ringraziamentiAssistenza / fraseRingraziamentoFinale contengono richieste tipo
  "scrivi...", "metti...", "una cosa semplice..."
  allora genera tu un testo breve coerente, senza inventare fatti.

REGOLA APERTURA:
- "fraseApertura" deve essere SEMPRE generica e NON deve contenere nome/cognome/età/ved./in.

REGOLA CITAZIONE:
- Se è una richiesta → crea citazione originale max 160 caratteri, senza autore reale.
- Se cita un autore → NON attribuire, firma come "— OFI".

TONO: sobrio / affettuoso / molto_sobrio.
`;

    const userPrompt = `Tono richiesto: ${tone}\nstructuredData:\n${JSON.stringify(sd)}\nRestituisci SOLO il JSON.`;

    try {
      const result = await withTimeout(12000, async (signal) => {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildChatBody({
              model: MODEL_SEGMENTS,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              jsonMode: true,
              maxTokens: 750,
            })
          ),
          signal,
        });

        const text = await response.text();
        if (!response.ok) throw new Error(`OpenAI segments ${response.status}: ${text}`);
        return JSON.parse(text);
      });

      const content = result?.choices?.[0]?.message?.content || "{}";

      let segments = {};
      try {
        const parsed = JSON.parse(content);
        if (parsed?.segments) segments = parsed.segments;
      } catch {
        segments = {};
      }

      // Applica forzature mustClear (se qualcuno ha scritto “scrivi…” in un campo fattuale)
      if (mustClear.luogoSalma) segments.luogoSalma = CLEAR_TOKEN;
      if (mustClear.orariVisita) segments.orariVisita = CLEAR_TOKEN;
      if (mustClear.veglia) segments.veglia = CLEAR_TOKEN;
      if (mustClear.cremazioneCimitero) segments.cremazioneCimitero = CLEAR_TOKEN;

      // CLEAR_TOKEN → ""
      for (const k of Object.keys(segments)) {
        if (segments[k] === CLEAR_TOKEN) segments[k] = "";
        if (typeof segments[k] !== "string") segments[k] = (segments[k] ?? "").toString();
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, segments }),
      };
    } catch (err) {
      console.error("segments error:", err);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, segments: {} }),
      };
    }
  }

  // =====================================================
  // MODE: FINALIZE (testo narrativo completo + 3 varianti)
  // =====================================================
  if (mode === "finalize") {
    if (!draft) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "draft mancante per finalize" }),
      };
    }

    const systemPromptFinalize = `
Sei "Agente OFI – Redazione Necrologio Finale".

Ricevi un testo narrativo di necrologio.
Devi:
- migliorare stile, fluidità, sobrietà
- NON aggiungere fatti, nomi, date, luoghi
- mantenere contenuto coerente e rispettoso

Restituisci SOLO JSON:

{
  "versioni": [
    { "id": 1, "titolo": "Sobrio", "html": "..." },
    { "id": 2, "titolo": "Affettuoso", "html": "..." },
    { "id": 3, "titolo": "Molto sobrio", "html": "..." }
  ]
}

REGOLE:
- HTML semplice (<p>, <strong>, <em>)
- NESSUN link
- NESSUNA invenzione
`;

    try {
      const result = await withTimeout(12000, async (signal) => {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildChatBody({
              model: MODEL_FINALIZE,
              messages: [
                { role: "system", content: systemPromptFinalize },
                { role: "user", content: draft },
              ],
              jsonMode: true,
              maxTokens: 1200,
            })
          ),
          signal,
        });

        const text = await response.text();
        if (!response.ok) throw new Error(`OpenAI finalize ${response.status}: ${text}`);
        return JSON.parse(text);
      });

      const content = result?.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      // hardening: sanitize delle html
      if (Array.isArray(parsed?.versioni)) {
        parsed.versioni = parsed.versioni.map((v) => ({
          ...v,
          html: sanitizeHtmlBasic(v?.html || ""),
        }));
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(parsed),
      };
    } catch (err) {
      console.error("finalize error:", err);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Finalize non riuscito" }),
      };
    }
  }

  // =====================================================
  // MODE: FINAL_CHECK (standalone)
  // =====================================================
  if (mode === "final_check") {
    if (!draft) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "draft mancante per final_check" }),
      };
    }

    const check = await runFinalCheck(draft);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(check),
    };
  }

  // =====================================================
  // MODE sconosciuto
  // =====================================================
  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({
      error: "mode non riconosciuta",
      allowedModes: ["segments", "finalize", "final_check", "proofread_tradizionale", "image_check", "publish_edit"],
    }),
  };
};
