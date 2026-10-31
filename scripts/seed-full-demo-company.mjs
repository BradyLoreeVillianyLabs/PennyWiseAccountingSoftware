import { randomUUID } from "node:crypto";

const apiUrl = (process.env.CLEARLEDGER_API_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const email = process.env.CLEARLEDGER_DEMO_EMAIL?.trim();
if (!email) {
  console.error("Set CLEARLEDGER_DEMO_EMAIL to an active, verified local ClearLedger user.");
  process.exit(1);
}

const idempotencyKey =
  process.env.CLEARLEDGER_DEMO_IDEMPOTENCY_KEY?.trim() ||
  `demo-company-canadian-service-v1-${email.toLowerCase()}`;
const response = await fetch(`${apiUrl}/v1/demo-company`, {
  method: "POST",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    "x-request-id": randomUUID()
  },
  body: JSON.stringify({ templateKey: "canadian-service" })
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(body.demoCompany ?? body, null, 2));
