
// Funzione per aggiornare i punti OFI su Firestore
function aggiornaPuntiOFI(emailImpresa, incremento) {
  const db = firebase.firestore();
  const docRef = db.collection("imprese_registrate").doc(emailImpresa);

  docRef.get().then(doc => {
    if (doc.exists) {
      const dati = doc.data();
      const puntiAttuali = dati.punti_ofi || 0;
      const nuoviPunti = puntiAttuali + incremento;

      docRef.update({
        punti_ofi: nuoviPunti
      }).then(() => {
        console.log(`✅ Punti aggiornati: ${nuoviPunti}`);
        // Aggiorna anche nella dashboard, se presente
        const el = document.getElementById("valoreOFI");
        if (el) el.textContent = `${nuoviPunti} pt`;
      });
    }
  });
}

// ESEMPIO: incremento +10 punti al completamento del profilo
const emailImpresa = "email_impresa@example.com"; // ← da rendere dinamico
aggiornaPuntiOFI(emailImpresa, 10);
