// netlify/functions/pensiero-page.js
const fmt = (d)=> d.toISOString().slice(0,10);

export default async (req, context) => {
  const url = new URL(req.url);
  const d = url.searchParams.get("d") || fmt(new Date());
  const text = (url.searchParams.get("t") || "Nel ricordo, ogni assenza trova una forma gentile di presenza.").trim();
  const author = (url.searchParams.get("a") || "").trim();

  const title = "Pensiero del giorno — OFI";
  const desc = author ? `${text} — ${author}` : text;
  const site = `${url.origin}`;
  const ogImg = `${site}/.netlify/functions/pensiero-og?t=${encodeURIComponent(text)}${author ? `&a=${encodeURIComponent(author)}`:""}`;

  const humanUrl = `${site}/pensiero-del-giorno.html?d=${encodeURIComponent(d)}`;
  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${desc}">
  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="OFI — Onoranze Funebri Italia">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="${ogImg}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${site}/p/${d}">
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${ogImg}">
  <meta http-equiv="refresh" content="0; url=${humanUrl}">
  <style>body{background:#0c1e2e;color:#fff;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0}a{color:#e8d39a}</style>
</head>
<body>
  <p>Reindirizzamento… Se non parte, <a href="${humanUrl}">clicca qui</a>.</p>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" }});
};
