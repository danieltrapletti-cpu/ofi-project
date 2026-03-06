
document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("contenitore-necrologi");
  const filtroNome = document.getElementById("filtroNome");
  const filtroLuogo = document.getElementById("filtroLuogo");

  function formattaData(dataISO) {
    const mesi = [
      "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
      "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
    ];
    const [anno, mese, giorno] = dataISO.split("-");
    return `${parseInt(giorno)} ${mesi[parseInt(mese) - 1]} ${anno}`;
  }

  function render() {
    const necrologi = (JSON.parse(localStorage.getItem("necrologi")) || [])
      .filter(n => n.stato === "approvato" || n.stato === "pubblicato")
      .sort((a, b) => new Date(b.data) - new Date(a.data))
      .filter(n =>
        (!filtroNome.value || n.nome?.toLowerCase().includes(filtroNome.value.toLowerCase())) &&
        (!filtroLuogo.value || n.luogo?.toLowerCase().includes(filtroLuogo.value.toLowerCase()))
      )
      .slice(0, 10);

    if (necrologi.length === 0) {
      container.innerHTML = "<p style='text-align:center;'>Nessun necrologio trovato.</p>";
      return;
    }

    container.innerHTML = necrologi.map(n => `
      <div class="necrologio">
        ${n.foto ? `<img src="${n.foto}" alt="Foto defunto">` : `<img src="images/rosa.png" alt="Foto defunto">`}
        <h2>${n.nome}</h2>
        ${n.vedIn ? `<p><em>In ${n.vedIn}</em></p>` : ""}
        <p><em>${n.frase || ""}</em></p>
        <p>${n.testo || ""}</p>
        <p><strong>${n.luogo || ""}</strong> - ${n.data ? formattaData(n.data) : ""}</p>
        <small>Pubblicato da ${n.autore || "Onoranze Funebri Italia"}</small>
        <a href="necrologi/pagina-singola.html?id=${n.id}" class="btn-link">Apri Necrologio</a>
      </div>
    `).join("");
  }

  filtroNome.addEventListener("input", render);
  filtroLuogo.addEventListener("input", render);

  render();
});
