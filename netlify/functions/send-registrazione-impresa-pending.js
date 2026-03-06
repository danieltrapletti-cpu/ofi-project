const { sendMail } = require('./_email');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const { to, ragione_sociale } = JSON.parse(event.body || '{}');
    const base = process.env.FRONTEND_BASE_URL || '';
    const loginUrl = `${base}/imprese/login.html`;

    const subject = 'OFI – Registrazione ricevuta (in attesa di verifica)';
    const html = `
      <div style="font-family:ui-sans-serif,system-ui;line-height:1.6">
        <h2 style="margin:0 0 12px">Grazie per la registrazione</h2>
        <p>Ciao <strong>${ragione_sociale || ''}</strong>,<br/>
        abbiamo ricevuto la tua richiesta di registrazione su <strong>Onoranze Funebri Italia</strong>.</p>
        <p>Lo stato attuale è: <strong>in attesa di verifica</strong>.<br/>
        Ti invieremo un’email non appena sarà approvata.</p>
        <p>Puoi accedere alla tua area da qui: <a href="${loginUrl}">${loginUrl}</a></p>
        <hr/>
        <p style="font-size:12px;color:#666">OFI – Onoranze Funebri Italia</p>
      </div>`;

    await sendMail({ to, subject, html });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
