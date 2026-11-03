// Reads the web client's split sources as one unit, for the build and the source verifiers.
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const partialMarker = /^[ \t]*<!-- @partial ([a-z0-9-]+) -->\r?\n/gm;

async function listFiles(directory, extension) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

/** Returns index.html with every `<!-- @partial name -->` line replaced by src/partials/name.html. */
export async function assembleIndexHtml(webRoot) {
  const shell = await readFile(resolve(webRoot, "index.html"), "utf8");
  const partialRoot = resolve(webRoot, "src", "partials");
  const names = [...shell.matchAll(partialMarker)].map((match) => match[1]);
  if (new Set(names).size !== names.length) throw new Error("A partial is included twice.");
  const available = (await listFiles(partialRoot, ".html")).map((file) =>
    relative(partialRoot, file).replace(/\.html$/, "")
  );
  const unused = available.filter((name) => !names.includes(name));
  if (unused.length > 0) throw new Error(`Partials are not included: ${unused.join(", ")}.`);
  const partials = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        await readFile(resolve(partialRoot, `${name}.html`), "utf8")
      ])
    )
  );
  return shell.replace(partialMarker, (_marker, name) => partials.get(name));
}

/** Returns app.js followed by every module under src/, for source-level contract checks. */
export async function readWebScripts(webRoot) {
  const files = [resolve(webRoot, "app.js"), ...(await listFiles(resolve(webRoot, "src"), ".js"))];
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return contents.join("\n");
}

/** Returns styles.css followed by every module stylesheet under styles/. */
export async function readWebStyles(webRoot) {
  const files = [
    resolve(webRoot, "styles.css"),
    ...(await listFiles(resolve(webRoot, "styles"), ".css"))
  ];
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return contents.join("\n");
}

/**
 * Enforces the U0 layering so parallel streams stay independent: workspaces never import each
 * other, only the entry point and session.js import workspaces, and the module graph has no cycles.
 */
export async function verifyModuleBoundaries(webRoot) {
  const source = resolve(webRoot, "src");
  const files = [resolve(webRoot, "app.js"), ...(await listFiles(source, ".js"))];
  const label = (file) => relative(webRoot, file).replaceAll("\\", "/");
  const graph = new Map();
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const specifiers = [...text.matchAll(/^import\s+(?:[^;]*?\sfrom\s+)?"(\.[^"]+)";/gm)];
    graph.set(
      label(file),
      specifiers.map((match) => label(resolve(dirname(file), match[1])))
    );
  }
  for (const [from, targets] of graph) {
    for (const target of targets) {
      if (!target.startsWith("src/workspaces/")) continue;
      if (from !== "app.js" && from !== "src/session.js")
        throw new Error(`${from} must not import ${target}. Use src/lib/workspace-calls.js.`);
    }
    if (targets.includes("src/session.js") && from !== "app.js")
      throw new Error(`${from} must not import src/session.js. Use src/lib/workspace-calls.js.`);
  }
  const finished = new Set();
  const visit = (file, path) => {
    if (path.includes(file)) throw new Error(`Import cycle: ${[...path, file].join(" -> ")}.`);
    if (finished.has(file)) return;
    for (const target of graph.get(file) ?? []) visit(target, [...path, file]);
    finished.add(file);
  };
  visit("app.js", []);
}
