
mapboxgl.accessToken = 'pk.eyJ1IjoiZHQ4MiIsImEiOiJjbWFtem4xN2Ewbmx4Mm1zZHgzaGRhbXZzIn0.RwNWi1alAkO61qgd3AjEsg';

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const id = parseInt(params.get("id"));
  const container = document.getElementById("contenuto-necessario");
  const impresaBox = document.getElementById("impresa-info");
  const titoloMappa = document.getElementById("titolo-mappa");

  const necrologi = JSON.parse(localStorage.getItem("necrologi")) || [];
  const necrologio = necrologi.find(n => n.id === id);

  if (!necrologio) {
    container.innerHTML = "<p>Necrologio non trovato.</p>";
    return;
  }

  const viewsKey = `views-${id}`;
  let views = parseInt(localStorage.getItem(viewsKey) || "0");
  views++;
  localStorage.setItem(viewsKey, views);

  const formattaData = iso => {
    const [y, m, d] = iso.split("-");
    const mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
    return `${parseInt(d)} ${mesi[parseInt(m)-1]} ${y}`;
  };

  container.innerHTML = `
    <h1>🕊️ In memoria di ${necrologio.nome}</h1>
    ${necrologio.vedIn ? `<p><em>In ${necrologio.vedIn}</em></p>` : ""}
    <img src="${necrologio.foto || "../images/rosa.png"}" alt="Foto" />
    <div class="info-chiave">
      <p><strong>Età:</strong> ${necrologio.eta || "N/D"} &nbsp;&nbsp;
      <strong>Luogo:</strong> ${necrologio.luogo || "N/D"} &nbsp;&nbsp;
      <strong>Data:</strong> ${necrologio.data ? formattaData(necrologio.data) : "N/D"}</p>
    </div>
    <div class="testo">
      <p><em>${necrologio.frase || ""}</em></p>
      <p>${necrologio.testo || ""}</p>
      ${necrologio.ringraziamenti ? `<p><em>${necrologio.ringraziamenti}</em></p>` : ""}
      <p><small>👁️ Visualizzazioni: ${views}</small></p>
    </div>
  `;

  if (necrologio.impresa_id) {
    impresaBox.innerHTML = `Pubblicato da: <a href="../imprese/profilo.html?id=${necrologio.impresa_id}" style="color:#002b5c;font-weight:bold;text-decoration:none;">${necrologio.autore || "Impresa Funebre"}</a>`;
  } else {
    impresaBox.innerHTML = `<p>Pubblicato da: ${necrologio.autore || "Onoranze Funebri Italia"}</p>`;
  }

  QRCode.toCanvas(document.getElementById("qr"), window.location.href);

  const regione = necrologio.regione || null;
  let lat = 42.5, lon = 12.5, zoom = 5;
  if (regione && centriRegionali[regione]) {
    [lat, lon] = centriRegionali[regione];
    zoom = 8;
  }

  if (titoloMappa && necrologio.nome && necrologio.luogo) {
    titoloMappa.textContent = `📍 In ricordo di ${necrologio.nome} – ${necrologio.luogo}${regione ? " (" + regione + ")" : ""}`;
  }

  const mappa = new mapboxgl.Map({
    container: 'mappa',
    style: 'mapbox://styles/mapbox/light-v11',
    center: [lon, lat],
    zoom: zoom,
    pitch: 55,
    bearing: -20,
    antialias: true
  });

  new mapboxgl.Marker().setLngLat([lon, lat]).setPopup(new mapboxgl.Popup().setText(necrologio.luogo)).addTo(mappa);

  const pensieri = JSON.parse(localStorage.getItem("pensieri")) || [];
  const pensieriFiltrati = pensieri.filter(p => p.idNecrologio === id && p.approvato);
  const pensieriList = document.getElementById("pensieriList");

  if (pensieriFiltrati.length > 0) {
    pensieriList.innerHTML = pensieriFiltrati.map((p, index) => `
      <div class="pensiero-item" style="margin-bottom:1.5rem;">
        <strong>${p.nome}</strong><br/>
        <p>${p.testo}</p>
        <small>🕒 ${p.data}</small><br/>
        <div class="reazioni">❤️ ${p.cuori || 0} 🌹 ${p.rose || 0} 🕯️ ${p.luci || 0}</div>
        <a href="#" onclick="segnala(${index}); return false;" style="color:#a00;font-size:0.9rem;">🚩 Segnala</a>
        <a href="#" onclick="rispondi(${index}); return false;" style="margin-left:10px;font-size:0.9rem;">📩 Rispondi</a>
        ${p.risposte && p.risposte.length > 0 ? `<div style='margin-top:0.7rem;background:#eef;padding:0.6rem;border-left:4px solid #448;border-radius:6px;'>
          ${p.risposte.map(r => `<div><strong>📬 ${r.autore}:</strong><br/>${r.testo}</div>`).join("<hr style='margin:6px 0;'/>")}
        </div>` : ""}
      </div>
    `).join("");
  }

  window.inviaPensiero = function () {
    const autore = document.getElementById("autore").value.trim() || "Anonimo";
    const testo = document.getElementById("pensiero").value.trim();
    if (!testo) return alert("Scrivi un messaggio.");
    const nuovo = {
      idNecrologio: id,
      nome: autore,
      testo,
      data: new Date().toLocaleString(),
      cuori: 0, rose: 0, luci: 0,
      approvato: true,
      risposte: []
    };
    pensieri.push(nuovo);
    localStorage.setItem("pensieri", JSON.stringify(pensieri));
    location.reload();
  };

  window.rispondi = function(index) {
    const risposta = prompt("Scrivi la tua risposta:");
    if (!risposta) return;
    const nomeRispondente = prompt("Il tuo nome:") || "Anonimo";
    pensieriFiltrati[index].risposte = pensieriFiltrati[index].risposte || [];
    pensieriFiltrati[index].risposte.push({ autore: nomeRispondente, testo: risposta });
    localStorage.setItem("pensieri", JSON.stringify(pensieri));
    location.reload();
  };

  window.segnala = function(index) {
    if (confirm("Vuoi segnalare questo messaggio?")) {
      pensieriFiltrati[index].segnalato = true;
      alert("Grazie per la segnalazione. Il contenuto sarà esaminato.");
      localStorage.setItem("pensieri", JSON.stringify(pensieri));
    }
  };

  window.condividiFacebook = function () {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
  };

  window.condividiWhatsApp = function () {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://api.whatsapp.com/send?text=${url}`, '_blank');
  };
});


// 👇 Sovrascriviamo rendering pensieri per includere bottoni reazione reali
function renderPensieri() {
  const pensieri = JSON.parse(localStorage.getItem("pensieri")) || [];
  const id = parseInt(new URLSearchParams(window.location.search).get("id"));
  const pensieriFiltrati = pensieri.filter(p => p.idNecrologio === id && p.approvato);
  const pensieriList = document.getElementById("pensieriList");
  if (!pensieriList) return;

  pensieriList.innerHTML = pensieriFiltrati.map((p, index) => `
    <div class="pensiero-item">
      <strong>${p.nome}</strong>
      <p>${p.testo}</p>
      <small>${p.data}</small>
      <div class="reazioni">
        <button class="cuore-btn" data-id="${index}" style="background:none;border:none;cursor:pointer;">❤️ ${p.cuori || 0}</button>
        <button class="rosa-btn" data-id="${index}" style="background:none;border:none;cursor:pointer;">🌹 ${p.rose || 0}</button>
        <button class="luce-btn" data-id="${index}" style="background:none;border:none;cursor:pointer;">🕯️ ${p.luci || 0}</button>
      </div>
      <div class="azioni">
        <a href="#" onclick="segnala(${index}); return false;">🚩 Segnala</a>
        <a href="#" onclick="rispondi(${index}); return false;">📩 Rispondi</a>
      </div>
      ${p.risposte && p.risposte.length > 0 ? `<div class='risposta-box'>
        ${p.risposte.map(r => `<div><strong>📬 ${r.autore}:</strong><br/>${r.testo}</div>`).join("<hr style='margin:6px 0;'/>")}
      </div>` : ""}
    </div>
  `).join("");

  aggiornaContatore();
  aggiornaReazioni();
}

// Eventi reazioni
function aggiornaReazioni() {
  const pensieri = JSON.parse(localStorage.getItem("pensieri")) || [];
  const id = parseInt(new URLSearchParams(window.location.search).get("id"));
  const pensieriFiltrati = pensieri.filter(p => p.idNecrologio === id && p.approvato);

  document.querySelectorAll(".cuore-btn").forEach(btn => {
    const i = parseInt(btn.dataset.id);
    btn.addEventListener("click", () => {
      pensieriFiltrati[i].cuori = (pensieriFiltrati[i].cuori || 0) + 1;
      localStorage.setItem("pensieri", JSON.stringify(pensieri));
      renderPensieri();
    });
  });

  document.querySelectorAll(".rosa-btn").forEach(btn => {
    const i = parseInt(btn.dataset.id);
    btn.addEventListener("click", () => {
      pensieriFiltrati[i].rose = (pensieriFiltrati[i].rose || 0) + 1;
      localStorage.setItem("pensieri", JSON.stringify(pensieri));
      renderPensieri();
    });
  });

  document.querySelectorAll(".luce-btn").forEach(btn => {
    const i = parseInt(btn.dataset.id);
    btn.addEventListener("click", () => {
      pensieriFiltrati[i].luci = (pensieriFiltrati[i].luci || 0) + 1;
      localStorage.setItem("pensieri", JSON.stringify(pensieri));
      renderPensieri();
    });
  });
}

// Conteggio e mostra tutto
function aggiornaContatore() {
  const counter = document.getElementById("pensieroCounter");
  if (counter) {
    const pensieri = document.querySelectorAll(".pensiero-item");
    counter.textContent = `${pensieri.length} pensiero${pensieri.length !== 1 ? "i" : ""}`;
  }
}

function mostraTutti() {
  document.querySelectorAll(".pensiero-item").forEach(el => el.style.display = "block");
  const btn = document.querySelector(".show-more-btn");
  if (btn) btn.style.display = "none";
}

// Inizializzazione
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    renderPensieri();
    const pensieri = document.querySelectorAll(".pensiero-item");
    if (pensieri.length > 3) {
      pensieri.forEach((el, idx) => {
        if (idx >= 3) el.style.display = "none";
      });
      const btn = document.querySelector(".show-more-btn");
      if (btn) btn.style.display = "inline-block";
    }
  }, 500);
});
