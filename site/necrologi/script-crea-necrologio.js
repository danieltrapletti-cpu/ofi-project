
function generaAnteprima() {
  const form = document.getElementById("necrologioForm");
  const dati = new FormData(form);
  const anteprima = document.getElementById("contenutoAnteprima");
  anteprima.innerHTML = "";

  const croce = dati.get("croce") ? '<img src="../images/croce.png" class="croce">' : "";
  const frase = dati.get("frase") || "";
  const nome = dati.get("nome") || "";

  const vedInRaw = (dati.get("vedIn") || "").trim();
  let vedIn = "";
  if (vedInRaw) {
    const lowercase = vedInRaw.toLowerCase();
    const hasPrefix = lowercase.startsWith("ved") || lowercase.startsWith("in");
    vedIn = hasPrefix ? vedInRaw : "Ved. " + vedInRaw;
    vedIn = `<div class='vedIn'>${vedIn}</div>`;
  }

  const eta = dati.get("eta") ? "<div class='eta'>di anni " + dati.get("eta") + "</div>" : "";
  const testo = dati.get("testo") || "";
  const ringraziamenti = dati.get("ringraziamenti") ? "<div class='ringraziamenti'>" + dati.get("ringraziamenti") + "</div>" : "";
  const luogo = dati.get("luogo") || "";
  const dataDecesso = dati.get("data");
  let dataFormattata = "";
  if (dataDecesso) {
    const data = new Date(dataDecesso);
    const mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    dataFormattata = `${data.getDate()} ${mesi[data.getMonth()]} ${data.getFullYear()}`;
  }

  const autore = dati.get("autore") || "";
  const immagineInput = form.querySelector("input[name='foto']").files[0];

  if (immagineInput) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const immagineTag = `<img src="${e.target.result}" alt="Immagine defunto" class="foto-defunto">`;
      mostraAnteprima(immagineTag);
    };
    reader.readAsDataURL(immagineInput);
  } else {
    const immagineTag = `<img src="../images/rosa.png" alt="Immagine defunto" class="foto-defunto">`;
    mostraAnteprima(immagineTag);
  }

  function mostraAnteprima(imgHtml) {
    anteprima.innerHTML = `
      <div class="necrologio">
        ${croce}
        <div class="frase">${frase}</div>
        ${imgHtml}
        <h2 class="nome">${nome}</h2>
        ${vedIn}
        ${eta}
        <p class="testo">${testo}</p>
        ${ringraziamenti}
        <div class="luogo">${luogo}</div>
        <div class="data">${dataFormattata}</div>
        <div class="firma">Pubblicato da ${autore || "Onoranze Funebri Italia"} <img src="../images/rosa.png" class="logo-pubblicazione"></div>
      </div>
    `;
    document.getElementById("anteprima").style.display = "block";
  }
}

function salvaNecrologio() {
  const form = document.getElementById("necrologioForm");
  const dati = new FormData(form);

  const veritiero = form.querySelector('[name="veritiero"]').checked;
  const privacy = form.querySelector('[name="privacy"]').checked;
  const tipoUtente = dati.get("tipoUtente") || "cittadino";
  const autore = dati.get("autore") || (tipoUtente === "impresa" ? "Impresa" : "");

  if (!veritiero || !privacy) {
    alert("Devi accettare le condizioni per proseguire.");
    return;
  }

  const id = "OFI-" + new Date().toISOString().replace(/[-:.TZ]/g, "") + "-" + Math.floor(Math.random() * 10000);
  const now = new Date().toLocaleString();
  const log = [`[${now}] Necrologio creato e inviato in attesa`];

  const nuovoNecrologio = {
    id,
    stato: "attesa",
    dataInvio: now,
    log,
    tipoUtente,
    croce: dati.get("croce") ? true : false,
    frase: dati.get("frase") || "",
    foto: "", // Gestione futura dell'immagine
    nome: dati.get("nome") || "",
    vedIn: dati.get("vedIn") || "",
    eta: dati.get("eta") || "",
    testo: dati.get("testo") || "",
    ringraziamenti: dati.get("ringraziamenti") || "",
    luogo: dati.get("luogo") || "",
    data: dati.get("data") || "",
    autore: autore
  };

  const necrologi = JSON.parse(localStorage.getItem("necrologi")) || [];
  necrologi.push(nuovoNecrologio);
  localStorage.setItem("necrologi", JSON.stringify(necrologi));

  alert("Necrologio inviato correttamente.");
  window.location.href = "../index.html";
}
