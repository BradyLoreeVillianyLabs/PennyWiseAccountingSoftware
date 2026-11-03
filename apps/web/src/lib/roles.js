// Membership role labels and checks.

import { identity, organizationMemberships, roles } from "../state.js";

export function fillRoleSelect(select, includeOwner = false) {
  const values = includeOwner ? ["OWNER", ...roles] : roles;
  select.replaceChildren(
    ...values.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatRole(value);
      return option;
    })
  );
}

export function formatRole(value) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function activeMembershipRole() {
  return organizationMemberships.find(
    (membership) => membership.organizationId === identity?.activeOrganizationId
  )?.role;
}

export function activeRoleIs(...allowedRoles) {
  return allowedRoles.includes(activeMembershipRole());
}
