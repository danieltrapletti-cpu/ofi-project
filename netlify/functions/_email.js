// netlify/functions/_email.js

const API_URL = 'https://api.elasticemail.com/v4/emails';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export function ok(body, status = 200, extra = {}) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
    body: JSON.stringify(body),
  };
}

export function bad(body, status = 400) {
  return ok({ error: true, ...body }, status);
}

export function handleOptions() {
  return { statusCode: 204, headers: CORS, body: '' };
}

export async function sendEmail({ to, subject, html, text, replyTo }) {
  const apiKey = process.env.ELASTICEMAIL_API_KEY;     // <-- come da tuo screen
  const from = process.env.EE_FROM_EMAIL;              // <-- come da tuo screen
  const fromName = process.env.EE_FROM_NAME || 'Italia OFI';

  if (!apiKey || !from) {
    throw new Error('Missing ELASTICEMAIL_API_KEY or EE_FROM_EMAIL');
  }

  const payload = {
    Recipients: [{ Email: to }],
    Content: {
      From: from,
      FromName: fromName,
      ReplyTo: replyTo || process.env.ADMIN_REPLY_TO || from,
      Subject: subject,
      Body: [
        { ContentType: 'HTML', Content: html },
        ...(text ? [{ ContentType: 'PlainText', Content: text }] : []),
      ],
    },
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'X-ElasticEmail-ApiKey': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`ElasticEmail error ${res.status}: ${msg}`);
  }

  return await res.json().catch(() => ({}));
}
