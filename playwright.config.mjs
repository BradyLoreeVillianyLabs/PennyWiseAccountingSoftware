const systemBrowsers = process.env.PLAYWRIGHT_SYSTEM_BROWSERS === "true";
const desktop = {
  viewport: { width: 1440, height: 900 },
  screen: { width: 1440, height: 900 }
};
const pixel5 = {
  viewport: { width: 393, height: 851 },
  screen: { width: 393, height: 851 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true
};
const iphone13 = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
};

export default {
  testDir: "apps/web/e2e",
  tsconfig: "./apps/web/e2e/tsconfig.json",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: systemBrowsers
    ? [
        {
          name: "chrome",
          use: { ...desktop, browserName: "chromium", channel: "chrome" }
        },
        {
          name: "edge",
          use: { ...desktop, browserName: "chromium", channel: "msedge" }
        },
        {
          name: "firefox",
          use: { ...desktop, browserName: "firefox" }
        },
        {
          name: "mobile-chrome",
          use: { ...pixel5, browserName: "chromium", channel: "chrome" }
        },
        {
          name: "mobile-webkit",
          use: { ...iphone13, browserName: "webkit" }
        }
      ]
    : [
        {
          name: "chromium",
          use: { ...desktop, browserName: "chromium" }
        },
        {
          name: "firefox",
          use: { ...desktop, browserName: "firefox" }
        },
        {
          name: "mobile-chromium",
          use: { ...pixel5, browserName: "chromium" }
        },
        {
          name: "mobile-webkit",
          use: { ...iphone13, browserName: "webkit" }
        }
      ]
};
