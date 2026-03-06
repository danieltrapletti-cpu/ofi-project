// netlify/functions/videoPreviewRender.js
// OFI — Crea una preview video reale (10-15s) con watermark
// Input: { luogoId, videoId }
// Auth: Firebase ID Token (Bearer)

const admin = require("firebase-admin");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { spawn } = require("child_process");
let ffmpegPath = null;
let ffprobePath = null;

try {
  ffmpegPath = require("ffmpeg-static");
} catch (e) {
  console.error("Unable to require ffmpeg-static:", e);
}

try {
  ffprobePath = require("ffprobe-static").path;
} catch (e) {
  console.error("Unable to require ffprobe-static:", e);
}

console.log("ffmpegPath:", ffmpegPath);
console.log("ffprobePath:", ffprobePath);
console.log("ffmpeg exists:", !!ffmpegPath && existsSync(ffmpegPath));
console.log("ffprobe exists:", !!ffprobePath && existsSync(ffprobePath));

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
    throw new Error("Missing Firebase env vars.");
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

function json(headers, statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function mustPost(event) {
  if (event.httpMethod !== "POST") {
    return json({}, 405, { ok: false, error: "Method not allowed" });
  }
  return null;
}

async function requireAuth(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, error: "Missing Authorization Bearer token." };

  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, error: "Invalid token." };
  }
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function ffEscapeText(v) {
  return safeStr(v)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, " ");
}

function pickPreviewMedia(data) {
  // priorità:
  // 1) immagini array salvato dal wizard
  // 2) selectedMedia array
  // 3) selectedMedia object map
  const out = [];

  if (Array.isArray(data?.immagini)) {
    for (const m of data.immagini) {
      if (!m || !m.url) continue;
      out.push({
        id: safeStr(m.id),
        url: safeStr(m.url),
        type: safeStr(m.type || "photo").toLowerCase(),
        mime: safeStr(m.mime || ""),
        caption: safeStr(m.caption || ""),
        storageRef: safeStr(m.storageRef || ""),
      });
    }
  } else if (Array.isArray(data?.selectedMedia)) {
    for (const m of data.selectedMedia) {
      if (!m || !m.url) continue;
      out.push({
        id: safeStr(m.id),
        url: safeStr(m.url),
        type: safeStr(m.type || "photo").toLowerCase(),
        mime: safeStr(m.mime || ""),
        caption: safeStr(m.caption || ""),
        storageRef: safeStr(m.storageRef || ""),
      });
    }
  } else if (data?.selectedMedia && typeof data.selectedMedia === "object") {
    for (const [id, m] of Object.entries(data.selectedMedia)) {
      if (!m || !m.url) continue;
      out.push({
        id: safeStr(id),
        url: safeStr(m.url),
        type: safeStr(m.type || "photo").toLowerCase(),
        mime: safeStr(m.mime || ""),
        caption: safeStr(m.caption || ""),
        storageRef: safeStr(m.storageRef || ""),
      });
    }
  }

  const normalized = out.filter((m) => {
    if (!m.url) return false;
    return m.type === "photo" || m.type === "clip";
  });

  // massimo 5 media per preview
  return normalized.slice(0, 5);
}

async function updateJob(ref, step, progress, message) {
  await ref.set(
    {
      job: {
        step,
        progress,
        message,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });

    let stdout = "";
    let stderr = "";

    p.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    p.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    p.on("error", reject);

    p.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code})\n${stderr || stdout}`));
      }
    });
  });
}

async function ffprobeDuration(filePath) {
  const { stdout } = await run(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  const n = Number(String(stdout || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function downloadToFile(bucket, media, outPath) {
  if (media.storageRef) {
    await bucket.file(media.storageRef).download({ destination: outPath });
    return outPath;
  }

  const res = await fetch(media.url);
  if (!res.ok) {
    throw new Error(`Unable to fetch media URL: ${media.url}`);
  }
  const ab = await res.arrayBuffer();
  await fs.writeFile(outPath, Buffer.from(ab));
  return outPath;
}

async function downloadVoiceIfAny(bucket, data, outPath) {
  const voiceStorageRef = safeStr(data?.voice?.storageRef);
  if (!voiceStorageRef) return null;

  try {
    await bucket.file(voiceStorageRef).download({ destination: outPath });
    return outPath;
  } catch {
    return null;
  }
}

async function signedUrl(file, days = 7) {
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * days,
  });
  return url;
}

function buildFilterComplex(mediaInputs, overlayLines, totalDuration, audioInputIndex) {
  const parts = [];
  const concatLabels = [];
  const fps = 25;
  const W = 1280;
  const H = 720;

  for (let i = 0; i < mediaInputs.length; i++) {
    const item = mediaInputs[i];
    const inputIndex = i;
    const label = `v${i}`;

    if (item.type === "photo") {
      const frames = Math.max(1, Math.round(item.duration * fps));

      parts.push(
        `[${inputIndex}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},` +
          `trim=duration=${item.duration.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[${label}]`
      );
    } else {
      const start = Math.max(0, item.startAt || 0);
      parts.push(
        `[${inputIndex}:v]trim=start=${start.toFixed(3)}:duration=${item.duration.toFixed(3)},` +
          `setpts=PTS-STARTPTS,` +
          `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${fps},format=yuv420p[${label}]`
      );
    }

    concatLabels.push(`[${label}]`);
  }

  parts.push(
    `${concatLabels.join("")}concat=n=${mediaInputs.length}:v=1:a=0[basev]`
  );

  const watermarkText = ffEscapeText("Anteprima protetta OFI");
  const overlay1 = ffEscapeText(overlayLines[0] || "");
  const overlay2 = ffEscapeText(overlayLines[1] || "");

  let videoChain = "[basev]";

  // watermark basso a destra
  videoChain +=
    `drawbox=x=w-360:y=h-72:w=330:h=44:color=black@0.42:t=fill,` +
    `drawtext=text='${watermarkText}':x=w-340:y=h-44:fontsize=22:fontcolor=white@0.92,`;

  // testo centrale discreto nei primi secondi
  if (overlay1) {
    videoChain +=
      `drawbox=x=80:y=h-160:w=w-160:h=82:color=black@0.22:t=fill:enable='between(t,0,5.5)',` +
      `drawtext=text='${overlay1}':x=(w-text_w)/2:y=h-128:fontsize=30:fontcolor=white@0.96:enable='between(t,0,5.5)',`;
  }

  if (overlay2) {
    videoChain +=
      `drawtext=text='${overlay2}':x=(w-text_w)/2:y=h-90:fontsize=24:fontcolor=white@0.88:enable='between(t,0.4,5.5)',`;
  }

  videoChain += "format=yuv420p[vout]";
  parts.push(videoChain);

  if (typeof audioInputIndex === "number") {
    parts.push(
      `[${audioInputIndex}:a]atrim=duration=${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`
    );
  }

  return parts.join(";");
}

exports.handler = async (event) => {
  let tmpDir = null;

  try {
    const bad = mustPost(event);
    if (bad) return bad;

    if (!ffmpegPath || !existsSync(ffmpegPath)) {
      return json({}, 500, {
        ok: false,
        error: "ffmpeg-static non disponibile. Installa ffmpeg-static.",
      });
    }

    if (!ffprobePath || !existsSync(ffprobePath)) {
      return json({}, 500, {
        ok: false,
        error: "ffprobe-static non disponibile. Installa ffprobe-static.",
      });
    }

    initAdmin();

    const auth = await requireAuth(event);
    if (!auth.ok) {
      return json({}, 401, { ok: false, error: auth.error });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json({}, 400, { ok: false, error: "Invalid JSON body." });
    }

    const luogoId = safeStr(body.luogoId);
    const videoId = safeStr(body.videoId);

    if (!luogoId || !videoId) {
      return json({}, 400, { ok: false, error: "Missing luogoId/videoId." });
    }

    const db = admin.firestore();
    const bucket = process.env.FIREBASE_STORAGE_BUCKET
      ? admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET)
      : admin.storage().bucket();

    const ref = db.collection("luoghi_memoria").doc(luogoId).collection("videos").doc(videoId);
    const snap = await ref.get();

    if (!snap.exists) {
      return json({}, 404, { ok: false, error: "Video doc not found." });
    }

    const data = snap.data() || {};

    if (data.custodeUid && data.custodeUid !== auth.uid) {
      return json({}, 403, { ok: false, error: "Not allowed." });
    }

    const voiceEnabled = !!data?.options?.voiceEnabled;
    const overlayLines = Array.isArray(data?.plan?.overlayLines)
      ? data.plan.overlayLines.map((x) => safeStr(x)).filter(Boolean).slice(0, 2)
      : [];

    const picked = pickPreviewMedia(data);
    if (!picked.length) {
      return json({}, 400, { ok: false, error: "No preview media available." });
    }

    await updateJob(ref, "preview_render", 8, "Preparo anteprima video…");

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ofi-preview-"));

    const localMedia = [];
    for (let i = 0; i < picked.length; i++) {
      const m = picked[i];
      const ext =
        m.type === "clip"
          ? (m.mime.includes("webm") ? ".webm" : ".mp4")
          : (m.mime.includes("png") ? ".png" : ".jpg");

      const outPath = path.join(tmpDir, `media_${i}${ext}`);
      await downloadToFile(bucket, m, outPath);

      localMedia.push({
        ...m,
        filePath: outPath,
      });
    }

    await updateJob(ref, "preview_render", 22, "Media scaricati…");

    const voicePath = path.join(tmpDir, "voice.mp3");
    const localVoice = voiceEnabled ? await downloadVoiceIfAny(bucket, data, voicePath) : null;

    // Durata preview: 12 secondi netti
    const totalDuration = 12;

    // distribuzione segmenti
    const clips = [];
    const photos = [];

    for (const m of localMedia) {
      if (m.type === "clip") clips.push(m);
      else photos.push(m);
    }

    const mediaInputs = [];
    const clipDur = clips.length ? 3 : 0;
    const reservedForClips = clips.length * clipDur;
    const remaining = Math.max(4, totalDuration - reservedForClips);
    const photoDur = photos.length ? remaining / photos.length : 0;

    for (const m of photos) {
      mediaInputs.push({
        ...m,
        type: "photo",
        duration: Number(photoDur.toFixed(3)),
        startAt: 0,
      });
    }

    for (const m of clips) {
      let dur = 0;
      try {
        dur = await ffprobeDuration(m.filePath);
      } catch {
        dur = 0;
      }

      const seg = Math.min(3, dur || 3);
      const startAt = dur > seg ? Math.max(0, (dur - seg) / 2) : 0;

      mediaInputs.push({
        ...m,
        type: "clip",
        duration: Number(seg.toFixed(3)),
        startAt,
      });
    }

    if (!mediaInputs.length) {
      return json({}, 400, { ok: false, error: "No valid media for preview." });
    }

    // se la somma non è 12 precisa, ribilanciamo sull’ultimo elemento
    const currentTotal = mediaInputs.reduce((s, m) => s + Number(m.duration || 0), 0);
    if (Math.abs(currentTotal - totalDuration) > 0.05) {
      const last = mediaInputs[mediaInputs.length - 1];
      last.duration = Math.max(1.5, Number((last.duration + (totalDuration - currentTotal)).toFixed(3)));
    }

    const outputPath = path.join(tmpDir, "preview.mp4");
    const posterPath = path.join(tmpDir, "preview.jpg");

    const ffArgs = ["-y"];

    for (const m of mediaInputs) {
      if (m.type === "photo") {
        ffArgs.push("-loop", "1", "-t", String(m.duration), "-i", m.filePath);
      } else {
        ffArgs.push("-i", m.filePath);
      }
    }

    let audioInputIndex = null;

    if (localVoice && existsSync(localVoice)) {
      audioInputIndex = mediaInputs.length;
      ffArgs.push("-i", localVoice);
    } else {
      audioInputIndex = mediaInputs.length;
      ffArgs.push(
        "-f",
        "lavfi",
        "-t",
        String(totalDuration),
        "-i",
        "anullsrc=r=48000:cl=stereo"
      );
    }

    const filterComplex = buildFilterComplex(
      mediaInputs,
      overlayLines,
      totalDuration,
      audioInputIndex
    );

    ffArgs.push(
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      String(totalDuration),
      "-r",
      "25",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    );

    await updateJob(ref, "preview_render", 55, "Genero anteprima video…");
    await run(ffmpegPath, ffArgs);

    await updateJob(ref, "preview_render", 76, "Genero immagine anteprima…");
    await run(ffmpegPath, [
      "-y",
      "-i",
      outputPath,
      "-ss",
      "1",
      "-vframes",
      "1",
      "-q:v",
      "2",
      posterPath,
    ]);

    const previewStorageRef = `luoghi_memoria/${luogoId}/videos/${videoId}/preview.mp4`;
    const posterStorageRef = `luoghi_memoria/${luogoId}/videos/${videoId}/preview.jpg`;

    const previewFile = bucket.file(previewStorageRef);
    const posterFile = bucket.file(posterStorageRef);

    await updateJob(ref, "preview_render", 88, "Carico anteprima su Storage…");

    await previewFile.save(await fs.readFile(outputPath), {
      resumable: false,
      contentType: "video/mp4",
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    await posterFile.save(await fs.readFile(posterPath), {
      resumable: false,
      contentType: "image/jpeg",
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    const previewUrl = await signedUrl(previewFile, 7);
    const posterUrl = await signedUrl(posterFile, 7);

    const previewVideo = {
      storageRef: previewStorageRef,
      url: previewUrl,
      posterStorageRef,
      posterUrl,
      duration: totalDuration,
      hasVoice: !!(localVoice && existsSync(localVoice)),
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(
      {
        previewVideo,
        stato: "preview_ready",
        status: "preview_ready",
        job: {
          step: "preview_render",
          progress: 100,
          message: "Anteprima pronta.",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return json({}, 200, {
      ok: true,
      previewVideo: {
        storageRef: previewStorageRef,
        url: previewUrl,
        posterStorageRef,
        posterUrl,
        duration: totalDuration,
        hasVoice: !!(localVoice && existsSync(localVoice)),
      },
    });
  } catch (e) {
    console.error("videoPreviewRender error:", e);

    try {
      initAdmin();
      const body = JSON.parse(event.body || "{}");
      const luogoId = safeStr(body?.luogoId);
      const videoId = safeStr(body?.videoId);
      if (luogoId && videoId) {
        const ref = admin
          .firestore()
          .collection("luoghi_memoria")
          .doc(luogoId)
          .collection("videos")
          .doc(videoId);

        await ref.set(
          {
            job: {
              step: "preview_render",
              progress: 0,
              message: "Errore nella generazione anteprima.",
              error: String(e?.message || e),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (_) {}

    return json({}, 500, {
      ok: false,
      error: String(e?.message || e),
    });
  } finally {
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }
};