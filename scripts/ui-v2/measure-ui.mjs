// Static UI clutter metrics for the PennyWise UI v2 declutter program.
// Usage:
//   node scripts/ui-v2/measure-ui.mjs                 print current metrics as JSON
//   node scripts/ui-v2/measure-ui.mjs --write <label> record current metrics under waves.<label> in metrics.json
//   node scripts/ui-v2/measure-ui.mjs --check         fail if any metric regressed past the last recorded wave
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const web = join(root, "apps", "web");
const metricsPath = join(root, "docs", "pennywise", "declutter", "metrics.json");

async function listFiles(directory, extension) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !/(^|[\\/])(node_modules|dist|e2e|scripts)[\\/]/.test(relative(web, path)));
}

async function readAll(paths) {
  const contents = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  return contents.join("\n");
}

function count(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function lineCount(text) {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function arrayLiteral(source, name) {
  const start = source.search(new RegExp(`const ${name}\\s*=\\s*(new Set\\()?\\[`));
  if (start < 0) return "";
  const open = source.indexOf("[", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "[") depth += 1;
    else if (source[index] === "]" && --depth === 0) return source.slice(open, index + 1);
  }
  return "";
}

export async function measure() {
  const htmlFiles = [join(web, "index.html"), ...(await listFiles(join(web, "src"), ".html"))];
  const jsFiles = [join(web, "app.js"), ...(await listFiles(join(web, "src"), ".js"))];
  const cssFiles = [join(web, "styles.css"), ...(await listFiles(join(web, "styles"), ".css"))];
  const html = await readAll(htmlFiles);
  const js = await readAll(jsFiles);
  const css = await readAll(cssFiles);
  const jsLineCounts = await Promise.all(
    jsFiles.map(async (path) => lineCount(await readFile(path, "utf8")))
  );

  const firstNavStart = html.indexOf("<nav");
  const firstNav = html.slice(firstNavStart, html.indexOf("</nav>", firstNavStart));
  // The compact "More" menu repeats desktop destinations for narrow screens; count it separately.
  const compactMenuStart = firstNav.indexOf('id="more-navigation"');
  const desktopTopNav = compactMenuStart < 0 ? firstNav : firstNav.slice(0, compactMenuStart);
  const railDefinitions = arrayLiteral(js, "leftNavigationDefinitions");
  const ownerKeys = arrayLiteral(js, "ownerNavigationKeys").replace(/\/\/.*$/gm, "");

  return {
    navigation: {
      topNavItems: count(desktopTopNav, /data-workspace-target=/g),
      topNavItemsIncludingCompactMenu: count(firstNav, /data-workspace-target=/g),
      railItemsAll: count(railDefinitions, /\bkey:\s*"/g),
      railItemsOwnerMode: count(ownerKeys, /"[^"]+"/g)
    },
    markup: {
      buttons: count(html, /<button\b/g),
      inputs: count(html, /<(input|select|textarea)\b/g),
      forms: count(html, /<form\b/g),
      tables: count(html, /<table\b/g),
      dialogs: count(html, /<dialog\b/g),
      sections: count(html, /<section\b/g)
    },
    visuals: {
      chartElements: count(html + js, /<svg[^>]*class="[^"]*chart|<canvas\b|data-chart=/g)
    },
    size: {
      jsFiles: jsFiles.length,
      jsLines: lineCount(js),
      htmlLines: lineCount(html),
      cssLines: lineCount(css),
      largestJsFileLines: Math.max(...jsLineCounts)
    }
  };
}

// A larger value is a regression for these metrics. Chart counts and file counts are expected to grow.
const lowerIsBetter = [
  ["navigation", "topNavItems"],
  ["navigation", "railItemsOwnerMode"],
  ["markup", "buttons"],
  ["markup", "dialogs"],
  ["size", "cssLines"],
  ["size", "largestJsFileLines"]
];

async function readMetrics() {
  return JSON.parse((await readFile(metricsPath, "utf8")).replace(/^\uFEFF/, ""));
}

const [mode, label] = process.argv.slice(2);
const current = await measure();

if (mode === "--write") {
  if (!label) throw new Error("--write requires a wave label, for example baseline or wave-1.");
  const metrics = await readMetrics();
  metrics.waves[label] = { measuredAt: new Date().toISOString(), ...current };
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Recorded metrics under waves.${label}.`);
} else if (mode === "--check") {
  const metrics = await readMetrics();
  const labels = Object.keys(metrics.waves);
  const lastLabel = labels[labels.length - 1];
  const previous = metrics.waves[lastLabel];
  const regressions = lowerIsBetter
    .filter(([group, key]) => current[group][key] > previous[group][key])
    .map(([group, key]) => `${group}.${key}: ${previous[group][key]} -> ${current[group][key]}`);
  if (regressions.length > 0) {
    console.error(`UI clutter regressed since ${lastLabel}:\n  ${regressions.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`No UI clutter regressions since ${lastLabel}.`);
} else {
  console.log(JSON.stringify(current, null, 2));
}
