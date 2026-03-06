// netlify/functions/recaptcha-verify.js (ESM)
export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }
    const { token, action } = JSON.parse(event.body || "{}");
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing token" }) };
    }
    const secret = process.env.RECAPTCHA_SECRET;
    if (!secret) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing RECAPTCHA_SECRET" }) };
    }
    const resp = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token })
    });
    const data = await resp.json();
    const success = !!data.success;
    const score = typeof data.score === "number" ? data.score : 0;
    const threshold = 0.5;
    const actionOk = !action || !data.action || data.action === action;

    if (success && score >= threshold && actionOk) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, score, action: data.action || null }) };
    } else {
      return { statusCode: 200, body: JSON.stringify({ ok: false, score, action: data.action || null, error: data["error-codes"] || "low_score_or_failed" }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
