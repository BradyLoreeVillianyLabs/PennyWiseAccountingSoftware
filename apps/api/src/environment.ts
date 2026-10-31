/**
 * Environment-variable helpers.
 *
 * `.env.example` documents optional settings as blank assignments, and a shell
 * that sources it exports them as empty strings. `process.env.X ?? "default"`
 * only falls back on `null`/`undefined`, so an empty string passed straight
 * through to callers that then failed on it — a 24-character secret check, or
 * `new URL("")`. Treat a blank or whitespace-only value as absent.
 */

/** Returns the trimmed value, or `undefined` when it is blank or unset. */
export function configuredEnvironmentValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Returns the trimmed value, or `fallback` when it is blank or unset. */
export function environmentValueOrDefault(value: string | undefined, fallback: string): string {
  return configuredEnvironmentValue(value) ?? fallback;
}
