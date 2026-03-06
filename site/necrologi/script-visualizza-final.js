document.addEventListener("DOMContentLoaded", () => {
  const id = new URLSearchParams(window.location.search).get("id");
  const necrologi = JSON.parse(localStorage.getItem("necrologi")) || [];
  const necrologio = necrologi.find(n => n.id === id);
  if (!necrologio) {
    alert("Necrologio non trovato.");
    return;
  }

  const $ = id => document.getElementById(id);

  // Campi
  $("nome").value = necrologio.nome || "";
  $("eta").value = necrologio.eta || "";
  $("frase").value = necrologio.frase || "";
  $("testo").value = necrologio.testo || "";
  $("ringraziamenti").value = necrologio.ringraziamenti || "";
  $("luogo").value = necrologio.luogo || "";
  $("data").value = necrologio.data || "";
  $("croce").checked = necrologio.croce || false;
  $("autore").value = necrologio.autore || "";
  $("foto-anteprima").src = necrologio.foto || "../images/rosa.png";

  $("badge-stato").textContent = statoLabel(necrologio.stato);
  $("badge-stato").className = "stato-badge " + necrologio.stato;

  const log = necrologio.log || [];
  const logList = $("log-lista");
  logList.innerHTML = log.map(entry => `<li>${entry}</li>`).join("");

  $("foto").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        necrologio.foto = ev.target.result;
        $("foto-anteprima").src = ev.target.result;
        aggiornaAnteprima();
      };
      reader.readAsDataURL(file);
    }
  });

  function statoLabel(stato) {
    switch (stato) {
      case "approvato": return "Approvato";
      case "rifiutato": return "Rifiutato";
      case "eliminato": return "Eliminato";
      default: return "In Attesa";
    }
  }

  function aggiornaLog(msg) {
    const entry = `[${new Date().toLocaleString()}] ${msg}`;
    log.push(entry);
    necrologio.log = log;
    $("log-lista").innerHTML = log.map(e => `<li>${e}</li>`).join("");
  }

  function salva(stato, redirect = false) {
    necrologio.nome = $("nome").value;
    necrologio.eta = $("eta").value;
    necrologio.frase = $("frase").value;
    necrologio.testo = $("testo").value;
    necrologio.ringraziamenti = $("ringraziamenti").value;
    necrologio.luogo = $("luogo").value;
    necrologio.data = $("data").value;
    necrologio.croce = $("croce").checked;
    necrologio.dataModifica = new Date().toLocaleString();
    if (stato) necrologio.stato = stato;
    aggiornaLog(stato ? `Stato aggiornato a "${stato}"` : "Modificato");

    const tutti = JSON.parse(localStorage.getItem("necrologi")) || [];
    const index = tutti.findIndex(n => n.id === necrologio.id);
    if (index !== -1) {
      tutti[index] = necrologio;
      localStorage.setItem("necrologi", JSON.stringify(tutti));
    }

    if (redirect) {
      const msg = document.createElement("div");
      msg.className = "popup-messaggio";
      msg.textContent = `Necrologio aggiornato come "${statoLabel(stato)}"`;
      document.body.appendChild(msg);
      setTimeout(() => {
        msg.remove();
        window.location.href = "../admin/necrologi-admin.html";
      }, 2000);
    } else {
      alert("Salvato con successo.");
    }
  }

  $("salva").onclick = () => salva(null);
  $("approva").onclick = () => salva("approvato", true);
  $("rifiuta").onclick = () => salva("rifiutato", true);
  $("attesa").onclick = () => salva("attesa", true);
  $("elimina").onclick = () => {
    if (confirm("Vuoi davvero eliminare questo necrologio?")) {
      salva("eliminato", true);
    }
  };
  $("anteprima").onclick = aggiornaAnteprima;

  function aggiornaAnteprima() {
    const mese = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    const d = new Date($("data").value);
    const dataIt = isNaN(d.getTime()) ? "" : `${d.getDate()} ${mese[d.getMonth()]} ${d.getFullYear()}`;

    $("contenutoAnteprima").innerHTML = `
    <div style="max-width:500px; margin:2rem auto; padding:1.5rem; background:white; border-radius:8px; box-shadow:0 0 8px rgba(0,0,0,0.1); text-align:center;">
      ${$("croce").checked ? `<img src="../images/croce.png" style="height:80px; margin-bottom:1rem;">` : ""}
      <p style="font-style: italic;">${$("frase").value}</p>
      <img src="${$("foto-anteprima").src}" style="width:100%; max-width:250px; border-radius:8px; margin:1rem auto;">
      <h2>${$("nome").value}</h2>
      ${$("eta").value ? `<p><em>di anni ${$("eta").value}</em></p>` : ""}
      <p>${$("testo").value}</p>
      ${$("ringraziamenti").value ? `<p style="font-style: italic;">${$("ringraziamenti").value}</p>` : ""}
      ${$("luogo").value ? `<p><strong>${$("luogo").value}</strong></p>` : ""}
      ${dataIt ? `<p>${dataIt}</p>` : ""}
      <hr style="margin: 1.5rem 0;">
      <p style="font-size:0.9rem;">Pubblicato da ${$("autore").value || "OFI"}</p>
      <img src="../images/logo-ofi.png" style="height:40px; margin-top:0.5rem;">
    </div>`;
  }

  aggiornaAnteprima();
});