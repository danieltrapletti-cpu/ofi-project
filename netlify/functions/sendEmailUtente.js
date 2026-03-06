const fetch = require("node-fetch"); // opzionale: se Netlify runtime Node 18+, fetch è globale

exports.handler = async (event) => {
  const { destinatario, nome } = JSON.parse(event.body || "{}");

  if (!destinatario || !nome) {
    return {
      statusCode: 400,
      body: "Parametri mancanti",
    };
  }

  try {
    const response = await fetch("https://api.elasticemail.com/v2/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        apikey: process.env.ELASTIC_API_KEY,
        subject: "La tua richiesta è stata inviata",
        from: "daniel.trapletti@gmail.com",
        fromName: "Onoranze Funebri Italia",
        to: destinatario,
        bodyHtml: `
          <p>Gentile ${nome},</p>
          <p>La tua richiesta è stata ricevuta e sarà approvata a breve.</p>
          <p>Dopo l'approvazione verrà inoltrata alle imprese selezionate.</p>
          <p>Potrai seguire tutto nella tua <a href="https://www.onoranzefunebritalia.it/dashboard-cittadino.html">area personale</a>.</p>
          <hr>
          <small>Grazie per aver scelto OFI. Non rispondere a questa email.</small>
        `,
      }).toString(),
    });

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ esito: "ok", data }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ esito: "errore", message: err.message }),
    };
  }
};
