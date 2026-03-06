// netlify/functions/puntiStelleScheduler.mjs
// v1 – Decadimento automatico Attività / Profilo / Stelle

import admin from "firebase-admin";


const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}

let dbInstance = null;

/* =========================
   INIT FIREBASE-ADMIN usando FIREBASE_SERVICE_ACCOUNT
   ========================= */
function getDb() {
  if (dbInstance) return dbInstance;

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!saJson) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var");
  }

  let serviceAccount;
  try {
    serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
};
  } catch (err) {
    throw new Error(
      "Errore nel JSON di FIREBASE_SERVICE_ACCOUNT: " + err.message
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log(
      "[puntiStelleScheduler] Firebase Admin inizializzato per progetto:",
      serviceAccount.project_id
    );
  }

  dbInstance = admin.firestore();
  return dbInstance;
}

const IMPRESE_REGISTRATE = "imprese_registrate";

/* =========================
   Helper tempo
   ========================= */
function diffInDays(later, earlier) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((later.getTime() - earlier.getTime()) / msPerDay);
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate) return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/* =========================
   Logica stelle (v1)
   ========================= */
function mappaStellePotenziale(profilo_score) {
  const s = Number(profilo_score || 0);
  if (s >= 95) return 5;
  if (s >= 80) return 4;
  if (s >= 50) return 3;
  if (s >= 20) return 2;
  return 1;
}

function stelleDaPunti(punti_saldo, fattore_reputazione = 1) {
  const p = Number.isFinite(+punti_saldo) ? +punti_saldo : 0;
  const r =
    Number.isFinite(+fattore_reputazione) && +fattore_reputazione > 0
      ? +fattore_reputazione
      : 1;
  const eff = p * r;

  if (eff >= 600) return 5;
  if (eff >= 300) return 4;
  if (eff >= 150) return 3;
  if (eff >= 50) return 2;
  return 1;
}

function calcolaStelleCorrenti(doc) {
  const pot = mappaStellePotenziale(doc.profilo_score || 0);
  const byPts = stelleDaPunti(doc.punti_saldo || 0, doc.fattore_reputazione || 1);
  return Math.max(pot, byPts);
}

/* =========================
   Punteggio visibilità (v1)
   ========================= */
function calcolaPunteggioVisibilita(profilo_score, attivita_30gg) {
  const ps = Number(profilo_score || 0);
  const act = Number(attivita_30gg || 0);
  const v = Math.round(0.6 * ps + 0.4 * act);
  return Math.max(0, Math.min(120, v));
}

/* =========================
   Decadimento v1
   ========================= */
function applicaDecadimentoV1(docData, now) {
  const data = { ...docData };

  const ultimaAttivita =
    toDate(data.ultima_attivita_at) ||
    toDate(data.ultimoAggiornamento) ||
    toDate(data.registrata_il) ||
    now;

  const giorniInattivo = diffInDays(now, ultimaAttivita);

  // 1) Periodo di grazia: nessun decadimento
  if (giorniInattivo <= 14) {
    return {
      dataAggiornata: {
        profilo_score_base:
          typeof data.profilo_score_base === "number"
            ? data.profilo_score_base
            : Number(data.profilo_score || 0),
      },
      giorniInattivo,
    };
  }

  // 2) Decadimento attività recente (2 punti al giorno, min 0)
  let attivita_30gg = Number(data.attivita_30gg || 0);
  attivita_30gg = Math.max(0, attivita_30gg - 2);

  // 3) Decadimento profilo nel lungo periodo
  const baseProfilo =
    typeof data.profilo_score_base === "number"
      ? data.profilo_score_base
      : Number(data.profilo_score || 0);

  const giorniSenzaGrazia = Math.max(0, giorniInattivo - 14);
  const mesiFermi = Math.floor(giorniSenzaGrazia / 30);
  const perditaPotenziale = Math.min(30, mesiFermi * 5);

  let nuovoProfilo = baseProfilo - perditaPotenziale;
  nuovoProfilo = Math.max(40, nuovoProfilo); // non scendere sotto 40 solo per automatismo

  const punteggio_visibilita = calcolaPunteggioVisibilita(
    nuovoProfilo,
    attivita_30gg
  );

  const stelle_correnti = calcolaStelleCorrenti({
    ...data,
    profilo_score: nuovoProfilo,
    attivita_30gg,
  });

  return {
    dataAggiornata: {
      profilo_score_base: baseProfilo,
      profilo_score: nuovoProfilo,
      attivita_30gg,
      punteggio_visibilita,
      stelle_correnti,
      ultimo_ricalcolo_punti_stelle: now,
    },
    giorniInattivo,
  };
}

/* =========================
   HANDLER SCHEDULED / BACKGROUND
   ========================= */
export default async (event, context) => {
  const now = new Date();

  try {
    const db = getDb();

    console.log(
      "[puntiStelleScheduler] Avvio ricalcolo v1",
      now.toISOString()
    );

    const snap = await db.collection(IMPRESE_REGISTRATE).get();

    console.log(
      `[puntiStelleScheduler] Imprese trovate in ${IMPRESE_REGISTRATE}:`,
      snap.size
    );

    const BATCH_LIMIT = 400;
    let batch = db.batch();
    let ops = 0;
    let updatedCount = 0;

    snap.forEach((doc) => {
      const data = doc.data() || {};
      const { dataAggiornata } = applicaDecadimentoV1(data, now);

      if (!dataAggiornata) return;

      const updatePayload = {};

      for (const [key, value] of Object.entries(dataAggiornata)) {
        if (value === undefined) continue;
        const oldVal = data[key];

        const isSame =
          (oldVal instanceof admin.firestore.Timestamp &&
            value instanceof Date &&
            oldVal.toDate().getTime() === value.getTime()) ||
          JSON.stringify(oldVal) === JSON.stringify(value);

        if (!isSame) {
          updatePayload[key] = value;
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        return;
      }

      batch.update(doc.ref, updatePayload);
      ops++;
      updatedCount++;

      if (ops >= BATCH_LIMIT) {
        batch.commit().catch((err) => {
          console.error("[puntiStelleScheduler] Errore commit batch:", err);
        });
        batch = db.batch();
        ops = 0;
      }
    });

    if (ops > 0) {
      await batch.commit();
    }

    console.log(
      `[puntiStelleScheduler] Ricalcolo completato. Documenti aggiornati: ${updatedCount}`
    );

    // 🔴 Scheduled/background function: NON ritorniamo nulla
    return;
  } catch (err) {
    console.error("[puntiStelleScheduler] ERRORE:", err);
    // Anche qui, per le background non serve un return personalizzato
    throw err;
  }
};

/* =========================
   SCHEDULE (03:00 ogni giorno)
   ========================= */
export const config = {
  schedule: "0 3 * * *",
};
