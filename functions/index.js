// === Firebase Functions v2 (compatibile con v4/v6) ===
const { onDocumentCreated, onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp(); // init admin SDK
const db = getFirestore();
const fcm = getMessaging();

/* =========================================================================
 * NOTIFICHE ADMIN (tuo codice esistente)
 * ========================================================================= */

async function notifyAdmins(title, body) {
  const snap = await db.collection('admin_notification_tokens').get();
  const tokens = snap.docs.map(d => d.get('token')).filter(Boolean);
  if (!tokens.length) return;

  await fcm.sendEachForMulticast({
    notification: { title, body },
    tokens
  });
  console.log('FCM inviato:', title, '| tokens:', tokens.length);
}

async function maybeNotifyOnCreate(event, tipo) {
  const data = event?.data?.data?.();
  if (!data) return;
  if (data.stato !== 'in_attesa') return;
  const id = event?.params?.id || '';
  await notifyAdmins(`Nuovo ${tipo} in attesa`, `ID: ${id}`);
}

// Trigger notifica su nuove entità
exports.onPreventivoCreate = onDocumentCreated('preventivi/{id}',
  (event) => maybeNotifyOnCreate(event, 'preventivo')
);

exports.onNecrologioCreate = onDocumentCreated('necrologi/{id}',
  (event) => maybeNotifyOnCreate(event, 'necrologio')
);

exports.onImpresaCreate = onDocumentCreated('imprese_registrate/{id}',
  (event) => maybeNotifyOnCreate(event, 'impresa')
);

exports.onCittadinoCreate = onDocumentCreated('utenti_cittadini/{id}',
  (event) => maybeNotifyOnCreate(event, 'cittadino')
);

exports.onFornitoreCreate = onDocumentCreated('fornitori_registrati/{id}',
  (event) => maybeNotifyOnCreate(event, 'fornitore')
);

exports.onSupportoCreate = onDocumentCreated('figure_supporto/{id}',
  (event) => maybeNotifyOnCreate(event, 'utente di supporto')
);

/* =========================================================================
 * NECROLOGI — CONTATORE CUORI (AUTO)
 * - +1 su create reazione
 * - -1 su delete reazione
 * Aggiorna reactionsHeartTotal sul documento padre necrologi_pubblicati/{id}
 * ========================================================================= */

// ❤️ +1 quando viene creato un cuore
exports.necroHeartOnCreate = onDocumentCreated(
  'necrologi_pubblicati/{necroId}/reazioni/{uid}',
  async (event) => {
    const necroId = event?.params?.necroId;
    if (!necroId) return;

    const parentRef = db.doc(`necrologi_pubblicati/${necroId}`);

    await parentRef.set(
      { reactionsHeartTotal: FieldValue.increment(1) },
      { merge: true }
    );

    console.log('[necroHeartOnCreate] +1', necroId);
  }
);

// 💔 -1 quando viene rimosso un cuore
exports.necroHeartOnDelete = onDocumentDeleted(
  'necrologi_pubblicati/{necroId}/reazioni/{uid}',
  async (event) => {
    const necroId = event?.params?.necroId;
    if (!necroId) return;

    const parentRef = db.doc(`necrologi_pubblicati/${necroId}`);

    await parentRef.set(
      { reactionsHeartTotal: FieldValue.increment(-1) },
      { merge: true }
    );

    console.log('[necroHeartOnDelete] -1', necroId);
  }
);

/* =========================================================================
 * OFI — Sistema Punti → Visibilità → Stelle (MASTER)
 * Trigger: onAzioneCreata
 * ========================================================================= */

// Mappa punteggi base per tipo azione (coerente con MASTER e dashboard)
const PUNTEGGI_AZIONE = {
  pensiero: 5,          // THOUGHT
  necrologio: 10,       // NECROLOGIO / anniversario (allineato alla dashboard)
  anniversario: 10,
  preventivo: 10,
  profilo: 5,
  recensione_pos: 10,
  invito_ok: 20,
  marchio_share: 5
};

// Calcolo stelle da punteggio visibilità + attività 30gg (soglie MASTER v1)
function calcolaStelle(punteggioVis, attivita30) {
  if (punteggioVis >= 100 && attivita30 >= 50) return 5;
  if (punteggioVis >= 80)  return 4;
  if (punteggioVis >= 60)  return 3;
  if (punteggioVis >= 40)  return 2;
  return 1;
}

/**
 * onAzioneCreata
 * - Anti-doppione 1/giorno per "pensiero"
 * - Somma punti_saldo/punti_totali
 * - Incrementa attivita_30gg (cap 500)
 * - Calcola punteggio_visibilita = profilo_score + (punti_saldo * 0.05) * fattore_reputazione
 * - Calcola stelle_correnti con soglie MASTER
 * - Marca inattivo=false e aggiorna ultimoAggiornamento
 * - Scrive nel log i campi valore_base / valore_effettivo (audit)
 */
exports.onAzioneCreata = onDocumentCreated('azioni_log/{azioneId}', async (event) => {
  const snap = event?.data;
  if (!snap) return;

  const a = snap.data() || {};
  const email = a.impresa_email;
  const tipo = a.tipo;                 // es. "pensiero"
  const giornoKey = a.giorno_key;      // "YYYY-MM-DD"

  if (!email || !tipo) {
    console.warn('[onAzioneCreata] evento incompleto', a);
    return;
  }

  const impRef = db.collection('imprese_registrate').doc(email);

  // Anti-doppione giornaliero per i pensieri (ledger per idempotenza)
  const isPensiero = (tipo === 'pensiero') && !!giornoKey;
  const ledgerRef = isPensiero
    ? impRef.collection('ledger').doc(`pensiero-${giornoKey}`)
    : null;

  if (ledgerRef) {
    const already = await ledgerRef.get();
    if (already.exists) {
      console.log('[onAzioneCreata] già accreditato oggi per', email, giornoKey);
      return;
    }
  }

  // Punteggio base dell'azione
  let valoreBase = Number(PUNTEGGI_AZIONE[tipo] ?? 0);
  let valoreEffettivo = valoreBase;

  await db.runTransaction(async (tx) => {
    const impSnap = await tx.get(impRef);
    if (!impSnap.exists) {
      console.warn('[onAzioneCreata] impresa non trovata:', email);
      return;
    }

    const d = impSnap.data() || {};

    // Lettura stati attuali
    const saldoPre = Number(d.punti_saldo ?? 0);
    const totPre   = Number(d.punti_totali ?? 0);
    const attPre   = Number(d.attivita_30gg ?? 0);

    // Se l'azione non produce punti, esci (ma tieni ledger per idempotenza coerente)
    if (!valoreEffettivo) {
      if (ledgerRef) {
        tx.set(ledgerRef, { created_at: FieldValue.serverTimestamp(), tipo, giornoKey });
      }
      tx.update(snap.ref, { valore_base: valoreBase, valore_effettivo: 0 });
      return;
    }

    // Nuovi valori
    const saldo = saldoPre + valoreEffettivo;
    const tot   = totPre   + valoreEffettivo;
    const att30 = Math.min(attPre + valoreEffettivo, 500); // cap anti-esplosione

    // Parametri profilo/reputazione
    const profilo = Number(d.profilo_score ?? 0);            // 0..100
    const fattore = Number(d.fattore_reputazione ?? 1.0);    // 1.10 / 1.00 / 0.90 / 0.80
    const fattoreOk = (isFinite(fattore) && fattore > 0) ? fattore : 1.0;

    // Visibilità (MASTER)
    const punteggioVis = profilo + (saldo * 0.05) * fattoreOk;

    // Stelle correnti (backend — per ora basate su punteggio_vis + attività)
    const stelle = calcolaStelle(punteggioVis, att30);

    // Patch finale su impresa
    tx.update(impRef, {
      punti_saldo: saldo,
      punti_totali: tot,
      attivita_30gg: att30,
      punteggio_visibilita: punteggioVis,
      stelle_correnti: stelle,
      inattivo: false,
      ultimoAggiornamento: FieldValue.serverTimestamp()
    });

    // Ledger anti-doppione (solo se presente)
    if (ledgerRef) {
      tx.set(ledgerRef, {
        created_at: FieldValue.serverTimestamp(),
        tipo,
        giornoKey
      });
    }

    // Audit nel log dell'azione
    tx.update(snap.ref, {
      valore_base: valoreBase,
      valore_effettivo: valoreEffettivo
    });
  });

  console.log('[onAzioneCreata] OK', { email, tipo, giornoKey, valoreBase, valoreEffettivo });
});

/* ===== Helper stelle coerenti con dashboard (MASTER) ===== */

function mappaStellePotenziale(profilo_score){
  const s = Number(profilo_score || 0);
  if (s >= 95) return 5;
  if (s >= 80) return 4;
  if (s >= 50) return 3;
  if (s >= 20) return 2;
  return 1;
}

function stelleDaPunti(punti_saldo, fattore_reputazione = 1){
  const pNum = Number(punti_saldo);
  const rNum = Number(fattore_reputazione);
  const p = Number.isFinite(pNum) ? pNum : 0;
  const r = (Number.isFinite(rNum) && rNum > 0) ? rNum : 1;
  const eff = p * r;

  if (eff >= 600) return 5;
  if (eff >= 300) return 4;
  if (eff >= 150) return 3;
  if (eff >= 50)  return 2;
  return 1;
}

function toDateMaybe(v){
  if (!v) return null;
  if (typeof v.toDate === 'function') {
    try { return v.toDate(); } catch(e) { /* ignore */ }
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function calcolaStelleCorrentiBack({profilo_score, punti_saldo, fattore_reputazione = 1, stelle_lock_until}){
  const pot   = mappaStellePotenziale(profilo_score || 0);
  const byPts = stelleDaPunti(punti_saldo || 0, fattore_reputazione || 1);
  const lockDate = toDateMaybe(stelle_lock_until);
  if (lockDate && lockDate > new Date()) {
    // Periodo iniziale ancora attivo → tieni il meglio tra potenziale e punti
    return Math.max(pot, byPts);
  }
  return byPts;
}

// Aggiorna punteggio_visibilita + stelle quando cambia il profilo_score
exports.onProfiloScoreUpdate = onDocumentWritten(
  'imprese_registrate/{emailId}',
  async (event) => {
    const afterSnap  = event.data.after;
    const beforeSnap = event.data.before;

    // se è stato cancellato, esco
    if (!afterSnap.exists) return;

    const emailId    = event.params.emailId;
    const beforeData = beforeSnap.exists ? (beforeSnap.data() || {}) : {};
    const afterData  = afterSnap.data() || {};

    const oldScore = Number(beforeData.profilo_score ?? 0);
    const newScore = Number(afterData.profilo_score ?? 0);

    // se lo score non è cambiato, non faccio nulla
    if (oldScore === newScore) return;

    // saldo punti “dinamici”
    const puntiSaldo = Number(afterData.punti_saldo ?? 0);

    // fattore reputazione con default sicuro
    const fattoreRaw = Number(afterData.fattore_reputazione);
    const fattoreRep = (Number.isFinite(fattoreRaw) && fattoreRaw > 0)
      ? fattoreRaw
      : 1.0;

    // stelle potenziali dal profilo (0..5)
    const stelleProfilo = mappaStellePotenziale(newScore);

    // se non c’è ancora lock, lo imposto ora per le imprese approvate
    let lock = afterData.stelle_lock_until || null;
    if (!lock && afterData.stato === 'approvata') {
      const now = new Date();
      now.setDate(now.getDate() + 14);  // <-- 14 giorni, come deciso
      lock = now;
    }

    // stelle correnti usando la stessa logica del MASTER
    const nuoveStelle = calcolaStelleCorrentiBack({
      profilo_score: newScore,
      punti_saldo: puntiSaldo,
      fattore_reputazione: fattoreRep,
      stelle_lock_until: lock
    });

    // punteggio visibilità coerente con il MASTER
    const punteggioVis = newScore + (puntiSaldo * 0.05) * fattoreRep;

    const patch = {
      stelle_profilo: stelleProfilo,
      punteggio_visibilita: punteggioVis,
      stelle_correnti: nuoveStelle,
      fattore_reputazione: fattoreRep
    };

    // se prima non c’era lock e ora l’ho calcolato, lo salvo
    if (!afterData.stelle_lock_until && lock) {
      patch.stelle_lock_until = lock;
    }

    await afterSnap.ref.update(patch);

    console.log(
      '[onProfiloScoreUpdate] aggiornato profilo per',
      emailId,
      'score=', newScore,
      'stelle=', nuoveStelle
    );
  }
);

/* =========================================================================
 * OFI — Conversione Punti → Crediti (Cloud Function onCall)
 * ========================================================================= */

exports.convertPunti = onCall(
  { region: 'europe-west1' },
  async (request) => {
    if (!request.auth || !request.auth.token || !request.auth.token.email) {
      return { ok: false, reason: 'UNAUTHENTICATED' };
    }

    const email = String(request.auth.token.email).toLowerCase();
    const impRef = db.collection('imprese_registrate').doc(email);

    const STEP = 100;

    const rawAmount = request.data?.punti_da_convertire;
    let requested = Number(rawAmount);

    if (!Number.isFinite(requested)) {
      return { ok: false, reason: 'INVALID_AMOUNT' };
    }

    if (requested < STEP) {
      return { ok: false, reason: 'MIN_AMOUNT_100', required_min: STEP };
    }

    try {
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(impRef);
        if (!snap.exists) return { ok: false, reason: 'PROFILE_NOT_FOUND' };

        const d = snap.data() || {};
        const puntiSaldo         = Number(d.punti_saldo || 0);
        const profiloScore       = Number(d.profilo_score || 0);
        const fattoreReputazione = Number(d.fattore_reputazione || 1.0);
        const creditiAttuali     = Number(d.crediti || 0);
        const stelleLock         = d.stelle_lock_until || null;

        const fattoreOk = (isFinite(fattoreReputazione) && fattoreReputazione > 0)
          ? fattoreReputazione
          : 1.0;

        if (puntiSaldo < 300) {
          return { ok: false, reason: 'NOT_ENOUGH_POINTS', punti_saldo: puntiSaldo };
        }

        const maxBlocchi = Math.floor(puntiSaldo / STEP);
        if (maxBlocchi < 1) {
          return { ok: false, reason: 'NOT_ENOUGH_BLOCKS', punti_saldo: puntiSaldo };
        }

        let blocchiRichiesti = Math.floor(requested / STEP);
        if (blocchiRichiesti < 1) {
          return { ok: false, reason: 'INVALID_AMOUNT', punti_saldo: puntiSaldo };
        }
        if (blocchiRichiesti > maxBlocchi) blocchiRichiesti = maxBlocchi;

        const puntiUsati      = blocchiRichiesti * STEP;
        const nuovoSaldo      = puntiSaldo - puntiUsati;
        const creditiAggiunti = blocchiRichiesti;
        const nuoviCrediti    = creditiAttuali + creditiAggiunti;

        const nuovoPunteggioVis = profiloScore + (nuovoSaldo * 0.05) * fattoreOk;

        const nuoveStelle = calcolaStelleCorrentiBack({
          profilo_score: profiloScore,
          punti_saldo: nuovoSaldo,
          fattore_reputazione: fattoreOk,
          stelle_lock_until: stelleLock
        });

        tx.update(impRef, {
          punti_saldo: nuovoSaldo,
          crediti: nuoviCrediti,
          punteggio_visibilita: nuovoPunteggioVis,
          stelle_correnti: nuoveStelle,
          ultimoAggiornamento: FieldValue.serverTimestamp(),
          ultima_conversione: FieldValue.serverTimestamp()
        });

        const logRef = db.collection('azioni_log').doc();
        tx.set(logRef, {
          tipo: 'conversione_punti_crediti',
          impresa_email: email,
          punti_usati: puntiUsati,
          crediti_aggiunti: creditiAggiunti,
          saldo_finale: nuovoSaldo,
          stelle_correnti: nuoveStelle,
          created_at: FieldValue.serverTimestamp()
        });

        return {
          ok: true,
          punti_saldo: nuovoSaldo,
          crediti: nuoviCrediti,
          crediti_aggiunti: creditiAggiunti,
          punti_usati: puntiUsati,
          punteggio_visibilita: nuovoPunteggioVis,
          stelle_correnti: nuoveStelle
        };
      });

      return result;

    } catch (err) {
      console.error('convertPunti error for', email, err);
      return { ok: false, reason: 'INTERNAL_ERROR', message: err.message || '' };
    }
  }
);

/* =========================================================================
 * OFI — Decadimento automatico Attività / Stelle (job giornaliero)
 * ========================================================================= */

const DECAY_GRACE_DAYS = 14;
const DECAY_PER_DAY = 10;
const INATTIVO_AFTER_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

exports.decayPuntiStelle = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'Europe/Rome' },
  async () => {
    const now = new Date();
    console.log('[decayPuntiStelle] start at', now.toISOString());

    const snap = await db.collection('imprese_registrate').get();
    console.log('[decayPuntiStelle] imprese trovate:', snap.size);

    const docs = snap.docs;
    let updates = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of docs) {
      const d = doc.data() || {};
      const lastTs = d.ultimoAggiornamento;

      if (!lastTs || typeof lastTs.toDate !== 'function') continue;

      const lastDate = lastTs.toDate();
      const diffMs = now - lastDate;
      const days = Math.floor(diffMs / MS_PER_DAY);

      if (days <= DECAY_GRACE_DAYS) continue;

      let att = Number(d.attivita_30gg || 0);
      let changed = false;
      let inattivo = !!d.inattivo;

      if (att > 0) {
        const newAtt = Math.max(0, att - DECAY_PER_DAY);
        if (newAtt !== att) {
          att = newAtt;
          changed = true;
        }
      }

      if (days >= INATTIVO_AFTER_DAYS && !inattivo) {
        inattivo = true;
        changed = true;
      }

      if (!changed) continue;

      const profilo = Number(d.profilo_score || 0);
      const saldo = Number(d.punti_saldo || 0);
      const fattore = Number(d.fattore_reputazione || 1.0);
      const fattoreOk = (isFinite(fattore) && fattore > 0) ? fattore : 1.0;

      const nuovoPunteggioVis = profilo + (saldo * 0.05) * fattoreOk;
      const nuoveStelle = calcolaStelle(nuovoPunteggioVis, att);

      batch.update(doc.ref, {
        attivita_30gg: att,
        punteggio_visibilita: nuovoPunteggioVis,
        stelle_correnti: nuoveStelle,
        inattivo
      });

      batchCount++;
      updates++;

      if (batchCount >= 400) {
        await batch.commit();
        console.log('[decayPuntiStelle] commit batch parziale, aggiornate finora:', updates);
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();

    console.log('[decayPuntiStelle] completato. Imprese aggiornate:', updates);
  }
);

// ========================================================================
// SYNC PROFILO PUBBLICO IMPRESA + NORMALIZZAZIONE ABBONAMENTO + TRIAL + SYNC
// (tuo codice invariato qui sotto)
// ========================================================================

exports.normalizeAbbonamentoImpresa = onDocumentWritten(
  'imprese_registrate/{impresaId}',
  async (event) => {
    const afterSnap = event.data.after;
    if (!afterSnap.exists) return;

    const after = afterSnap.data() || {};
    const impresaId = event.params.impresaId;

    const abbo = { ...(after.abbonamento || {}) };
    let changedAbbo = false;

    const legacyState = (after.abbonamento_stato || '').toLowerCase();

    if (!abbo.stato && legacyState) {
      abbo.stato = (legacyState === 'free') ? 'trial' : legacyState;
      changedAbbo = true;
    }

    const updates = {};

    if (changedAbbo) updates.abbonamento = abbo;

    if ('abbonamento_stato' in after) updates.abbonamento_stato = FieldValue.delete();
    if ('abbonamento_start' in after) updates.abbonamento_start = FieldValue.delete();
    if ('abbonamento_end' in after)   updates.abbonamento_end   = FieldValue.delete();

    if (!Object.keys(updates).length) return;

    console.log('[normalizeAbbonamentoImpresa]', impresaId, updates);
    await afterSnap.ref.update(updates);
  }
);

exports.onImpresaApprovata = onDocumentWritten(
  'imprese_registrate/{emailId}',
  async (event) => {
    const emailId    = event.params.emailId;
    const beforeSnap = event.data.before;
    const afterSnap  = event.data.after;

    if (!afterSnap.exists) return;

    const beforeData = beforeSnap.exists ? (beforeSnap.data() || {}) : {};
    const afterData  = afterSnap.data() || {};

    const beforeStato = beforeData.stato || null;
    const afterStato  = afterData.stato || null;

    if (beforeStato === afterStato) return;
    if (afterStato !== 'approvata') return;

    const abbo = afterData.abbonamento || {};

    if (abbo.trialEndsAt || abbo.periodEndAt || abbo.renewsAt) {
      console.log('[onImpresaApprovata] abbonamento già presente, skip per', emailId);
      return;
    }

    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setMonth(trialEnd.getMonth() + 2);

    const profiloScore = Number(afterData.profilo_score || 0);
    const stelleProfilo = mappaStellePotenziale(profiloScore);

    const lockUntil = new Date(now);
    lockUntil.setDate(lockUntil.getDate() + 14);

    const fattoreReputazione =
      (Number.isFinite(Number(afterData.fattore_reputazione)) &&
       Number(afterData.fattore_reputazione) > 0)
        ? Number(afterData.fattore_reputazione)
        : 1.0;

    const patch = {
      'abbonamento.stato': 'trial',
      'abbonamento.piano': abbo.piano || null,
      'abbonamento.trialEndsAt': trialEnd,
      'abbonamento.periodStartAt': null,
      'abbonamento.periodEndAt': null,

      stelle_profilo: stelleProfilo,
      stelle_correnti: stelleProfilo,
      stelle_lock_until: lockUntil,
      fattore_reputazione: fattoreReputazione
    };

    await afterSnap.ref.update(patch);

    console.log('[onImpresaApprovata] trial + stelle iniziali impostati per',
      emailId,
      'trial fino a', trialEnd.toISOString(),
      'lock stelle fino a', lockUntil.toISOString()
    );
  }
);

exports.syncImpresaPubblica = onDocumentWritten(
  'imprese_registrate/{emailId}',
  async (event) => {
    const emailId = event.params.emailId;

    const beforeSnap = event.data.before;
    const afterSnap  = event.data.after;

    const afterExists  = afterSnap.exists;

    if (!afterExists) {
      await db.doc(`imprese_visibili/${emailId}`).delete().catch(() => {});
      console.log('[syncImpresaPubblica] eliminato profilo pubblico per', emailId);
      return;
    }

    const data = afterSnap.data() || {};

    const sitiArr = Array.isArray(data.siti)
      ? data.siti
      : (data.siti ? [data.siti] : []);

    const pubblico = {
      email: emailId,

      nome: data.nome || '',
      descrizione: data.descrizione || '',

      telefono: data.telefono || null,
      website: data.website || data.sito_web || (sitiArr[0] || null),

      siti: sitiArr,

      piva: data.piva || data.partita_iva || null,

      codice_ofi:
        data.codice_ofi ||
        data.codiceOFI ||
        data.codice_impresa ||
        null,

      sede_principale: data.sede_principale || null,
      sedi_distaccate: data.sedi_distaccate || [],

      logo_url: data.logo_url || null,
      gallery_urls: data.gallery_urls || [],
      video_url: data.video_url || null,
      video_yt: data.video_yt || null,
      social: data.social || {},

      servizi: data.servizi || [],
      badge: data.badge || null,

      stelle_correnti: data.stelle_correnti || 0,
      punteggio_visibilita: data.punteggio_visibilita || 0,
      profilo_score: data.profilo_score || 0,
      punti_saldo: data.punti_saldo || 0,
      fattore_reputazione: data.fattore_reputazione || 1.0,
      stelle_lock_until: data.stelle_lock_until || null,

      abbonamento: {
        stato: (data.abbonamento && data.abbonamento.stato) || null,
        trialEndsAt: data.abbonamento?.trialEndsAt || null,
        periodEndAt: data.abbonamento?.periodEndAt || null
      },

      updated_at: FieldValue.serverTimestamp()
    };

    await db.doc(`imprese_visibili/${emailId}`).set(pubblico, { merge: true });

    console.log('[syncImpresaPubblica] profilo pubblico sincronizzato per', emailId);
  }
);
