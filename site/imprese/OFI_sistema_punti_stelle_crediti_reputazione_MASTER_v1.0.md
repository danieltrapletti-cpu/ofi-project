# OFI — Sistema **Punti · Stelle · Crediti · Reputazione**
**Versione MASTER — definitiva 2025**  
_Logica ufficiale, automatizzata e approvata per l’ecosistema Onoranze Funebri Italia (OFI)._

---

## 0) Principi guida (riassunto operativo)

- **Profilo_score** (0–100) determina la **base delle stelle**: un profilo **completo (100)** parte con **⭐⭐⭐⭐⭐ immediatamente**, ma la permanenza a 5⭐ dipende dall’attività e dalla reputazione.  
- **Punti** misurano l’**attività quotidiana** (pensieri, necrologi, preventivi, profilo, recensioni). Decadono in modo **soft** se l’impresa resta inattiva.  
- **Reputazione** è un **moltiplicatore di qualità** (1.10–0.80) che agisce sui punti, non sulle stelle dirette. Si basa su recensioni verificate, condotta, qualità del profilo e collaborazione.  
- **Crediti** derivano dai punti (100:1€) e servono per **scontare gli abbonamenti** (max 50%). La conversione riduce i punti disponibili e può abbassare le stelle.  
- **Automazione completa**: ogni variazione è gestita da **Cloud/Netlify Functions** (transazioni + job pianificati).  
- **Ruolo admin minimo**: solo revisione di segnalazioni o parametri di sistema.

---

## 1) Modello dati Firestore

### 1.1 Collezioni principali
```js
// Documenti privati (uso interno e dashboard autenticata)
imprese_registrate/{email} = {
  profilo_score: number,            // 0..100
  punti_saldo: number,              // punti attivi disponibili
  punti_totali: number,             // storico cumulativo
  punti_convertiti: number,         // storico punti trasformati in crediti
  attivita_30gg: number,            // punti azioni ultimi 30 giorni
  reputazione_media: number,        // 0..100
  fattore_reputazione: number,      // 1.10 | 1.00 | 0.90 | 0.80
  punteggio_visibilita: number,     // base per stelle
  stelle_correnti: number,          // 1..5
  crediti: number,                  // crediti totali disponibili
  inattivo: boolean,                // flag opzionale (impostato da job)
  ultimoAggiornamento: timestamp,   // ultima azione o job
  ultima_conversione: timestamp     // per cooldown conversioni
}
```
```js
// Audit/eventi che generano punti (append-only)
azioni_log/{autoId} = {
  impresa_email: string,
  tipo: "pensiero"|"necrologio"|"anniversario"|"preventivo"|"profilo"|"recensione_pos"|"invito_ok"|"marchio_share",
  valore_base: number,              // punteggio nominale
  valore_effettivo: number,         // dopo limiti/antispam
  giorno_key: "YYYY-MM-DD",
  ref_tipo: string|null,            // "preventivo"|"necrologio"|...
  ref_id: string|null,
  source: "frontend"|"function"|"admin",
  created_at: timestamp
}
```
```js
// Recensioni dei cittadini
recensioni/{autoId} = {
  impresa_email: string,
  cittadino_uid: string,
  voto: number,                     // 1..5
  testo: string,
  categoria_servizio: string,       // es. "funerale","trasferimento","necrologio"
  verificata: boolean,              // true se collegata a ref valida o validata
  pubblicabile: boolean,            // filtro moderazione
  ref_tipo: string|null,
  ref_id: string|null,
  created_at: timestamp
}
```
```js
// Segnalazioni/moderazione
segnalazioni/{autoId} = {
  impresa_email: string,
  tipo: "contenuto_falso"|"uso_marchio"|"altro",
  severita: "bassa"|"media"|"alta",
  stato: "aperta"|"risolta",
  note_admin: string|null,
  created_at: timestamp,
  updated_at: timestamp
}
```
```js
// Documenti pubblici (profilo sintetico per la vetrina)
imprese_pubbliche/{email} = {
  nome: string,
  comune: string,
  logo_url: string,
  descrizione: string,
  servizi: list,
  livello_affidabilita: number,     // mappato da stelle_correnti (1..5)
  grado_presenza: string,           // es. "Base","Buona","Alta" (da soglie punti)
  badge: "base"|"presente"|"certificata"|"top",
  reputazione_media: number,        // 0..100
  link_profilo: string,
  aggiornato_il: timestamp
}
```

### 1.2 Indici consigliati (Firestore → “Indexes”)
- `azioni_log`: `(impresa_email ASC, tipo ASC, giorno_key ASC)`  
- `azioni_log`: `(impresa_email ASC, tipo ASC, created_at DESC)`  
- `recensioni`: `(impresa_email ASC, created_at DESC)`  
- `recensioni`: `(impresa_email ASC, cittadino_uid ASC, ref_id ASC)` (anti doppio voto per pratica)  
- `segnalazioni`: `(impresa_email ASC, stato ASC, created_at DESC)`  
- `imprese_registrate`: `(punti_saldo DESC)` (classifiche/ordinamenti)

---

## 2) Punti e limiti (anti-abuso)

| Azione | Punti | Limite | Note |
|---|---:|---|---|
| Condividi **Pensiero del Giorno** | +5 | 1/giorno | via modulo OFI |
| **Necrologio** pubblicato/verificato | +15 | 5/giorno → oltre +5 cad. | anti-spam |
| **Anniversario** pubblicato | +10 | — | nessun limite |
| **Risposta preventivo** (modulo OFI) | +10 | 1 per preventivo | — |
| **Aggiorna profilo** | +5 | 1/mese | — |
| **Recensione positiva (≥4★)** | +10 | per recensione | verificata |
| **Condivisione Marchio OFI** | +5 | 1/settimana | — |
| **Invito impresa verificata** | +20 | una tantum | — |

I valori sono centralizzati (vedi §11 Config) e modificabili senza rebuild.

---

## 3) Decadimento inattività (soft)

- 7 giorni senza azioni → **−2** punti_saldo  
- 14 giorni → **−5**  
- 30 giorni → **−10** + `inattivo=true`  

Il job giornaliero riduce **anche** `attivita_30gg` (−10 max) per coerenza visiva.  
Alla prima nuova azione: `inattivo=false` e timestamp aggiornato.

---

## 4) Reputazione → fattore moltiplicatore

### 4.1 Calcolo reputazione
```
reputazione_media = (recensioni*0.50) + (condotta*0.25) + (qualita_profilo*0.15) + (collaborazione*0.10)
```
- Se mancano dati → valore base **60** (neutro).  
- **Condotta**: tempi risposta preventivi, zero abusi/false pubblicazioni, tasso segnalazioni.  
- **Qualità profilo**: aggiornamenti e contenuti verificati.  
- **Collaborazione**: partecipazioni OFI, risoluzione segnalazioni.

### 4.2 Fattore reputazione
| Range | Fattore |
|---|---|
| 90–100 | **1.10** |
| 70–89 | **1.00** |
| 40–69 | **0.90** |
| 0–39 | **0.80** |

> Il fattore **modula i punti** nella formula stelle; **non** modifica `profilo_score`.

---

## 5) Stelle dinamiche

### 5.1 Formula visibilità
```
punteggio_visibilita = profilo_score + (punti_saldo * 0.05) * fattore_reputazione
```

### 5.2 Soglie aggiornate
- ⭐⭐⭐⭐⭐: `vis ≥ 100` **e** `attivita_30gg ≥ 50`  
- ⭐⭐⭐⭐: `vis ≥ 80` **oppure** (vis ≥100 ma attivita_30gg < 50)  
- ⭐⭐⭐: `60 ≤ vis < 80`  
- ⭐⭐: `40 ≤ vis < 60`  
- ⭐: `< 40`

**Conseguenze**  
- Profilo completo (100) → **5⭐ immediate**.  
- Per **mantenere 5⭐**, serve **min 50 punti** negli ultimi 30 giorni.  
- Conversioni punti→crediti o inattività possono ridurre a 4⭐, recuperabili con nuove azioni.

---

## 6) Crediti (conversione dei punti)

- **100 punti = 1 credito (1€)**  
- **Minimo conversione:** 300 punti (3€)  
- **Max utilizzo per acquisto:** 50% del prezzo (es. 20€ → max 10 crediti + 10€)  
- **Cooldown conversione:** 1 ogni **15 giorni**  
- Effetto immediato: la conversione scala `punti_saldo`, incrementa `punti_convertiti` e `crediti`, ricalcola visibilità e stelle.

---

## 7) Automazioni (Netlify/Firebase Functions)

> Esempi pronti per deploy. Node 18, Admin SDK.  
> Adattare a Firebase Functions **oppure** Netlify Functions con Admin SDK via service account.

### 7.1 Accredito azioni & ricalcolo stelle
```js
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
const db = getFirestore();
const PUNTI = { pensiero:5, necrologio:15, anniversario:10, preventivo:10, profilo:5, recensione_pos:10, invito_ok:20, marchio_share:5 };

export const onAzioneCreata = onDocumentCreated("azioni_log/{id}", async (e) => {
  const a = e.data?.data(); if (!a) return;
  const { impresa_email: email, tipo, giorno_key } = a;

  // Anti-duplicato (pensiero max 1/giorno)
  if (tipo === "pensiero") {
    const dup = await db.collection("azioni_log")
      .where("impresa_email","==",email).where("tipo","==","pensiero")
      .where("giorno_key","==",giorno_key).limit(1).get();
    if (!dup.empty) return;
  }

  // Necrologi >5/giorno → punti ridotti
  let valore = PUNTI[tipo] ?? 0;
  if (tipo === "necrologio") {
    const cnt = await db.collection("azioni_log")
      .where("impresa_email","==",email).where("tipo","==","necrologio")
      .where("giorno_key","==",giorno_key).count().get();
    if (cnt.data().count >= 5) valore = 5;
  }

  await db.runTransaction(async (tx) => {
    const ref = db.collection("imprese_registrate").doc(email);
    const snap = await tx.get(ref); if (!snap.exists) return;
    const d = snap.data();
    const fattore = d.fattore_reputazione ?? 1;
    const profilo = d.profilo_score ?? 0;

    const saldo = (d.punti_saldo ?? 0) + valore;
    const tot = (d.punti_totali ?? 0) + valore;
    const att30 = Math.min((d.attivita_30gg ?? 0) + valore, 500); // safety cap
    const vis = profilo + (saldo * 0.05) * fattore;

    let stelle = 1;
    if (vis >= 100 && att30 >= 50) stelle = 5;
    else if (vis >= 80) stelle = 4;
    else if (vis >= 60) stelle = 3;
    else if (vis >= 40) stelle = 2;

    tx.update(ref, {
      punti_saldo: saldo,
      punti_totali: tot,
      attivita_30gg: att30,
      punteggio_visibilita: vis,
      stelle_correnti: stelle,
      inattivo: false,
      ultimoAggiornamento: FieldValue.serverTimestamp()
    });
    tx.update(e.data!.ref, { valore_base: PUNTI[tipo] ?? 0, valore_effettivo: valore });
  });
});
```

### 7.2 Reputazione → fattore (recensioni)
```js
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
const db = getFirestore();

function fattoreReputazione(rep){
  if (rep >= 90) return 1.10;
  if (rep >= 70) return 1.00;
  if (rep >= 40) return 0.90;
  return 0.80;
}

export const onRecensioneChange = onDocumentWritten("recensioni/{id}", async (e) => {
  const after = e.data?.after?.data();
  const before = e.data?.before?.data();
  const email = (after || before)?.impresa_email; if (!email) return;

  // Calcolo media voti normalizzata (0..100) su recensioni pubblicabili
  const qs = await db.collection("recensioni")
    .where("impresa_email","==",email).where("pubblicabile","==",true).get();
  let sum=0, n=0; qs.forEach(d => { sum += (d.data().voto ?? 0); n++; });
  const avg5 = n ? (sum/n) : 0;
  const scoreRec = Math.round((avg5/5)*100) || 60; // neutro 60 se non ci sono dati

  await db.collection("imprese_registrate").doc(email).update({
    reputazione_media: scoreRec,
    fattore_reputazione: fattoreReputazione(scoreRec)
  });
});
```

### 7.3 Decadimento giornaliero (scheduled)
```js
// netlify/functions/jobDecadimento.ts
import { getFirestore, FieldValue } from "firebase-admin/firestore";
const db = getFirestore();

export default async () => {
  const now = Date.now();
  const snap = await db.collection("imprese_registrate").get();

  const batch = db.batch();
  snap.forEach(docu => {
    const d = docu.data();
    const last = d.ultimoAggiornamento?.toMillis?.() ?? 0;
    const days = Math.floor((now - last) / (1000*60*60*24));

    let delta = 0;
    if (days >= 30) delta = -10; else if (days >= 14) delta = -5; else if (days >= 7) delta = -2;
    if (!delta) return;

    const nuovoSaldo = Math.max(0, (d.punti_saldo ?? 0) + delta);
    const nuovaAtt = Math.max(0, (d.attivita_30gg ?? 0) - 10);
    const vis = (d.profilo_score ?? 0) + (nuovoSaldo * 0.05) * (d.fattore_reputazione ?? 1);

    let stelle = 1;
    if (vis >= 100 && nuovaAtt >= 50) stelle = 5;
    else if (vis >= 80)  stelle = 4;
    else if (vis >= 60)  stelle = 3;
    else if (vis >= 40)  stelle = 2;

    batch.update(docu.ref, {
      punti_saldo: nuovoSaldo,
      attivita_30gg: nuovaAtt,
      punteggio_visibilita: vis,
      stelle_correnti: stelle,
      inattivo: true,
      ultimoAggiornamento: FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  return new Response("OK");
}
```
```toml
# netlify.toml
[functions]
  node_bundler = "esbuild"

[[scheduled.functions]]
  name = "jobDecadimento"
  cron = "0 3 * * *"   # ogni notte alle 03:00 (UTC)
```

### 7.4 Conversione punti → crediti (endpoint protetto)
```js
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
const db = getFirestore();

export async function convertiPuntiInCrediti(email, puntiDaConvertire) {
  if (puntiDaConvertire < 300) throw new Error("Minimo 300 punti (3 crediti).");

  await db.runTransaction(async (tx) => {
    const ref = db.collection("imprese_registrate").doc(email);
    const snap = await tx.get(ref); if (!snap.exists) throw new Error("Impresa non trovata");
    const d = snap.data();

    // Cooldown 15 giorni
    const now = Timestamp.now();
    const last = d.ultima_conversione;
    if (last && (now.toMillis() - last.toMillis()) < 15*24*60*60*1000) {
      throw new Error("Conversione non disponibile: attendi 15 giorni dall'ultima conversione.");
    }

    if ((d.punti_saldo ?? 0) < puntiDaConvertire) throw new Error("Punti insufficienti");

    const nuovoSaldo = d.punti_saldo - puntiDaConvertire;
    const creditiAdd = Math.floor(puntiDaConvertire / 100);
    const vis = (d.profilo_score ?? 0) + (nuovoSaldo * 0.05) * (d.fattore_reputazione ?? 1);

    let stelle = 1;
    const att30 = d.attivita_30gg ?? 0;
    if (vis >= 100 && att30 >= 50) stelle = 5;
    else if (vis >= 80)  stelle = 4;
    else if (vis >= 60)  stelle = 3;
    else if (vis >= 40)  stelle = 2;

    tx.update(ref, {
      punti_saldo: nuovoSaldo,
      punti_convertiti: (d.punti_convertiti ?? 0) + puntiDaConvertire,
      crediti: (d.crediti ?? 0) + creditiAdd,
      punteggio_visibilita: vis,
      stelle_correnti: stelle,
      ultima_conversione: now,
      ultimoAggiornamento: FieldValue.serverTimestamp()
    });
  });
}
```

### 7.5 Sync profilo pubblico (funzione di utilità)
```js
import { getFirestore, FieldValue } from "firebase-admin/firestore";
const db = getFirestore();

function gradoPresenza(punti){
  if ((punti ?? 0) >= 600) return "Alta";
  if ((punti ?? 0) >= 200) return "Buona";
  return "Base";
}

export async function syncPublicProfile(email){
  const ref = db.collection("imprese_registrate").doc(email);
  const snap = await ref.get(); if (!snap.exists) return;
  const d = snap.data();

  const pubRef = db.collection("imprese_pubbliche").doc(email);
  await pubRef.set({
    nome: d.nomeImpresa || d.nome || "",
    comune: d.comune || d.citta || "",
    logo_url: d.logo_url || d.logoUrl || "",
    descrizione: d.descrizione_pubblica || "",
    servizi: d.servizi || [],
    livello_affidabilita: d.stelle_correnti || 1,
    grado_presenza: gradoPresenza(d.punti_saldo),
    badge: d.badge || "base",
    reputazione_media: d.reputazione_media || 60,
    link_profilo: `https://www.onoranzefunebritalia.it/profilo.html?id=${encodeURIComponent(email)}`,
    aggiornato_il: FieldValue.serverTimestamp()
  }, { merge: true });
}
```

---

## 8) Regole di sicurezza Firestore

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() { return request.auth != null; }
    function isAdmin() { return isSignedIn() && request.auth.token.admin == true; }

    // Documenti privati (solo impresa proprietaria + admin)
    match /imprese_registrate/{emailId} {
      allow read: if isAdmin() || (isSignedIn() && request.auth.token.email == emailId);
      allow write: if isSignedIn() && request.auth.token.email == emailId;
      // Campi bloccati al client, aggiornabili solo da Functions:
      allow update: if isSignedIn() 
        && request.auth.token.email == emailId
        && !(('punteggio_visibilita' in request.resource.data) || 
             ('stelle_correnti' in request.resource.data) ||
             ('punti_saldo' in request.resource.data) ||
             ('punti_totali' in request.resource.data) ||
             ('crediti' in request.resource.data));
    }

    // Profili pubblici
    match /imprese_pubbliche/{emailId} {
      allow read: if true;
      allow write: if isAdmin(); // sincronizzati da Function
    }

    // Log azioni
    match /azioni_log/{id} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
        && request.resource.data.impresa_email == request.auth.token.email
        && request.resource.data.keys().hasOnly(
          ['impresa_email','tipo','giorno_key','ref_tipo','ref_id','created_at','valore_base','valore_effettivo','source']
        );
      allow update, delete: if false; // append-only
    }

    // Recensioni
    match /recensioni/{id} {
      allow read: if true;
      allow create: if isSignedIn();
      allow update, delete: if isAdmin();
    }

    // Segnalazioni
    match /segnalazioni/{id} {
      allow read, update, delete: if isAdmin();
      allow create: if isSignedIn();
    }
  }
}
```

---

## 9) Indici consigliati
- `azioni_log`: `(impresa_email ASC, tipo ASC, giorno_key ASC)`  
- `azioni_log`: `(impresa_email ASC, created_at DESC)`  
- `imprese_registrate`: `(punti_saldo DESC)`  
- `recensioni`: `(impresa_email ASC, created_at DESC)`  
- `recensioni`: `(impresa_email ASC, cittadino_uid ASC, ref_id ASC)`  
- `segnalazioni`: `(impresa_email ASC, stato ASC, created_at DESC)`  

---

## 10) QA — Verifiche essenziali

- [ ] Pensiero condiviso 2× stesso giorno → **1 solo** accredito  
- [ ] Necrologi >5/giorno → punti ridotti a **5**  
- [ ] Conversione <300 punti → rifiutata  
- [ ] Conversione 1000 punti → saldo/crediti/stelle aggiornati  
- [ ] Inattività 7/14/30 gg → decadimento **−2/−5/−10** e `attivita_30gg −10`  
- [ ] Reputazione aggiornata su recensione **pubblicabile**  
- [ ] Cooldown **15 giorni** conversione rispettato  
- [ ] Client non può scrivere `stelle_correnti`, `punti_saldo`, `punteggio_visibilita`  
- [ ] `syncPublicProfile` riflette correttamente stelle e grado presenza

---

## 11) Parametri centrali (Firestore → `config/ofi_points`)
```js
{
  "coef_punti": 0.05,
  "min_attivita_30gg_for_5star": 50,
  "reputation_thresholds": { "hi":90, "mid":70, "low":40 },
  "reputation_factors": { "hi":1.10, "mid":1.00, "low":0.90, "crit":0.80 },
  "decadimento": { "d7":-2, "d14":-5, "d30":-10 },
  "azioni": { "pensiero":5, "necrologio":15, "anniversario":10, "preventivo":10, "profilo":5, "recensione_pos":10, "invito_ok":20, "marchio_share":5 },
  "limiti": { "pensiero_per_day":1, "necrologi_full_per_day":5, "necrologi_after5_value":5, "profilo_per_month":1, "marchio_per_week":1 },
  "crediti": { "ratio":100, "min_convert":300, "cooldown_days":15, "max_use_ratio":0.5 }
}
```

---

## 12) Glossario finale

| Termine | Significato |
|---|---|
| **Profilo_score** | Completezza del profilo 0–100 |
| **Punti_saldo** | Punti attivi disponibili |
| **Punti_totali** | Storico cumulato |
| **Punti_convertiti** | Totale punti già trasformati in crediti |
| **Attivita_30gg** | Somma punti ultimi 30 giorni |
| **Reputazione_media** | Valore 0–100 basato su voti e condotta |
| **Fattore_reputazione** | Moltiplicatore qualità (1.10–0.80) |
| **Punteggio_visibilita** | Metrica per calcolo stelle |
| **Crediti** | 100 punti = 1€ utilizzabile |
| **Stelle_correnti** | Livello reputazionale dinamico |

---

## 13) Nota legale e tono comunicativo
- Usare termini come **“Livello di Affidabilità”, “Presenza su OFI”, “Valutazione utenti verificata”**.  
- Evitare claim assoluti o comparativi.  
- Comunicare trasparenza e rispetto per il lutto.  
- I crediti **non** sono convertibili in denaro, solo in sconto abbonamenti.

---

## 14) Struttura di sincronizzazione automatica (end-to-end)

- **onAzioneCreata** → registra evento da `azioni_log`, applica limiti/antispam, aggiorna `punti_saldo`, `attivita_30gg`, `punteggio_visibilita`, `stelle_correnti`, `ultimoAggiornamento`, `inattivo=false`.  
- **onRecensioneChange** → ricalcola `reputazione_media` (neutro 60 se assenti dati), aggiorna `fattore_reputazione`.  
- **jobDecadimento (cron)** → se inattività 7/14/30 gg applica il delta su `punti_saldo`, riduce `attivita_30gg` (−10), aggiorna stelle e `inattivo=true`.  
- **convertiPuntiInCrediti** → verifica saldo e **cooldown 15 giorni**, scala `punti_saldo`, aggiorna `punti_convertiti` e `crediti`, ricalcola stelle.  
- **syncPublicProfile** → proietta i campi da `imprese_registrate` verso `imprese_pubbliche` (badge, stelle→livello_affidabilita, grado_presenza da soglie).  
- **azioni_log** → timeline audit (fonte dati per report, badge, IA reputazionale).

---

## 15) Schema campi pubblici (vetrina e SEO)

```js
imprese_pubbliche/{email} = {
  nome: string,                     // mostrare sempre
  comune: string,                   // geolocalizzazione e SEO locale
  logo_url: string,                 // ottimizzato (WebP/AVIF)
  descrizione: string,              // media lunghezza
  servizi: list,                    // <=20 voci
  livello_affidabilita: number,     // 1..5 (stelle_correnti)
  grado_presenza: "Base"|"Buona"|"Alta", // da soglie punti (es. <200, 200–599, ≥600)
  badge: "base"|"presente"|"certificata"|"top",
  reputazione_media: number,        // 0..100
  link_profilo: string,             // URL pubblico
  aggiornato_il: timestamp
}
```
**Privacy:** nessun dato sensibile (crediti, saldo, timestamp tecnici).  
**Aggiornamento:** solo via `syncPublicProfile()` per coerenza e sicurezza.

---

## 16) Integrazione con dashboard OFI (UI/UX)

- **Dashboard Impresa (privata):**  
  - Widget **Stelle correnti**, **Punti saldo**, **Crediti**, **Reputazione** (indicatore a colori).  
  - Pulsante “**Converti punti**” → controlla cooldown e minimi.  
  - Storico **Azioni recenti** (lista da `azioni_log`).  
  - Pill “**Attività 30gg**” con barra progresso → target 50 per 5⭐.  
- **Dashboard Admin:**  
  - Moderazione **recensioni**, gestione **segnalazioni**, modifica **config/ofi_points**.  
  - Monitor **classifica attività** (query su `imprese_registrate` ordinando per `punti_saldo`).  
- **Dashboard Cittadino:**  
  - Form **lascia recensione** (post-esperienza o QR), 1 per `(utente, ref_id)`.  
- **Netlify Functions collegate:**  
  - `/onAzioneCreata`, `/onRecensioneChange`, `/jobDecadimento` (cron 03:00 UTC), `/convertiPuntiInCrediti`, `/syncPublicProfile`.  
- **Messaggistica UI:**  
  - Conversione: “Hai convertito N punti in M crediti (cooldown 15 giorni).”  
  - Inattività: “Sei inattivo da X giorni: −Y punti applicati, attività 30gg aggiornata.”  
  - 5⭐ condizionate: “Per mantenere 5⭐ servono ≥50 punti nelle ultime 4 settimane.”

---

### Fine documento — **MASTER definitivo**.
