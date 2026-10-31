import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
const styles = await esbuild.transform(await readFile(resolve(root, "styles.css"), "utf8"), {
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

  const html = await readFile(resolve(root, file), "utf8");
  await writeFile(target, minifyHtml(html), "utf8");
}

function minifyHtml(source) {
  const preservedBlocks = [];
  const protectedSource = source.replace(/<(pre|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) => {
    const token = `__CLEARLEDGER_PRESERVED_BLOCK_${preservedBlocks.length}__`;
    preservedBlocks.push([token, block]);
    return token;
  });
  let minified = protectedSource.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><");
  for (const [token, block] of preservedBlocks) minified = minified.replace(token, block);
  return minified;
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
