import fs from "node:fs";
import vm from "node:vm";

const scriptPath = process.argv[2];

if (!scriptPath || !fs.existsSync(scriptPath)) {
  throw new Error("public-beta.js path is required.");
}

let clickListener;
let capabilityInputListener;
let copiedValue = "";
const announcements = [];
let site;

const button = {
  textContent: "Copy checksum",
  addEventListener(event, listener) {
    if (event === "click") {
      clickListener = listener;
    }
  }
};

const checksum = {
  textContent: "a1".repeat(32)
};

const status = {
  _textContent: "",
  set textContent(value) {
    this._textContent = value;
    if (value) {
      announcements.push(value);
    }
  },
  get textContent() {
    return this._textContent;
  }
};

const capabilityStatus = {
  textContent: ""
};

const capabilityItems = [
  {
    tagName: "A",
    textContent: "Inventory, reviewed SKU matching, and thumbnails",
    hidden: false,
    getAttribute(name) {
      return name === "href" ? "#clearledger-download" : null;
    }
  },
  {
    tagName: "A",
    textContent: "Tax Centre and CAD/USD controls Etsy marketplace evidence",
    hidden: false,
    getAttribute(name) {
      return name === "href" ? "#clearledger-beta-safety" : null;
    }
  },
  {
    tagName: "A",
    textContent: "Live services bank feeds payroll direct deposit and filing",
    hidden: false,
    getAttribute(name) {
      return name === "href" ? "#clearledger-beta-safety" : null;
    }
  }
];

const capabilityList = {
  querySelectorAll(selector) {
    return selector === "[data-cl-capability-item]" ? capabilityItems : [];
  }
};

const capabilityInput = {
  value: "",
  closest(selector) {
    return selector === "[data-cl-beta-site]" ? site : null;
  },
  addEventListener(event, listener) {
    if (event === "input") {
      capabilityInputListener = listener;
    }
  }
};

site = {
  querySelector(selector) {
    return {
      "[data-cl-copy-checksum]": button,
      "[data-cl-checksum]": checksum,
      "[data-cl-copy-status]": status,
      "[data-cl-capability-list]": capabilityList,
      "[data-cl-capability-search-status]": capabilityStatus
    }[selector];
  }
};

const sandbox = {
  document: {
    querySelectorAll(selector) {
      if (selector === "[data-cl-beta-site]") {
        return [site];
      }
      if (selector === "[data-cl-capability-search]") {
        return [capabilityInput];
      }
      return [];
    }
  },
  navigator: {
    clipboard: {
      async writeText(value) {
        copiedValue = value;
      }
    }
  },
  window: {
    isSecureContext: true,
    setTimeout(callback) {
      callback();
      return 1;
    }
  },
  console
};

vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), sandbox, {
  filename: scriptPath
});

if (typeof capabilityInputListener !== "function") {
  throw new Error("Capability search input handler was not registered.");
}

capabilityInput.value = "direct deposit";
capabilityInputListener();

const visibleCapabilityItems = capabilityItems.filter((item) => !item.hidden);
if (visibleCapabilityItems.length !== 1) {
  throw new Error("Capability search did not narrow to the expected linked result.");
}

const directDepositResult = visibleCapabilityItems[0];
if (
  directDepositResult.tagName !== "A" ||
  directDepositResult.getAttribute("href") !== "#clearledger-beta-safety"
) {
  throw new Error("Capability search result is not a usable safety-boundary link.");
}

if (capabilityStatus.textContent !== "1 capability result") {
  throw new Error("Capability search did not announce its result count.");
}

if (typeof clickListener !== "function") {
  throw new Error("Checksum copy click handler was not registered.");
}

clickListener();
await new Promise((resolve) => setImmediate(resolve));

if (copiedValue !== checksum.textContent) {
  throw new Error("Checksum was not copied exactly.");
}

if (!announcements.some((message) => message.includes("Checksum copied"))) {
  throw new Error("Successful copy was not announced through the status region.");
}

if (button.textContent !== "Copy checksum") {
  throw new Error("Copy button label did not return to its stable text.");
}

process.stdout.write(
  "PASS: JavaScript smoke exercised capability search/linking plus checksum copy and accessible status announcement.\n"
);
