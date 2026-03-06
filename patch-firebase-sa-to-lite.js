// patch-firebase-sa-to-lite.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "netlify", "functions");

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(walk(p));
    else if (p.endsWith(".js") || p.endsWith(".mjs")) results.push(p);
  }
  return results;
}

// helper JS da inserire (solo se il file usa FIREBASE_SERVICE_ACCOUNT o JSON.parse(sa))
const LITE_HELPER = `
const __OFI_FIREBASE_SVC__ = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\\\n/g, "\\n")
};
if (!__OFI_FIREBASE_SVC__.projectId || !__OFI_FIREBASE_SVC__.clientEmail || !__OFI_FIREBASE_SVC__.privateKey) {
  throw new Error("Missing Firebase env vars. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.");
}
`.trim();

const files = walk(root);
let changed = 0;

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;

  const usesSA =
    /FIREBASE_SERVICE_ACCOUNT\b/.test(after) ||
    /JSON\.parse\s*\(\s*sa\s*\)/.test(after);

  if (!usesSA) continue;

  // 1) Inserisce helper vicino all'inizio del file (dopo eventuali import/require iniziali)
  // Evitiamo di inserirlo due volte
  if (!after.includes("__OFI_FIREBASE_SVC__")) {
    const lines = after.split(/\r?\n/);

    // trova il punto dopo gli import/require iniziali
    let insertAt = 0;
    while (
      insertAt < lines.length &&
      (
        lines[insertAt].startsWith("import ") ||
        lines[insertAt].startsWith('import{') ||
        lines[insertAt].startsWith('import {') ||
        lines[insertAt].startsWith("const ") && lines[insertAt].includes("require(") ||
        lines[insertAt].trim() === "" ||
        lines[insertAt].startsWith("//")
      )
    ) {
      insertAt++;
    }

    lines.splice(insertAt, 0, "", LITE_HELPER, "");
    after = lines.join("\n");
  }

  // 2) Sostituisce JSON.parse(sa) -> __OFI_FIREBASE_SVC__
  after = after.replace(/JSON\.parse\s*\(\s*sa\s*\)/g, "__OFI_FIREBASE_SVC__");

  // 3) Sostituisce JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) -> __OFI_FIREBASE_SVC__
  after = after.replace(
    /JSON\.parse\s*\(\s*process\.env\.FIREBASE_SERVICE_ACCOUNT\s*\)/g,
    "__OFI_FIREBASE_SVC__"
  );

  // 4) Se il file fa: const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  //    lo rendiamo innocuo (non più necessario)
  after = after.replace(
    /const\s+sa\s*=\s*process\.env\.FIREBASE_SERVICE_ACCOUNT\s*;\s*/g,
    ""
  );

  // 5) Se il file ha controlli tipo: if (!sa) throw new Error("...FIREBASE_SERVICE_ACCOUNT...")
  after = after.replace(
    /if\s*\(\s*!\s*sa\s*\)\s*throw\s+new\s+Error\([^)]*\);\s*/g,
    ""
  );

  // 6) Alcuni file usano raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  //    Lo lasciamo, ma togliamo la dipendenza se poi veniva parsato: JSON.parse(raw) in cert()
  //    (Non facciamo patch aggressiva qui; se serve, la facciamo dopo con output findstr.)

  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    console.log("PATCHED:", path.relative(process.cwd(), file));
    changed++;
  }
}

console.log(`\nDone. Patched files: ${changed}`);