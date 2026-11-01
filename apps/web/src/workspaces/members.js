// Team members and invitations (`membership-admin`).

import { api, jsonRequest } from "../api.js";
import { showError, showNotice } from "../lib/notices.js";
import { fillRoleSelect, formatRole } from "../lib/roles.js";
import {
  loadSession,
  renderProjectWorkItemSelects,
  renderProjectWorkItems
} from "../lib/workspace-calls.js";
import { elements, identity, projectWorkItems, setTeamMembers } from "../state.js";

export function initMembers() {
  elements["accept-form"].addEventListener("submit", acceptInvitation);
  elements["invitation-form"].addEventListener("submit", createInvitation);
  elements["refresh-members"].addEventListener("click", loadMembers);
}

export async function loadMembers() {
  const response = await api("/v1/organizations/current/members");
  if (!response.ok) return showError(response);
  const members = (await response.json()).members;
  setTeamMembers(members);
  elements.members.replaceChildren(...members.map(memberRow));
  renderProjectWorkItemSelects();
  if (projectWorkItems.length) renderProjectWorkItems();
}

function memberRow(member) {
  const row = document.createElement("tr");
  const person = document.createElement("td");
  person.textContent = member.displayName
    ? `${member.displayName} (${member.email})`
    : member.email;
  const roleCell = document.createElement("td");
  const role = document.createElement("select");
  fillRoleSelect(role, true);
  role.value = member.role;
  role.disabled = member.status !== "ACTIVE";
  role.setAttribute("aria-label", `Role for ${member.email}`);
  role.addEventListener("change", () => changeRole(member.id, role.value));
  roleCell.append(role);
  const status = document.createElement("td");
  status.textContent = formatRole(member.status);
  const actions = document.createElement("td");
  const revoke = document.createElement("button");
  revoke.type = "button";
  revoke.className = "secondary";
  revoke.textContent = "Revoke";
  revoke.disabled = member.status !== "ACTIVE" || member.userId === identity.id;
  revoke.addEventListener("click", () => revokeMembership(member.id));
  actions.append(revoke);
  row.append(person, roleCell, status, actions);
  return row;
}

async function createInvitation(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const response = await api(
    "/v1/organizations/current/invitations",
    jsonRequest({
      email: data.get("email"),
      role: data.get("role")
    })
  );
  if (!response.ok) return showError(response);
  const result = await response.json();
  elements["invitation-result"].textContent = `Invitation token: ${result.token}`;
  event.target.reset();
}

async function acceptInvitation(event) {
  event.preventDefault();
  const token = new FormData(event.currentTarget).get("token");
  const response = await api("/v1/invitations/accept", jsonRequest({ token }));
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadSession();
  showNotice("Invitation accepted.");
}

async function changeRole(membershipId, role) {
  const response = await api(
    `/v1/organizations/current/members/${membershipId}/role`,
    jsonRequest({ role }, "PATCH")
  );
  if (!response.ok) return showError(response);
  await loadMembers();
  showNotice("Role updated.");
}

async function revokeMembership(membershipId) {
  const response = await api(
    `/v1/organizations/current/members/${membershipId}/revoke`,
    jsonRequest({})
  );
  if (!response.ok) return showError(response);
  await loadMembers();
  showNotice("Membership revoked.");
}
