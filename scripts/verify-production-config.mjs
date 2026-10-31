const production = process.env.NODE_ENV === "production";

if (!production) {
  console.log("Production configuration check skipped because NODE_ENV is not production.");
  process.exit(0);
}

const required = [
  "DATABASE_URL",
  "REDIS_URL",
  "APP_BASE_URL",
  "API_BASE_URL",
  "PAYMENT_PUBLIC_BASE_URL",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_REDIRECT_URI",
  "OIDC_POST_LOGOUT_REDIRECT_URI",
  "OIDC_RECOVERY_URL",
  "STRIPE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET",
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "CONNECTOR_WEBHOOK_BASE_URL",
  "PRODUCTION_ADAPTERS_READY",
  "PRODUCTION_DATA_REGION",
  "BACKUP_RESTORE_DRILL_AT",
  "SECURITY_REVIEW_AT",
  "LEGAL_PRIVACY_REVIEW_AT"
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing production configuration: ${missing.join(", ")}`);
  process.exit(1);
}

const bankFeedProvider = process.env.BANK_FEED_PROVIDER?.trim() ?? "";
const testBankOptIn = process.env.PENNYWISE_ENABLE_TEST_BANK?.trim() === "true";
const betaSandboxApproval =
  process.env.PENNYWISE_BETA_BANK_FEEDS_SANDBOX_APPROVED?.trim() === "true";

if (bankFeedProvider === "PENNYWISE_TEST_BANK" || testBankOptIn || betaSandboxApproval) {
  console.error(
    "Production configuration cannot enable the PennyWise test bank or sandbox approval flags."
  );
  process.exit(1);
}

if (bankFeedProvider && bankFeedProvider !== "PLAID") {
  console.error("BANK_FEED_PROVIDER must be unset or PLAID in production.");
  process.exit(1);
}

if (bankFeedProvider === "PLAID") {
  const liveProviderMissing = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ENV"].filter(
    (name) => !process.env[name]?.trim()
  );
  if (liveProviderMissing.length) {
    console.error(`Missing live bank-feed configuration: ${liveProviderMissing.join(", ")}`);
    process.exit(1);
  }
  if (process.env.PLAID_ENV !== "production") {
    console.error("PLAID_ENV must be production when BANK_FEED_PROVIDER=PLAID in production.");
    process.exit(1);
  }
  if (process.env.BANK_FEED_PRODUCTION_APPROVED !== "true") {
    console.error(
      "BANK_FEED_PRODUCTION_APPROVED must be true to enable live bank feeds in production."
    );
    process.exit(1);
  }
  if (process.env.PAYMENT_ACCOUNT_ENCRYPTION_SECRET.length < 32) {
    console.error(
      "PAYMENT_ACCOUNT_ENCRYPTION_SECRET must be at least 32 characters for live bank feeds."
    );
    process.exit(1);
  }
}

const urls = [
  "APP_BASE_URL",
  "API_BASE_URL",
  "PAYMENT_PUBLIC_BASE_URL",
  "OIDC_ISSUER",
  "OIDC_REDIRECT_URI",
  "OIDC_POST_LOGOUT_REDIRECT_URI",
  "OIDC_RECOVERY_URL"
];
const invalidUrls = [];
for (const name of urls) {
  try {
    const url = new URL(process.env[name]);
    if (url.protocol !== "https:" || url.username || url.password) invalidUrls.push(name);
  } catch {
    invalidUrls.push(name);
  }
}
if (invalidUrls.length) {
  console.error(
    `Production URLs must be HTTPS origins without credentials: ${invalidUrls.join(", ")}`
  );
  process.exit(1);
}

if (process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET.length < 32) {
  console.error("CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET must be at least 32 characters.");
  process.exit(1);
}

try {
  const connectorWebhookOrigin = new URL(process.env.CONNECTOR_WEBHOOK_BASE_URL);
  if (
    connectorWebhookOrigin.protocol !== "https:" ||
    connectorWebhookOrigin.username ||
    connectorWebhookOrigin.password ||
    connectorWebhookOrigin.pathname !== "/" ||
    connectorWebhookOrigin.search ||
    connectorWebhookOrigin.hash
  )
    throw new Error("invalid origin");
} catch {
  console.error(
    "CONNECTOR_WEBHOOK_BASE_URL must be an HTTPS origin without credentials, path, query, or hash."
  );
  process.exit(1);
}

if (process.env.STRIPE_MODE !== "live") {
  console.error("STRIPE_MODE must be live for production configuration.");
  process.exit(1);
}
if (process.env.PRODUCTION_ADAPTERS_READY !== "true") {
  console.error(
    "PRODUCTION_ADAPTERS_READY must be true only after storage, scanning, email, payment, and rate-limit adapters are validated."
  );
  process.exit(1);
}
if (process.env.PRODUCTION_DATA_REGION !== "ca-central-1") {
  console.error("PRODUCTION_DATA_REGION must be ca-central-1 for the Canadian beta.");
  process.exit(1);
}

for (const name of ["BACKUP_RESTORE_DRILL_AT", "SECURITY_REVIEW_AT", "LEGAL_PRIVACY_REVIEW_AT"]) {
  if (Number.isNaN(Date.parse(process.env[name]))) {
    console.error(`${name} must be an ISO-8601 timestamp.`);
    process.exit(1);
  }
}

console.log("Production configuration contract passed without printing secret values.");
