// netlify/functions/filmatoScript.js
// OFI — Genera script armonizzato per Filmato Commemorativo
// Input:
// {
//   character, passions, expectation, memory,
//   atmosfera, templateId, musica, durata
// }
// Output:
// {
//   ok:true,
//   script:"...",
//   voText:"...",
//   hasTextOverlay:true/false,
//   overlayLines:["...", "..."]
// }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function safeStr(v) {
  return String(v ?? "").trim();
}

function normalizeText(v) {
  return safeStr(v).replace(/\s+/g, " ").trim();
}

function looksLikeLinkOrSpam(txt) {
  const s = normalizeText(txt).toLowerCase();
  if (!s) return false;
  if (s.includes("http://") || s.includes("https://") || s.includes("www.")) return true;
  if (s.includes("@") && s.includes(".")) return true;

  const spamWords = [
    "compra",
    "sconto",
    "offerta",
    "promo",
    "bitcoin",
    "casino",
    "onlyfans",
    "guadagna",
    "clicca qui"
  ];
  return spamWords.some((w) => s.includes(w));
}

function fallbackScriptFromFields({ character, passions, expectation, memory }) {
  const parts = [];

  if (character) {
    parts.push(`Lo ricordiamo per il suo modo di essere: ${character}.`);
  }

  if (passions) {
    parts.push(`Nei suoi giorni vivevano passioni e gesti che parlavano di lui: ${passions}.`);
  }

  if (memory) {
    parts.push(`Resta un ricordo che continua ad accompagnare il tempo: ${memory}.`);
  }

  if (expectation) {
    parts.push(`Questo filmato nasce con un desiderio semplice e autentico: ${expectation}.`);
  }

  if (!parts.length) {
    return "Un ricordo composto, custodito con delicatezza. Nel tempo, con gratitudine.";
  }

  parts.push("Nel tempo, con gratitudine.");
  return parts.join(" ");
}

function makeOverlayLines({ expectation, memory, character }) {
  const lines = [];

  if (expectation) lines.push(expectation);
  if (memory) lines.push(memory);
  if (character && lines.length < 2) lines.push(character);

  const cleaned = lines
    .map((x) => normalizeText(x))
    .filter(Boolean)
    .map((x) => x.length > 90 ? x.slice(0, 87).trim() + "…" : x);

  return cleaned.slice(0, 2);
}

async function withTimeout(ms, fn) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: corsHeaders, body: "" };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Method not allowed" }),
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing OPENAI_API_KEY" }),
      };
    }

    const MODEL = process.env.OPENAI_MODEL_SEGMENTS || "gpt-4.1-mini";

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Invalid JSON" }),
      };
    }

    const character   = normalizeText(payload.character);
    const passions    = normalizeText(payload.passions);
    const expectation = normalizeText(payload.expectation);
    const memory      = normalizeText(payload.memory);

    const atmosfera = normalizeText(payload.atmosfera);
    const templateId = normalizeText(payload.templateId);
    const musica = normalizeText(payload.musica);
    const durata = Number(payload.durata) || 110;

    const combined = [character, passions, expectation, memory].filter(Boolean).join(" ");

    if (looksLikeLinkOrSpam(combined)) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Testo non idoneo (link/spam)." }),
      };
    }

    if (!combined) {
      const script = "Un ricordo composto, custodito con delicatezza. Nel tempo, con gratitudine.";
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          script,
          voText: script,
          hasTextOverlay: true,
          overlayLines: ["Un ricordo composto", "Nel tempo, con gratitudine"],
        }),
      };
    }

    const system = `
Sei Agente OFI.
Devi armonizzare testi per un filmato commemorativo OFI.

OBIETTIVO:
- creare un testo breve, sobrio, elegante, umano, contemporaneo
- NON enfatico, NON teatrale, NON religioso se non richiesto
- NON usare formule retoriche pesanti
- far percepire autenticità e delicatezza

VINCOLI:
- usa solo le informazioni presenti nei campi
- non inventare nomi, luoghi, date, episodi
- evita cliché come "mancherai per sempre", "non ti dimenticheremo mai", "angelo", "lassù"
- evita frasi troppo cupe o troppo sentimentali
- massimo 4-6 frasi
- massimo circa 650 caratteri
- chiusura composta e discreta
- italiano naturale

IMPORTANTE:
- devi produrre un testo adatto sia a voce narrante sia a eventuali testi video
- se i contenuti dell’utente sono brevi o imperfetti, rendili fluidi ma fedeli
- tono: istituzionale, caldo, essenziale

RISPOSTA:
restituisci SOLO JSON con questa forma:
{
  "script": "...",
  "voText": "...",
  "hasTextOverlay": true,
  "overlayLines": ["...", "..."]
}
`;

    const user = `
DATI WIZARD OFI
- carattere/persona: """${character}"""
- passioni/gesti/abitudini: """${passions}"""
- cosa ti aspetti dal filmato: """${expectation}"""
- ricordo/frase personale: """${memory}"""
- atmosfera: "${atmosfera || "—"}"
- templateId: "${templateId || "—"}"
- musica: "${musica || "—"}"
- durata stimata: ${durata}

ISTRUZIONI SPECIFICHE:
- "script" e "voText" possono coincidere, ma devono essere molto naturali da ascoltare
- "overlayLines" deve contenere massimo 2 frasi brevi, eleganti, leggibili a schermo
- se non ci sono frasi adatte per overlay, sintetizza con misura
`;

    const callOpenAI = async (signal) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.35,
          max_tokens: 500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system.trim() },
            { role: "user", content: user.trim() },
          ],
        }),
        signal,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text}`);

      const json = JSON.parse(text);
      const content = json?.choices?.[0]?.message?.content || "{}";
      return JSON.parse(content);
    };

    let out;
    try {
      out = await withTimeout(25000, callOpenAI);
    } catch (e1) {
      await new Promise((r) => setTimeout(r, 700));
      try {
        out = await withTimeout(25000, callOpenAI);
      } catch (e2) {
        const fallback = fallbackScriptFromFields({ character, passions, expectation, memory });
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: true,
            script: fallback,
            voText: fallback,
            hasTextOverlay: true,
            overlayLines: makeOverlayLines({ expectation, memory, character }),
            fallback: true,
          }),
        };
      }
    }

    let script = normalizeText(out?.script);
    let voText = normalizeText(out?.voText) || script;
    let hasTextOverlay = Boolean(out?.hasTextOverlay);
    let overlayLines = Array.isArray(out?.overlayLines)
      ? out.overlayLines.map((x) => normalizeText(x)).filter(Boolean).slice(0, 2)
      : [];

    if (!script) {
      script = fallbackScriptFromFields({ character, passions, expectation, memory });
    }
    if (!voText) voText = script;

    if (looksLikeLinkOrSpam(script) || looksLikeLinkOrSpam(voText)) {
      script = fallbackScriptFromFields({ character, passions, expectation, memory });
      voText = script;
    }

    if (!overlayLines.length) {
      overlayLines = makeOverlayLines({ expectation, memory, character });
    }

    if (!overlayLines.length) {
      overlayLines = ["Un ricordo custodito con delicatezza"];
    }

    if (typeof out?.hasTextOverlay !== "boolean") {
      hasTextOverlay = true;
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        script,
        voText,
        hasTextOverlay,
        overlayLines,
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: false,
        error: e?.message || "Internal error",
      }),
    };
  }
};