// netlify/functions/videoVoiceover.js
// OFI — Genera voce narrante (preview/final) con ElevenLabs
// Input: { luogoId, videoId, mode:"preview"|"final", force?:boolean }
// Auth: Firebase ID Token (Bearer)

const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return;

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_STORAGE_BUCKET,
  } = process.env;

  const pk = (FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !pk) {
    throw new Error(
      "Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY."
    );
  }

  const init = {
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: pk,
    }),
  };

  if (FIREBASE_STORAGE_BUCKET) init.storageBucket = FIREBASE_STORAGE_BUCKET;
  admin.initializeApp(init);
}

function mustPost(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  return null;
}

// (Opzionale ma consigliato) verifica token Firebase
async function requireAuth(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, error: "Missing Authorization Bearer token." };

  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return { ok: true, uid: decoded.uid };
  } catch (e) {
    return { ok: false, error: "Invalid token." };
  }
}

/**
 * Trucco OFI (anti-teatro):
 * - spezza frasi lunghe
 * - introduce “respiro” reale (doppi a-capo tra frasi)
 * - micro-pause dopo virgole (", … ")
 * - normalizza simboli/virgolette
 */
function prepareTtsText(raw) {
  let t = String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/["“”]/g, '"')
    .trim();

  if (!t) return "";

  const maxLen = 190;
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);

  const out = [];
  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;

    if (s.length <= maxLen) {
      out.push(s);
      continue;
    }

    // prova a spezzare su ";", ":" o "," mantenendo naturalezza
    const chunks = s.split(/([;:])\s+|,\s+/).filter(Boolean);
    let buf = "";
    for (const c of chunks) {
      const piece = String(c).trim();
      if (!piece) continue;

      // evita che separatori soli finiscano come frasi
      if (piece === ";" || piece === ":") {
        buf = (buf + piece).trim();
        continue;
      }

      if ((buf + " " + piece).trim().length > maxLen) {
        if (buf) out.push(buf.trim() + "…");
        buf = piece;
      } else {
        buf = (buf ? buf + ", " + piece : piece);
      }
    }
    if (buf) out.push(buf.trim() + (/[.!?]$/.test(buf.trim()) ? "" : "…"));
  }

  // ✅ TRUCCO: respiro reale + micro pause
  let finalText = out.join("\n\n");
  finalText = finalText.replace(/\s*\.\.\.\s*/g, "… ");
  finalText = finalText.replace(/\s+…/g, "…");
  finalText = finalText.replace(/,\s+/g, ", … ");

  // pulizia newlines/spazi
  finalText = finalText.replace(/[ ]+\n/g, "\n");
  finalText = finalText.replace(/\n{3,}/g, "\n\n");
  finalText = finalText.replace(/\s+/g, " ").replace(/\s*\n\s*/g, "\n\n").trim();

  return finalText;
}

// Estrae 2 frasi (o maxChars) per “voce di prova”
function makePreviewText(fullText, maxChars = 450) {
  const t = prepareTtsText(fullText);
  if (!t) return "";

  const parts = t
    .split(/(?<=[.!?…])\s+|\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);

  let out = parts.slice(0, 2).join(" ").trim();
  if (!out) out = t.slice(0, maxChars).trim();
  if (out.length > maxChars) out = out.slice(0, maxChars).trim();
  if (!/[.!?…]$/.test(out)) out = out + "…";
  return out;
}

async function elevenlabsTTS({ text }) {
  const apiKey = (process.env.ELEVENLABS_API_KEY || "").trim();
  const voiceId = (process.env.ELEVENLABS_VOICE_ID || "").trim();

  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY env var.");
  if (!voiceId) throw new Error("Missing ELEVENLABS_VOICE_ID env var.");

  const input = prepareTtsText(text);
  if (!input) throw new Error("Empty TTS text.");

  // Impostazioni consigliate per OFI (calda, naturale, non teatrale)
  const payload = {
    text: input,
    model_id: "eleven_multilingual_v2", // ottimo per IT
    voice_settings: {
      stability: 0.65,
      similarity_boost: 0.75,
      style: 0.35,
      use_speaker_boost: true,
    },
  };

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ElevenLabs TTS error ${res.status}: ${t}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

exports.handler = async (event) => {
  try {
    const bad = mustPost(event);
    if (bad) return bad;

    initAdmin();

    const auth = await requireAuth(event);
    if (!auth.ok) return { statusCode: 401, body: auth.error };

    const db = admin.firestore();
    const bucket = process.env.FIREBASE_STORAGE_BUCKET
      ? admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET)
      : admin.storage().bucket();

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: "Invalid JSON body." };
    }

    const { luogoId, videoId, mode = "preview", force = false } = body;

    if (!luogoId || !videoId) return { statusCode: 400, body: "Missing luogoId/videoId." };
    if (!["preview", "final"].includes(mode)) return { statusCode: 400, body: "Invalid mode." };

    const ref = db.collection("luoghi_memoria").doc(luogoId).collection("videos").doc(videoId);
    const snap = await ref.get();
    if (!snap.exists) return { statusCode: 404, body: "Video doc not found." };

    const data = snap.data() || {};

    // Permesso minimo: deve essere custode (proprietario del video)
    if (data.custodeUid && data.custodeUid !== auth.uid) {
      return { statusCode: 403, body: "Not allowed." };
    }

    const voTextFull =
      (data.plan && typeof data.plan.voText === "string" ? data.plan.voText : "") ||
      (typeof data.scriptGenerato === "string" ? data.scriptGenerato : "") ||
      (typeof data.script === "string" ? data.script : "");

    if (!voTextFull || voTextFull.trim().length < 30) {
      return { statusCode: 400, body: "Missing/short voice text (plan.voText or scriptGenerato)." };
    }

    const isPreview = mode === "preview";
    const text = isPreview ? makePreviewText(voTextFull) : prepareTtsText(voTextFull);

    // ✅ cache: se preview già presente, ritorna SOLO se non force
    if (isPreview && !force && data.voicePreview && data.voicePreview.storageRef) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, mode: "preview", voicePreview: data.voicePreview }),
      };
    }

    // stato job
    await ref.set(
      {
        job: {
          step: isPreview ? "voice_preview" : "voice",
          progress: 10,
          message: isPreview ? "Genero voce di prova…" : "Genero voce narrante…",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const audio = await elevenlabsTTS({ text });

    await ref.set(
      {
        job: {
          step: isPreview ? "voice_preview" : "voice",
          progress: 70,
          message: "Salvo audio…",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const storageRef = isPreview
      ? `luoghi_memoria/${luogoId}/videos/${videoId}/voice_preview.mp3`
      : `luoghi_memoria/${luogoId}/videos/${videoId}/voice.mp3`;

    const file = bucket.file(storageRef);

    await file.save(audio, {
      contentType: "audio/mpeg",
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000" },
    });

    // Signed URL (7 giorni)
    let url = null;
    try {
      const [signedUrl] = await file.getSignedUrl({
        action: "read",
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
      });
      url = signedUrl;
    } catch {
      url = null;
    }

    const patch = isPreview
      ? { voicePreview: { storageRef, url } }
      : { voice: { storageRef, url }, status: "voiced" };

    await ref.set(
      {
        ...patch,
        job: {
          step: isPreview ? "voice_preview" : "voice",
          progress: 100,
          message: isPreview ? "Voce di prova pronta." : "Voce pronta.",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        mode,
        ...(isPreview ? { voicePreview: { storageRef, url } } : { voice: { storageRef, url } }),
      }),
    };
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(e?.message || e) }),
    };
  }
};