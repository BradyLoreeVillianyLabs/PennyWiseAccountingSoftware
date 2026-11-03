import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { assembleIndexHtml, readWebStyles } from "./web-sources.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const esbuild = await loadEsbuild();

await mkdir(resolve(output, "icons"), { recursive: true });
await Promise.all(
  [
    "index.html",
    "pwa.js",
    "money.js",
    "manifest.webmanifest",
    "service-worker.js",
    "offline.html",
    "icons/clearledger.svg",
    "icons/clearledger-maskable.svg"
  ].map(copyStaticAsset)
);

await esbuild.build({
  entryPoints: [resolve(root, "app.js")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  charset: "utf8",
  outfile: resolve(output, "app.js")
});
const styles = await esbuild.transform(await readWebStyles(root), {
  loader: "css",
  minify: true,
  target: "es2022",
  legalComments: "none",
  charset: "utf8"
});
await writeFile(resolve(output, "styles.css"), styles.code, "utf8");

console.log("Built minified PennyWise Accounting web assets.");

async function copyStaticAsset(file) {
  const target = resolve(output, file);
  await mkdir(dirname(target), { recursive: true });
  if (file !== "index.html") {
    await copyFile(resolve(root, file), target);
    return;
  }

  await writeFile(target, minifyHtml(await assembleIndexHtml(root)), "utf8");
}

function minifyHtml(source) {
  const preservedBlocks = [];
  const protectedSource = source.replace(/<(pre|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) => {
    const token = `__CLEARLEDGER_PRESERVED_BLOCK_${preservedBlocks.length}__`;
    preservedBlocks.push([token, block]);
    return token;
  });
  let minified = protectedSource
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .replace(/<[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^"'>])*>/g, collapseTagWhitespace);
  for (const [token, block] of preservedBlocks) minified = minified.replace(token, block);
  return minified;
}

// Whitespace between attributes is not part of the DOM, unlike whitespace inside a quoted value.
function collapseTagWhitespace(tag) {
  return tag
    .split(/("[^"]*"|'[^']*')/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/\s+/g, " ")))
    .join("")
    .replace(/\s+(\/?>)$/, "$1");
}

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    // Some isolated pnpm development installs do not link root dev binaries.
    // tsx is already a required build tool and carries the same locked esbuild
    // version, so resolve from its physical package path rather than a brittle
    // workspace-specific .pnpm path.
    const requireFromTsx = createRequire(await import.meta.resolve("tsx"));
    return requireFromTsx("esbuild");
  }
}
