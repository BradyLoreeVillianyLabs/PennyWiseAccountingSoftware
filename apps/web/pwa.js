/* global console, navigator */

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch((error) => {
      console.warn("PennyWise Accounting offline shell registration failed.", error);
    });
  });
}
