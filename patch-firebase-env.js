// patch-firebase-env.js
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

const files = walk(root);

let changed = 0;

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;

  // 1) sostituisce JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) con oggetto leggero
  after = after.replace(
    /JSON\.parse\s*\(\s*process\.env\.FIREBASE_SERVICE_ACCOUNT\s*\)/g,
    `{ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\\\n/g, "\\n") }`
  );

  // 2) sostituisce JSON.parse(sa) se "sa" era FIREBASE_SERVICE_ACCOUNT
  // (caso: const sa = process.env.FIREBASE_SERVICE_ACCOUNT;)
  // Non tocchiamo altri JSON.parse generici.

  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    console.log("PATCHED:", path.relative(process.cwd(), file));
    changed++;
  }
}

console.log(`\nDone. Patched files: ${changed}`);