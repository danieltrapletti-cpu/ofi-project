// netlify/functions/debugEE.js
exports.handler = async () => {
  const keys = [
    'ELASTICEMAIL_API_KEY', 'EE_FROM_EMAIL', 'EE_FROM_NAME',
    'ADMIN_REPLY_TO', 'MAIL_SUBJECT'
  ];
  const out = {};
  for (const k of keys) {
    if (k === 'ELASTICEMAIL_API_KEY') {
      out[k] = process.env[k] ? '*** SET ***' : 'MISSING';
    } else {
      out[k] = process.env[k] || 'MISSING';
    }
  }
  return { statusCode: 200, body: JSON.stringify(out, null, 2) };
};
