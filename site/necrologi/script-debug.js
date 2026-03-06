
document.addEventListener("DOMContentLoaded", () => {
  const necrologi = JSON.parse(localStorage.getItem("necrologi")) || [];

  // Verifica se già esiste il necrologio fittizio
  if (!necrologi.some(n => n.id === 999)) {
    necrologi.push({
      id: 999,
      nome: "Giulia Bianchi",
      vedIn: "Verdi",
      eta: 85,
      frase: "È mancata all'affetto dei suoi cari",
      testo: "Ne danno il triste annuncio i figli e i nipoti con affetto.",
      ringraziamenti: "Un grazie di cuore a chi vorrà unirsi al ricordo.",
      luogo: "Milano",
      data: "2025-05-15",
      croce: true,
      foto: "",
      autore: "Onoranze Funebri Italia",
      stato: "approvato"
    });

    localStorage.setItem("necrologi", JSON.stringify(necrologi));
    console.log("Necrologio di test aggiunto.");
  } else {
    console.log("Necrologio di test già presente.");
  }
});
