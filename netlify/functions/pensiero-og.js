// netlify/functions/pensiero-og.js
// Genera un'immagine 1200x630 con il "Pensiero del giorno" (PNG)
import { Resvg } from "@resvg/resvg-js";

function wrapText(txt, max = 36) {
  const w = [];
  let line = [];
  for (const w0 of txt.split(/\s+/)) {
    const next = [...line, w0].join(' ');
    if (next.length > max) { w.push(line.join(' ')); line = [w0]; }
    else line = [ ...line, w0 ];
  }
  if (line.length) w.push(line.join(' '));
  return w.slice(0, 8); // max 8 righe
}

export default async (req, context) => {
  const url = new URL(req.url);
  const text = (url.searchParams.get("t") || "Oggi abito il silenzio con gratitudine. Ogni ricordo è una luce gentile che non si spegne.").trim();
  const author = (url.searchParams.get("a") || "").trim();
  const lines = wrapText(text, 40);

  const subtitle = author ? `— ${author}` : "";
  const title = "Pensiero del giorno · OFI";

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0c1e2e"/>
      <stop offset="1" stop-color="#102845"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFD46A"/>
      <stop offset="1" stop-color="#B78927"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 .55 0" />
    </filter>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- cornice oro morbida -->
  <rect x="30" y="30" width="1140" height="570" rx="28" ry="28"
        fill="none" stroke="url(#gold)" stroke-width="3"/>
  <ellipse cx="900" cy="80" rx="220" ry="60" fill="#caa85a" opacity=".10" filter="url(#soft)"/>
  <ellipse cx="250" cy="560" rx="240" ry="70" fill="#caa85a" opacity=".08" filter="url(#soft)"/>

  <!-- header -->
  <g font-family="Noto Serif, Georgia, serif" fill="#e8d39a">
    <text x="60" y="90" font-size="34" font-weight="600">Pensiero del giorno</text>
  </g>

  <!-- quote -->
  <g font-family="Noto Serif, Georgia, serif" fill="#ffffff" opacity="0.97">
    <text x="100" y="180" font-size="50">“</text>
  </g>

  <g font-family="Noto Serif, Georgia, serif" fill="#ffffff" opacity="0.98">
    ${lines.map((line, i)=>`<text x="150" y="${210 + i*54}" font-size="38">${line.replace(/&/g,"&amp;")}</text>`).join('')}
    ${subtitle ? `<text x="150" y="${210 + lines.length*54 + 42}" font-size="30" fill="#e8d39a">${subtitle.replace(/&/g,"&amp;")}</text>` : ``}
  </g>

  <!-- footer brand -->
  <g font-family="Source Sans 3, Arial, sans-serif" fill="#e8d39a">
    <text x="60" y="590" font-size="24" font-weight="800">OFI — Onoranze Funebri Italia</text>
  </g>
</svg>`.trim();

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 }
  }).render().asPng();

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400" // 1 giorno
    }
  });
};
