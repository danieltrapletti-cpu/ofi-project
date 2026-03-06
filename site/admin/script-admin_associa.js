
document.addEventListener("DOMContentLoaded", () => {
  const db = firebase.firestore();
  let impreseData = [];

  // Carica imprese.json per associare nome → email
  fetch("../imprese.json")
    .then(res => res.json())
    .then(data => {
      impreseData = data;
    });

  // Cerca email a partire dal nome impresa
  function getEmailByNome(nome) {
    const match = impreseData.find(i => i.nome.toLowerCase() === nome.toLowerCase());
    return match ? match.email : null;
  }

  function approvaPreventivo(id) {
    db.collection("preventivi").doc(id).get().then(doc => {
      if (!doc.exists) return alert("Preventivo non trovato.");
      const data = doc.data();
      const imprese = data.imprese || [];

      db.collection("preventivi").doc(id).update({ stato: "approvato" }).then(() => {
        if (Array.isArray(imprese)) {
          imprese.forEach(nomeImpresa => {
            const email = getEmailByNome(nomeImpresa);
            if (email) {
              console.log("📨 Invio email a:", email);
              emailjs.send("service_n1evk29", "template_lcg2hbv", {
                to_email: email,
                messaggio: `
                  Hai ricevuto una nuova richiesta di preventivo su <strong>Onoranze Funebri Italia</strong>.<br><br>
                  📄 ID Preventivo: <strong>${id}</strong><br>
                  ✉️ Accedi o registrati per visualizzarla:<br>
                  👉 <a href="https://www.onoranzefunebritalia.it/registrazione-imprese">Registrazione Imprese</a><br><br>
                  Grazie,<br>Il team OFI
                `
              });
            } else {
              console.warn("❌ Nessuna email trovata per:", nomeImpresa);
            }
          });
        }
        alert("Preventivo approvato e notifiche inviate.");
        caricaPreventivi();
      });
    });
  }

  // Assegna bottone "Approva"
  document.querySelectorAll(".approva").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (confirm("Vuoi approvare questo preventivo?")) {
        approvaPreventivo(id);
      }
    });
  });
});
