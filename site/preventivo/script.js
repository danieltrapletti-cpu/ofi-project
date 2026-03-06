document.addEventListener("DOMContentLoaded", function () {
  const urgenteBtn = document.getElementById("urgenteBtn");
  const elenco = document.getElementById("lista-imprese");
  const mappaDiv = document.getElementById("mappa");
  let map, marker;

  if (urgenteBtn) {
    urgenteBtn.addEventListener("click", () => {
      if (navigator.geolocation) {
        urgenteBtn.innerText = "Localizzazione in corso...";
        navigator.geolocation.getCurrentPosition(mostraMappa, mostraErrore);
      } else {
        alert("La geolocalizzazione non è supportata dal tuo browser.");
      }
    });
  }

  function mostraMappa(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    if (confirm(`Ti trovi in latitudine ${lat.toFixed(4)}, longitudine ${lng.toFixed(4)}?`)) {
      if (!map && mappaDiv) {
        map = new mapboxgl.Map({
          container: 'mappa',
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [lng, lat],
          zoom: 10
        });

        new mapboxgl.Marker({ color: 'blue' })
          .setLngLat([lng, lat])
          .setPopup(new mapboxgl.Popup().setText("La tua posizione"))
          .addTo(map);
      } else {
        map.setCenter([lng, lat]);
        map.setZoom(10);
      }

      fetch("imprese.json")
        .then(response => response.json())
        .then(imprese => {
          elenco.innerHTML = "";
          const vicine = imprese.map(impresa => {
            const distanza = Math.sqrt(
              Math.pow(impresa.lat - lat, 2) + Math.pow(impresa.lng - lng, 2)
            );
            return { ...impresa, distanza };
          }).sort((a, b) => a.distanza - b.distanza).slice(0, 5);

          vicine.forEach(impresa => {
            const card = document.createElement("div");
            card.innerHTML = `<strong>${impresa.nome}</strong> - ${impresa.comune} (${(impresa.distanza * 111).toFixed(1)} km)`;
            elenco.appendChild(card);

            if (map) {
              new mapboxgl.Marker()
                .setLngLat([impresa.lng, impresa.lat])
                .setPopup(new mapboxgl.Popup().setHTML(`<strong>${impresa.nome}</strong><br>${impresa.comune}`))
                .addTo(map);
            }
          });
        });
    }
  }).addTo(map);
      } else {
        map.setView([lat, lng], 8);
      }

      if (!marker) {
        marker = L.marker([lat, lng]).addTo(map).bindPopup("La tua posizione").openPopup();
      } else {
        marker.setLatLng([lat, lng]).openPopup();
      }

      fetch("imprese.json")
        .then(response => response.json())
        .then(imprese => {
          elenco.innerHTML = "";
          const vicine = imprese.map(impresa => {
            const distanza = Math.sqrt(
              Math.pow(impresa.lat - lat, 2) + Math.pow(impresa.lng - lng, 2)
            );
            return { ...impresa, distanza };
          }).sort((a, b) => a.distanza - b.distanza).slice(0, 5);

          vicine.forEach(impresa => {
            const card = document.createElement("div");
            card.innerHTML = `<strong>${impresa.nome}</strong> - ${impresa.comune} (${(impresa.distanza * 111).toFixed(1)} km)`;
            elenco.appendChild(card);
          });
          vicine.forEach(impresa => {
            if (map) {
              const impresaMarker = L.marker([impresa.lat, impresa.lng]).addTo(map);
              impresaMarker.bindPopup(`<strong>${impresa.nome}</strong><br>${impresa.comune}`);
            }
          });

        });
    }
  }

  function mostraErrore() {
    alert("Impossibile rilevare la posizione.");
  }

  // SELEZIONE MANUALE IMPRESE NEL MODULO PREVENTIVO
  const tutteLeImprese = [
    { nome: "Onoranze Alfa", logo: "🕊️", comune: "Bergamo" },
    { nome: "Funeraria Beta", logo: "🌹", comune: "Seriate" },
    { nome: "Serenità Srl", logo: "⚰️", comune: "Albano Sant'Alessandro" },
    { nome: "Memoria Viva", logo: "🖤", comune: "Torre Boldone" },
    { nome: "Pace Eterna", logo: "🕯️", comune: "Seriate" },
    { nome: "Cielo Blu", logo: "✨", comune: "Scanzorosciate" },
    { nome: "Tranquillità", logo: "🪦", comune: "Seriate" }
  ];

  window.mostraSelezioneImprese = function (comune) {
    const elenco = tutteLeImprese.filter(i => i.comune.toLowerCase() === comune.toLowerCase());
    const contenitore = document.getElementById("listaImpreseManuali");
    contenitore.innerHTML = "";

    if (elenco.length === 0) {
      contenitore.innerHTML = "<p>Nessuna impresa trovata per questo comune.</p>";
    } else {
      elenco.forEach((i) => {
        contenitore.innerHTML += `
          <div style="margin-bottom:0.5rem;">
            <label>
              <input type="checkbox" name="impreseManuali" value="${i.nome}" onchange="limitaSelezione(this)"> 
              ${i.logo} <strong>${i.nome}</strong> - ${i.comune}
            </label>
          </div>`;
      });
    }

    document.getElementById("selezioneImpreseManuale").style.display = "block";
    window.scrollTo({ top: document.getElementById("selezioneImpreseManuale").offsetTop - 60, behavior: "smooth" });
  };

  window.limitaSelezione = function (checkbox) {
    const selezionati = document.querySelectorAll("input[name='impreseManuali']:checked");
    if (selezionati.length > 10) {
      checkbox.checked = false;
      alert("Puoi selezionare al massimo 10 imprese.");
    }
  };

  window.confermaSelezioneManuale = function () {
    const selezionati = document.querySelectorAll("input[name='impreseManuali']:checked");
    if (selezionati.length === 0) {
      alert("Seleziona almeno una impresa.");
      return;
    }
    const scelte = Array.from(selezionati).map(cb => cb.value);
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = "impreseSelezionate";
    hidden.value = scelte.join(", ");
    document.querySelector("#preventivoForm form").appendChild(hidden);

    document.getElementById("preventivoForm").style.display = "block";
    window.scrollTo({ top: document.getElementById("preventivoForm").offsetTop - 60, behavior: "smooth" });
  };
});


// Funzioni per selezione manuale aggiornata
window.startManuale = function () {
  document.getElementById("manualComuneBox").style.display = "block";
  document.getElementById("manualComuneBox").scrollIntoView({ behavior: "smooth" });
};

window.rifiutaImprese = function () {
  document.getElementById("previewImprese").style.display = "none";
  document.getElementById("manualComuneBox").style.display = "block";
  document.getElementById("manualComuneBox").scrollIntoView({ behavior: "smooth" });
};

window.confermaComuneManuale = function () {
  const comune = document.getElementById("manualComune").value.trim();
  if (comune.length < 2) {
    alert("Inserisci un comune valido.");
    return;
  }
  document.getElementById("manualComuneBox").style.display = "none";
  document.getElementById("comuneText").innerText = comune;
  document.getElementById("comuneConfermato").style.display = "block";
  mostraSelezioneImprese(comune);
};

window.mostraSelezioneImprese = function (comune) {
  const tutteLeImprese = [
    { nome: "Onoranze Alfa", logo: "🕊️", comune: "Bergamo" },
    { nome: "Funeraria Beta", logo: "🌹", comune: "Seriate" },
    { nome: "Serenità Srl", logo: "⚰️", comune: "Albano Sant'Alessandro" },
    { nome: "Memoria Viva", logo: "🖤", comune: "Torre Boldone" },
    { nome: "Pace Eterna", logo: "🕯️", comune: "Seriate" },
    { nome: "Cielo Blu", logo: "✨", comune: "Scanzorosciate" },
    { nome: "Tranquillità", logo: "🪦", comune: "Seriate" }
  ];

  const elenco = tutteLeImprese.filter(i => i.comune.toLowerCase() === comune.toLowerCase());
  const contenitore = document.getElementById("listaImpreseManuali");
  contenitore.innerHTML = "";

  if (elenco.length === 0) {
    contenitore.innerHTML = "<p>Nessuna impresa trovata per questo comune.</p>";
  } else {
    elenco.forEach((i) => {
      contenitore.innerHTML += `
        <div style="margin-bottom:0.5rem;">
          <label>
            <input type="checkbox" name="impreseManuali" value="${i.nome}" onchange="limitaSelezione(this)"> 
            ${i.logo} <strong>${i.nome}</strong> - ${i.comune}
          </label>
        </div>`;
    });
  }

  document.getElementById("selezioneImpreseManuale").style.display = "block";
  document.getElementById("selezioneImpreseManuale").scrollIntoView({ behavior: "smooth" });
};

window.limitaSelezione = function (checkbox) {
  const selezionati = document.querySelectorAll("input[name='impreseManuali']:checked");
  if (selezionati.length > 10) {
    checkbox.checked = false;
    alert("Puoi selezionare al massimo 10 imprese.");
  }
};

window.confermaSelezioneManuale = function () {
  const selezionati = document.querySelectorAll("input[name='impreseManuali']:checked");
  if (selezionati.length === 0) {
    alert("Seleziona almeno una impresa.");
    return;
  }
  const scelte = Array.from(selezionati).map(cb => cb.value);
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = "impreseSelezionate";
  hidden.value = scelte.join(", ");
  document.querySelector("#preventivoForm form").appendChild(hidden);

  document.getElementById("selezioneImpreseManuale").style.display = "none";
  document.getElementById("preventivoForm").style.display = "block";
  window.scrollTo({ top: document.getElementById("preventivoForm").offsetTop - 60, behavior: "smooth" });
};



function startManuale() {
  const box = document.getElementById("manualComuneBox");
  if (box) {
    box.style.display = "block";
    box.scrollIntoView({ behavior: "smooth" });
  }
});
  }
}

function confermaComuneManuale() {
  const comuneInput = document.getElementById("manualComune");
  if (!comuneInput || comuneInput.value.trim().length < 2) {
    alert("Inserisci un comune valido.");
    return;
  }
  const comune = comuneInput.value.trim();
  window.location.href = "/elenco-imprese.html?comune=" + encodeURIComponent(comune);
}
