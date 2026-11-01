// Browser utilities: stored preferences, file reading, and downloads.

export function readBrowserPreference(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserPreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Private or locked-down browser contexts may decline local persistence.
    return false;
  }
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function preferredScrollBehavior() {
  return document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

export function downloadTextFile(filename, contents) {
  const blob = new window.Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url));
}

export async function writeClipboardText(contents) {
  try {
    if (!window.navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await window.navigator.clipboard.writeText(contents);
    return;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = contents;
    helper.readOnly = true;
    helper.setAttribute("aria-hidden", "true");
    helper.style.cssText = "position:fixed;inset:0 auto auto -10000px;opacity:0";
    document.body.append(helper);
    helper.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    helper.remove();
    if (!copied) throw new Error("Clipboard unavailable");
  }
}

export async function readFileAsBase64(file) {
  let buffer;
  try {
    buffer = await withTimeout(readFileAsArrayBuffer(file), 12_000);
  } catch {
    buffer = await withTimeout(
      typeof file.arrayBuffer === "function"
        ? file.arrayBuffer()
        : new Response(file).arrayBuffer(),
      12_000
    );
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return globalThis.btoa(binary);
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof globalThis.ArrayBuffer) resolve(reader.result);
      else reject(new Error("The selected file could not be encoded."));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("File read failed.")));
    reader.addEventListener("abort", () => reject(new Error("File read cancelled.")));
    reader.readAsArrayBuffer(file);
  });
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(
      () => reject(new Error("File reading timed out.")),
      milliseconds
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
