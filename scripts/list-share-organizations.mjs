import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "api-url": { type: "string", default: "http://localhost:3001" }
  },
  strict: true
});
const email = values.email?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Provide an existing member email with --email member@example.test.");
  process.exit(1);
}

const apiUrl = new URL(values["api-url"] ?? "http://localhost:3001");
const response = await fetch(new URL("/v1/organizations", apiUrl), {
  headers: { "x-clearledger-user-email": email, "x-clearledger-user-name": email }
});
if (!response.ok) {
  console.error(`Could not list organizations: HTTP ${String(response.status)}.`);
  process.exit(1);
}
const { organizations } = await response.json();
if (!organizations.length) {
  console.error(
    "This email is not an active member of any organization. Invite and accept it locally first."
  );
  process.exit(1);
}
console.table(
  organizations.map((organization) => ({
    organizationId: organization.organizationId,
    name: organization.displayName,
    role: organization.role
  }))
);
