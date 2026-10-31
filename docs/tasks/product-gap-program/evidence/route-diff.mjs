// Read-only: compares API route registrations against /v1 paths referenced by the web client.
// v2: template literals are scanned as whole backtick strings so `${data.get("id")}` does not
// truncate the match (v1 produced false "no UI" hits for bank categorize/match).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../../../", import.meta.url));
const apiFiles = [`${src}/apps/api/src/app.ts`, `${src}/apps/api/src/http/shipping-routes.ts`];
const web =
  readFileSync(`${src}/apps/web/app.js`, "utf8") +
  readFileSync(`${src}/apps/web/index.html`, "utf8");

const routes = [];
for (const f of apiFiles) {
  const text = readFileSync(f, "utf8");
  const re = /app\.(get|post|put|patch|delete)\(\s*["'`](\/v1[^"'`]*)["'`]/g;
  let m;
  while ((m = re.exec(text))) routes.push({ method: m[1].toUpperCase(), path: m[2] });
}

const refs = new Set();
// Backtick templates: allow ${...} containing quotes (one nesting level is enough here).
const tre = /`(\/v1\/(?:[^`$\\]|\\.|\$\{(?:[^{}]|\{[^{}]*\})*\})*)`/g;
let t;
while ((t = tre.exec(web))) refs.add(t[1].replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ":p"));
// Plain quoted strings.
const qre = /["'](\/v1\/[^"'`$]*)["']/g;
let q;
while ((q = qre.exec(web))) refs.add(q[1]);
const webPatterns = [...refs].map((p) => p.replace(/\?.*$/, ""));

const segs = (p) => p.split("/").filter(Boolean);
function matches(route, ref) {
  const a = segs(route),
    b = segs(ref);
  if (b.length > a.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i].startsWith(":") || b[i].includes(":p")) continue;
    if (a[i] !== b[i]) return false;
  }
  return b.length === a.length || ref.endsWith("/") || ref.endsWith(":p");
}

const unreferenced = routes.filter((r) => !webPatterns.some((p) => matches(r.path, p)));
const out = [
  `routes=${routes.length} unreferenced=${unreferenced.length} webRefs=${refs.size}`,
  ""
];
for (const r of unreferenced) out.push(`${r.method.padEnd(6)} ${r.path}`);
console.log(out.join("\n"));
