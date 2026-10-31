(function () {
  "use strict";

  function announce(status, message) {
    if (!status) {
      return;
    }

    status.textContent = "";
    window.setTimeout(function () {
      status.textContent = message;
    }, 25);
  }

  async function copyChecksum(button, checksum, status) {
    var value = checksum ? checksum.textContent.trim() : "";

    if (!/^[a-f0-9]{64}$/i.test(value)) {
      announce(status, "A valid checksum is not available yet.");
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        var helper = document.createElement("textarea");
        helper.value = value;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        var copied = document.execCommand("copy");
        helper.remove();

        if (!copied) {
          throw new Error("Copy command was not accepted.");
        }
      }

      announce(status, "Checksum copied. Compare all 64 characters before installation.");
      button.textContent = "Copied";
      window.setTimeout(function () {
        button.textContent = "Copy checksum";
      }, 1800);
    } catch {
      announce(status, "Copy was unavailable. Select and copy the checksum manually.");
    }
  }

  document.querySelectorAll("[data-cl-capability-search]").forEach(function (input) {
    var list = input.closest("[data-cl-beta-site]")?.querySelector("[data-cl-capability-list]");
    var status = input
      .closest("[data-cl-beta-site]")
      ?.querySelector("[data-cl-capability-search-status]");
    if (!list) {
      return;
    }
    var items = Array.prototype.slice.call(list.querySelectorAll("[data-cl-capability-item]"));
    function filterCapabilities() {
      var query = input.value.trim().toLocaleLowerCase();
      var terms = query ? query.split(/\\s+/).filter(Boolean) : [];
      var visible = 0;
      items.forEach(function (item) {
        var text = item.textContent.toLocaleLowerCase();
        var matches = terms.every(function (term) {
          return text.indexOf(term) !== -1;
        });
        item.hidden = !matches;
        if (matches) {
          visible += 1;
        }
      });
      if (status) {
        status.textContent = query
          ? visible + " capability result" + (visible === 1 ? "" : "s")
          : items.length + " capabilities";
      }
    }
    input.addEventListener("input", filterCapabilities);
    filterCapabilities();
  });
  document.querySelectorAll("[data-cl-beta-site]").forEach(function (site) {
    var button = site.querySelector("[data-cl-copy-checksum]");
    var checksum = site.querySelector("[data-cl-checksum]");
    var status = site.querySelector("[data-cl-copy-status]");

    if (!button) {
      return;
    }

    button.addEventListener("click", function () {
      copyChecksum(button, checksum, status);
    });
  });
})();
