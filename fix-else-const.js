// fix-else-const.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "netlify", "functions");

function walk(dir) {
  let res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res = res.concat(walk(p));
    else if (p.endsWith(".js") || p.endsWith(".mjs")) res.push(p);
  }
  return res;
}

const files = walk(root);
let changed = 0;

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let after = before;

  // Caso: "} else const admin = require('./_firebaseAdmin');"
  after = after.replace(
    /}\s*else\s*const\s+admin\s*=\s*require\(\s*["']\.\/_firebaseAdmin["']\s*\)\s*;\s*/g,
    `} else {\n  const admin = require("./_firebaseAdmin");\n}\n`
  );

  // Caso: "else const admin = require('./_firebaseAdmin');"
  after = after.replace(
    /else\s*const\s+admin\s*=\s*require\(\s*["']\.\/_firebaseAdmin["']\s*\)\s*;\s*/g,
    `else {\n  const admin = require("./_firebaseAdmin");\n}\n`
  );

  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    console.log("FIXED:", path.relative(process.cwd(), file));
    changed++;
  }
}

console.log(`\nDone. Fixed files: ${changed}`);