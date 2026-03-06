// netlify/functions/chatVideoRicordo.js
// OFI - Agente Video Ricordo
// - mode: "plan" (default) → armonizza testo + genera EDL scegliendo clip da site/assets/video/video_assets.json
// Output: { ok, voiceover, onScreen[], tags[], musicMood, beats[], edl[] }

const fs = require("fs");
const path = require("path");

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const MODEL_PLAN = process.env.OPENAI_MODEL_VIDEO_PLAN || "gpt-4.1-mini";
  const MODEL_CHECK = process.env.OPENAI_MODEL_VIDEO_CHECK || "gpt-4.1-mini";

  if (!apiKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "OPENAI_API_KEY mancante" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "JSON non valido" }) };
  }

  const mode = (payload.mode || "plan").toString();

  // ===== Helpers: timeout (anti-504) =====
  const withTimeout = async (ms, fn) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(t);
    }
  };

  // ===== Helpers: guard semplici (spam/link/istruzioni) =====
  const looksLikeLinkOrSpam = (txt) => {
    const s = (txt || "").toLowerCase();
    if (!s.trim()) return false;
    if (s.includes("http://") || s.includes("https://") || s.includes("www.")) return true;
    if (s.includes("@") && s.includes(".")) return true;
    const spamWords = ["compra", "sconto", "offerta", "promo", "bitcoin", "casino", "onlyfans"];
    return spamWords.some((w) => s.includes(w));
  };

  const looksLikeInstruction = (txt) => {
    const s = (txt || "").toLowerCase().trim();
    if (!s) return false;
    const patterns = [
      "scrivi", "metti", "decidi tu", "fai tu", "inserisci", "una frase", "una citazione", "con autore",
      "crea un testo", "fammi", "generami", "prompt"
    ];
    return patterns.some((p) => s.includes(p));
  };

  const cleanUserText = (v) => (v || "").toString().trim().slice(0, 2200);

  // ===== Carica libreria clip da JSON =====
  function loadAssets() {
    const candidates = [
      path.join(process.cwd(), "site", "assets", "video", "video_assets.json"),
      path.join(process.cwd(), "assets", "video", "video_assets.json"),
    ];

    let raw = null;
    for (const p of candidates) {
      try {
        raw = fs.readFileSync(p, "utf8");
        break;
      } catch {}
    }

    if (!raw) return [];

    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  const assets = loadAssets();

  // ===== Selezione clip (regole semplici ma efficaci) =====
  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function filterAssetsByAtmosfera(atm) {
    const a = (atm || "").toString().trim().toLowerCase();
    if (!a) return assets;
    return assets.filter((x) => Array.isArray(x.atmosfera) && x.atmosfera.map(String).map(s => s.toLowerCase()).includes(a));
  }

  function pickClipsForDuration({ atmosfera, targetSec }) {
    const pool = filterAssetsByAtmosfera(atmosfera);
    const byType = (t) => pool.filter((x) => (x.type || "broll") === t);

    const introPool = byType("intro");
    const endingPool = byType("ending");
    const transitionPool = byType("transition");
    const brollPool = pool.filter((x) => ["broll", "transition", "intro", "ending"].includes((x.type || "broll")));

    // fallback se JSON è ancora piccolo
    const intro = introPool.length ? pickRandom(introPool) : (brollPool[0] || null);
    const ending = endingPool.length ? pickRandom(endingPool) : (brollPool[brollPool.length - 1] || null);

    const clips = [];
    let total = 0;

    if (intro) {
      clips.push(intro);
      total += Number(intro.dur || 7);
    }

    // Riempie con broll/transition fino a target
    const safetyMax = 30;
    let guard = 0;
    while (total < targetSec - 8 && guard < safetyMax && brollPool.length) {
      guard++;
      // ogni 3 clip prova a mettere una transition se disponibile
      let c = null;
      if (clips.length % 3 === 2 && transitionPool.length) c = pickRandom(transitionPool);
      if (!c) c = pickRandom(brollPool);

      // evita duplicati ravvicinati
      if (clips.length && clips[clips.length - 1]?.id === c?.id) continue;

      clips.push(c);
      total += Number(c.dur || 7);
    }

    if (ending && ending !== intro) {
      clips.push(ending);
      total += Number(ending.dur || 7);
    }

    return { clips, totalSec: total };
  }

  // ===== OpenAI call helper (chat.completions) =====
  const buildBody = ({ model, messages, jsonMode, maxTokens }) => {
    const body = {
      model,
      messages,
      temperature: 0.25,
      max_tokens: typeof maxTokens === "number" ? maxTokens : 900,
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    return body;
  };

  async function callOpenAI({ model, messages, jsonMode, maxTokens, timeoutMs }) {
    return await withTimeout(timeoutMs || 20000, async (signal) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildBody({ model, messages, jsonMode, maxTokens })),
        signal,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text}`);
      return JSON.parse(text);
    });
  }

  // ===== Mode: plan =====
  if (mode === "plan") {
    // Input atteso dal frontend
    const atmosfera = (payload.atmosfera || "luce").toString(); // luce | presenza | traccia | respiro
    const templateId = (payload.templateId || "ofi_sobrio_01").toString();

    const durataStimata = Number(payload.durataStimata || 90); // secondi desiderati (es. 70-120)
    const targetSec = Math.max(45, Math.min(140, durataStimata));

    const input = payload.input || {};
    const narrative = cleanUserText(input.narrative);
    const keyword = cleanUserText(input.keyword);
    const frase = cleanUserText(input.frase);

    // guard minimi
    const joined = [narrative, keyword, frase].join(" ");
    if (looksLikeLinkOrSpam(joined)) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, reason: "Testo non idoneo: link/spam non consentiti." }),
      };
    }

    // se l’utente scrive “scrivi tu…” dentro narrative, non blocchiamo: semplicemente lo ignoriamo nel prompt
    const safeNarrative = looksLikeInstruction(narrative) ? "" : narrative;
    const safeKeyword = looksLikeInstruction(keyword) ? "" : keyword;
    const safeFrase = looksLikeInstruction(frase) ? "" : frase;

    // 1) AI: armonizza + produce struttura
    const system = `
Sei "Agente OFI – Video Ricordo" (Italia). Tono: moderno, istituzionale, caldo ma sobrio.

ATMOSFERA DISPONIBILE: luce | presenza | traccia | respiro
ATMOSFERA SELEZIONATA: ${atmosfera}

OBIETTIVO:
- Creare un testo narrato (voiceover) elegante e scorrevole.
- Creare micro-frasi per sovraimpressioni (onScreen) brevi.
- Creare una scaletta (beats) in 4 sezioni con durata indicativa.
- Estrarre tag utili per selezione immagini/clip (tags).
- Scegliere un mood musica coerente (musicMood): "discreta" | "piano" | "archi_leggeri" | "ambient_soft"

VINCOLI IMPORTANTI:
- NON inventare fatti (nomi, date, luoghi, professione, parentele).
- Lavora SOLO su quanto fornito.
- Se info sono generiche, resta generico (es. "una presenza luminosa", "un ricordo che resta").
- Niente religiosità esplicita, niente frasi melodrammatiche.
- Italiano pulito, frasi corte, pause naturali.
- Durata target: ${targetSec} secondi circa (voiceover ~ ${Math.round(targetSec * 2.2)}–${Math.round(targetSec * 2.8)} caratteri).
- onScreen: 6–12 frasi, max 42 caratteri ciascuna, senza virgolette.

FORMATO RISPOSTA: SOLO JSON
{
  "voiceover": "string",
  "onScreen": ["..."],
  "beats": [
    {"id":"intro","sec":10,"hint":"..."},
    {"id":"vita","sec":30,"hint":"..."},
    {"id":"ricordo","sec":35,"hint":"..."},
    {"id":"chiusura","sec":15,"hint":"..."}
  ],
  "tags": ["..."],
  "musicMood": "discreta"
}
`;

    const user = `
DATI UTENTE (grezzi):
- narrative: ${safeNarrative || "(vuoto)"}
- keyword: ${safeKeyword || "(vuoto)"}
- frase: ${safeFrase || "(vuoto)"}

TemplateId: ${templateId}
Restituisci SOLO JSON.
`;

    let aiOut;
    try {
      // 1 retry rapido
      let r;
      try {
        r = await callOpenAI({
          model: MODEL_PLAN,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          jsonMode: true,
          maxTokens: 900,
          timeoutMs: 22000,
        });
      } catch (e1) {
        await new Promise((res) => setTimeout(res, 500));
        r = await callOpenAI({
          model: MODEL_PLAN,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          jsonMode: true,
          maxTokens: 900,
          timeoutMs: 22000,
        });
      }

      const content = r?.choices?.[0]?.message?.content || "{}";
      aiOut = JSON.parse(content);
    } catch (e) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, reason: "AI non disponibile. Riprova tra poco." }),
      };
    }

    const voiceover = (aiOut.voiceover || "").toString().trim();
    const onScreen = Array.isArray(aiOut.onScreen) ? aiOut.onScreen.map((s) => String(s || "").trim()).filter(Boolean) : [];
    const beats = Array.isArray(aiOut.beats) ? aiOut.beats : [];
    const tags = Array.isArray(aiOut.tags) ? aiOut.tags.map(String).map(s => s.trim()).filter(Boolean).slice(0, 14) : [];
    const musicMood = (aiOut.musicMood || "discreta").toString().trim();

    if (!voiceover) {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: false, reason: "Testo non generato." }) };
    }

    // 2) Clip selection da JSON
    const { clips, totalSec } = pickClipsForDuration({ atmosfera, targetSec });

    // 3) Crea EDL (overlay distribuiti)
    const edl = [];
    const overlays = onScreen.length ? onScreen : ["Nel tempo", "Con gratitudine", "Sempre vicino"];
    let overlayIdx = 0;

    for (const c of clips) {
      if (!c || !c.id || !c.url) continue;
      const dur = Number(c.dur || 7);
      const overlay = c.safeText === false ? "" : overlays[overlayIdx % overlays.length];
      overlayIdx++;

      edl.push({
        clipId: c.id,
        url: c.url,
        dur,
        type: c.type || "broll",
        overlay: overlay || "",
      });
    }

    // Se non hai ancora riempito video_assets.json → edl vuota: segnaliamo chiaramente
    if (!edl.length) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          reason: "Archivio clip non trovato o vuoto. Crea site/assets/video/video_assets.json con almeno 10 clip.",
        }),
      };
    }

    // Output finale
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        atmosfera,
        targetSec,
        totalSec,
        voiceover,
        onScreen,
        beats,
        tags,
        musicMood,
        edl,
        meta: { model: MODEL_PLAN },
      }),
    };
  }

  // Mode sconosciuta
  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({ ok: false, error: "mode non riconosciuta", allowed: ["plan"] }),
  };
};