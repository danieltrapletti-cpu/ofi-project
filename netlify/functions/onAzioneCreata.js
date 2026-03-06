// netlify/functions/onAzioneCreata.js
import { db } from "./admin.js";

const PUNTI = {
  pensiero: 5, necrologio: 15, anniversario: 10, preventivo: 10,
  profilo: 5, recensione_pos: 10, invito_ok: 20, marchio_share: 5
};

const now = () => new Date();

export default async () => {
  try {
    // 1) prendo l’ULTIMO log creato (per test manuale va benissimo)
    const logs = await db.collection("azioni_log")
      .orderBy("created_at", "desc")
      .limit(1).get();

    if (logs.empty) return new Response("Nessun log da processare");

    const log = logs.docs[0];
    const a   = log.data();
    const email = a.impresa_email;
    const tipo  = a.tipo;
    const gk    = a.giorno_key;

    // Anti-duplicato pensiero (1/giorno)
    if (tipo === "pensiero") {
      const dup = await db.collection("azioni_log")
        .where("impresa_email","==",email)
        .where("tipo","==","pensiero")
        .where("giorno_key","==",gk)
        .where("__name__","!=", log.id)
        .limit(1).get();
      if (!dup.empty) return new Response("Pensiero già registrato oggi");
    }

    // Necrologi >5/giorno → punti ridotti
    let valore = PUNTI[tipo] ?? 0;
    if (tipo === "necrologio") {
      const cnt = await db.collection("azioni_log")
        .where("impresa_email","==",email)
        .where("tipo","==","necrologio")
        .where("giorno_key","==",gk)
        .count().get();
      if (cnt.data().count > 5) valore = 5;
    }

    await db.runTransaction(async (tx) => {
      const ref  = db.collection("imprese_registrate").doc(email);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Impresa non trovata");

      const d    = snap.data();
      const fatt = Number(d.fattore_reputazione ?? 1);
      const prof = Number(d.profilo_score ?? 0);

      const saldo = Number(d.punti_saldo ?? 0) + valore;
      const tot   = Number(d.punti_totali ?? 0) + valore;
      const att30 = Math.min(Number(d.attivita_30gg ?? 0) + valore, 500);

      const vis = prof + (saldo * 0.05) * fatt;

      let stelle = 1;
      if (vis >= 100 && att30 >= 50) stelle = 5;
      else if (vis >= 80)  stelle = 4;
      else if (vis >= 60)  stelle = 3;
      else if (vis >= 40)  stelle = 2;

      tx.update(ref, {
        punti_saldo: saldo,
        punti_totali: tot,
        attivita_30gg: att30,
        punteggio_visibilita: vis,
        stelle_correnti: stelle,
        inattivo: false,
        ultimoAggiornamento: now()
      });

      tx.update(log.ref, {
        valore_base: PUNTI[tipo] ?? 0,
        valore_effettivo: valore,
        source: "function"
      });
    });

    return new Response("OK — Azione processata");
  } catch (e) {
    console.error(e);
    return new Response("Errore onAzioneCreata: " + e.message, { status: 500 });
  }
};
