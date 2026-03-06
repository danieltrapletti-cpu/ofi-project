
document.addEventListener('DOMContentLoaded', () => {
  const id = new URLSearchParams(window.location.search).get('id');
  const necrologioContainer = document.getElementById('necrologioContent');
  const pensieriList = document.getElementById('pensieriList');
  const formPensiero = document.getElementById('formPensiero');
  const nomeInput = document.getElementById('nomePensiero');
  const testoInput = document.getElementById('testoPensiero');

  // Parole vietate (puoi aggiungerne altre)
  const paroleVietate = ['idiota', 'stupido', 'offensivo', 'insulto'];

  function contieneParoleVietate(testo) {
    return paroleVietate.some(parola => testo.toLowerCase().includes(parola));
  }

  async function caricaNecrologio() {
    try {
      const res = await fetch('necrologi.json');
      const data = await res.json();
      const n = data.find(item => item.id == id);
      if (!n) {
        necrologioContainer.innerHTML = '<p>Necrologio non trovato.</p>';
        return;
      }

      document.title = 'Necrologio - ' + n.nome;

      necrologioContainer.innerHTML = `
        ${n.croce === 'Sì' ? '<div class="croce">✝️</div>' : ''}
        <h1>${n.nome}</h1>
        <p class="messaggio">"${n.fraseIniziale}"</p>
        <p>${n.testoNecrologio}</p>
        <p><strong>${n.ringraziamenti}</strong></p>
        <p><img src="../images/eye-icon.png" style="height: 16px;" /> ${n.visualizzazioni || 0} visualizzazioni</p>
        <div class="reazioni">
          <button>❤️ ${n.reazioni?.cuori || 0}</button>
          <button>🌹 ${n.reazioni?.rose || 0}</button>
        </div>
        <div class="share-buttons">
          <p>Condividi su:</p>
          <a href="#">Facebook</a> | <a href="#">Twitter</a> | <a href="#">WhatsApp</a>
        </div>
      `;

      document.getElementById('firmaNecrologio').innerHTML =
        n.pubblicatoDa && n.logoImpresa
          ? `Pubblicato da <img src="${n.logoImpresa}" style="height:20px; vertical-align:middle;" /> ${n.pubblicatoDa}`
          : 'Pubblicato da Onoranze Funebri Italia';
    } catch (error) {
      console.error('Errore nel caricamento necrologio:', error);
    }
  }

  async function caricaPensieri() {
    try {
      const res = await fetch('pensieri.json');
      const dati = await res.json();
      const pensieri = dati.filter(p => p.idNecrologio == id && p.approvato);

      pensieriList.innerHTML = pensieri.map(p => `
        <div class="pensiero">
          <p><strong>${p.nome}</strong></p>
          <p>${p.testo}</p>
          <div class="reazioni">
            <button>❤️ ${p.cuori || 0}</button>
            <button>🌹 ${p.rose || 0}</button>
          </div>
          ${p.risposte?.map(r => `
            <div class="risposta">
              <p><strong>${r.nome}</strong>: ${r.testo}</p>
              <div class="reazioni">
                <button>❤️ ${r.cuori || 0}</button>
                <button>🌹 ${r.rose || 0}</button>
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
    } catch (error) {
      console.error('Errore nel caricamento pensieri:', error);
    }
  }

  formPensiero.addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = nomeInput.value.trim();
    const testo = testoInput.value.trim();

    if (contieneParoleVietate(testo)) {
      alert("Il tuo pensiero è stato inviato e sarà valutato prima della pubblicazione.");
    } else {
      alert("Il tuo pensiero è stato pubblicato!");
    }

    nomeInput.value = '';
    testoInput.value = '';
  });

  caricaNecrologio();
  caricaPensieri();
});
