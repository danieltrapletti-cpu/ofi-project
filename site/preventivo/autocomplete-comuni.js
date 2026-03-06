
document.addEventListener("DOMContentLoaded", function () {
  const input = document.getElementById("manualComune");
  const procediBtn = document.getElementById("procediManuale");

  if (!input || !procediBtn) return;

  fetch("comuni.json")
    .then(response => response.json())
    .then(comuni => {
      const status = document.getElementById("comuneStatus") || (() => {
        const s = document.createElement("div");
        s.id = "comuneStatus";
        s.style.marginTop = "0.5rem";
        s.style.fontWeight = "bold";
        input.parentNode.appendChild(s);
        return s;
      })();

      function normalize(s) {
        return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
      }

      function aggiornaStatusComune(valoreManuale) {
        const val = normalize(valoreManuale || input.value);
        if (!val) {
          status.innerText = "";
          return false;
        }

        const trovatoComune = comuni.find(c => normalize(c.nome) === val);
        if (trovatoComune) {
          status.innerText = "✅ Comune identificato: " + trovatoComune.nome;
          status.style.color = "green";
          return true;
        } else {
          status.innerText = "⚠️ Comune non riconosciuto (puoi comunque procedere)";
          status.style.color = "#cc0000";
          return false;
        }
      }

      input.addEventListener("input", function () {
        const val = normalize(this.value);
        const suggerimenti = comuni.filter(c => normalize(c.nome).startsWith(val)).slice(0, 6);
        closeAllLists();

        aggiornaStatusComune();

        if (!val || suggerimenti.length === 0) return;

        const list = document.createElement("div");
        list.setAttribute("id", this.id + "-autocomplete-list");
        list.setAttribute("class", "autocomplete-items");
        this.parentNode.appendChild(list);

        suggerimenti.forEach(s => {
          const item = document.createElement("div");
          item.innerHTML = "<strong>" + s.nome.substr(0, this.value.length) + "</strong>" + s.nome.substr(this.value.length);
          item.innerHTML += "<input type='hidden' value='" + s.nome + "'>";
          item.addEventListener("click", function () {
            input.value = this.getElementsByTagName("input")[0].value;
            closeAllLists();
            aggiornaStatusComune(input.value);
          });
          list.appendChild(item);
        });
      });

      procediBtn.addEventListener("click", function () {
        const comune = input.value.trim();
        if (!comune || comune.length < 2) {
          alert("⚠️ Inserisci un nome di comune valido.");
          return;
        }
        // Permettiamo sempre il redirect, anche se il comune non è riconosciuto
        window.location.href = "/elenco-imprese.html?comune=" + encodeURIComponent(comune);
      });

      function closeAllLists(elmnt) {
        const items = document.getElementsByClassName("autocomplete-items");
        for (let i = 0; i < items.length; i++) {
          if (elmnt !== items[i] && elmnt !== input) {
            items[i].parentNode.removeChild(items[i]);
          }
        }
      }

      document.addEventListener("click", function (e) {
        closeAllLists(e.target);
      });
    });
});
