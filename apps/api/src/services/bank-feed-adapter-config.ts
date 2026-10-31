import type { BankFeedProviderAdapter } from "./bank-feed-provider.js";
import { flinksBankFeedAdapterFromEnvironment } from "./flinks-bank-feed-adapter.js";
import { pennyWiseTestBankFeedAdapterFromEnvironment } from "./pennywise-test-bank-feed-adapter.js";
import { plaidBankFeedAdapterFromEnvironment } from "./plaid-bank-feed-adapter.js";

/** Selects the configured provider while preserving each adapter's fail-closed validation. */
export function bankFeedAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv
): BankFeedProviderAdapter | undefined {
  const provider = environment.BANK_FEED_PROVIDER?.trim().toUpperCase();
  if (provider === "PENNYWISE_TEST_BANK")
    return pennyWiseTestBankFeedAdapterFromEnvironment(environment);
  if (provider === "FLINKS") return flinksBankFeedAdapterFromEnvironment(environment);
  if (!provider && environment.PENNYWISE_ENABLE_TEST_BANK?.trim().toLowerCase() === "true")
    throw new Error(
      "PENNYWISE_ENABLE_TEST_BANK=true requires BANK_FEED_PROVIDER=PENNYWISE_TEST_BANK."
    );
  const flinksConfigured = [
    environment.FLINKS_ENV,
    environment.FLINKS_INSTANCE,
    environment.FLINKS_CUSTOMER_ID,
    environment.FLINKS_SECRET_KEY,
    environment.FLINKS_API_KEY,
    environment.FLINKS_API_BASE_URL,
    environment.FLINKS_IFRAME_BASE_URL
  ].some((value) => Boolean(value?.trim()));
  if (flinksConfigured) return flinksBankFeedAdapterFromEnvironment(environment);
  return plaidBankFeedAdapterFromEnvironment(environment);
}
