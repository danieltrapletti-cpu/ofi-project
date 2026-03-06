
document.addEventListener("DOMContentLoaded", () => {
  const input = document.querySelector('input[name="luogo"]');
  const hiddenRegione = document.createElement("input");
  hiddenRegione.type = "hidden";
  hiddenRegione.name = "regione";
  input.parentNode.appendChild(hiddenRegione);

  const hiddenOrigine = document.createElement("input");
  hiddenOrigine.type = "hidden";
  hiddenOrigine.name = "origineComune";
  input.parentNode.appendChild(hiddenOrigine);

  const suggerimenti = document.createElement("div");
  suggerimenti.style.border = "1px solid #ccc";
  suggerimenti.style.maxHeight = "200px";
  suggerimenti.style.overflowY = "auto";
  suggerimenti.style.position = "absolute";
  suggerimenti.style.backgroundColor = "#fff";
  suggerimenti.style.zIndex = 1000;
  suggerimenti.style.display = "none";
  input.parentNode.appendChild(suggerimenti);

  const guida = document.createElement("div");
  guida.style.fontSize = "0.85rem";
  guida.style.marginTop = "6px";
  guida.innerHTML = "ℹ️ Seleziona un comune valido oppure scrivi una località a mano (es. frazione).";
  input.parentNode.appendChild(guida);

  const iconaStato = document.createElement("span");
  iconaStato.style.marginLeft = "10px";
  input.parentNode.appendChild(iconaStato);

  input.addEventListener("input", () => {
    const valore = input.value.trim().toLowerCase();
    suggerimenti.innerHTML = "";
    hiddenRegione.value = "";
    hiddenOrigine.value = "manuale";
    iconaStato.textContent = "❌ Comune non riconosciuto";

    if (!valore || valore.length < 2) {
      suggerimenti.style.display = "none";
      return;
    }

    const trovati = comuniItalia.filter(c => c.nome.toLowerCase().includes(valore));
    trovati.sort((a, b) => {
      const aInizia = a.nome.toLowerCase().startsWith(valore) ? 0 : 1;
      const bInizia = b.nome.toLowerCase().startsWith(valore) ? 0 : 1;
      return aInizia - bInizia || a.nome.localeCompare(b.nome);
    });

    trovati.slice(0, 10).forEach(c => {
      const voce = document.createElement("div");
      voce.textContent = `${c.nome} (${c.regione})`;
      voce.style.padding = "5px";
      voce.style.cursor = "pointer";
      voce.addEventListener("click", () => {
        input.value = c.nome;
        hiddenRegione.value = c.regione;
        hiddenOrigine.value = "autocomplete";
        suggerimenti.innerHTML = "";
        suggerimenti.style.display = "none";
        iconaStato.textContent = "✅ Comune riconosciuto";
      });
      suggerimenti.appendChild(voce);
    });

    suggerimenti.style.display = trovati.length > 0 ? "block" : "none";
  });

  document.addEventListener("click", e => {
    if (!suggerimenti.contains(e.target) && e.target !== input) {
      suggerimenti.style.display = "none";
    }
  });
});
