// Owner workspace (`owner-workspace`).

import { formatMinor } from "../../money.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { localCalendarDate } from "../lib/format.js";
import { formatRole } from "../lib/roles.js";
import {
  calendarTypeLabel,
  loadCalendar,
  loadContracts,
  loadProjects,
  loadSales,
  openContract,
  openPlanningTab,
  registerWorkspaceCalls
} from "../lib/workspace-calls.js";
import { focusCreateTarget, navigateTo } from "../shell.js";
import {
  calendarEvents,
  contracts,
  customers,
  elements,
  estimates,
  identity,
  invoices,
  projects
} from "../state.js";

registerWorkspaceCalls({
  formatOwnerDate,
  loadOwnerWorkspace,
  ownerWorkspaceEmpty,
  renderOwnerWorkspace
});

export function initOwner() {
  // Keep owner quick actions delegated to their workspace. This covers the
  // static actions and any owner action rendered with fresh dashboard data,
  // without relying on a one-time document-wide selector during boot.
  elements["owner-workspace"].addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof globalThis.Element)) return;
    const action = target.closest("button[data-owner-action]")?.dataset.ownerAction;
    if (!action) return;
    openOwnerAction(action);
  });
}

async function loadOwnerWorkspace() {
  if (!identity?.activeOrganizationId) return;
  await Promise.allSettled([loadSales(), loadProjects(), loadCalendar(), loadContracts()]);
  renderOwnerWorkspace();
}

function renderOwnerWorkspace() {
  const metrics = elements["owner-workspace-metrics"];
  if (!metrics) return;
  const openInvoices = invoices.filter(
    (invoice) => !["PAID", "VOID", "CANCELLED", "CREDITED"].includes(invoice.status)
  );
  const estimatesToFollowUp = estimates.filter((estimate) =>
    ["DRAFT", "SENT", "VIEWED"].includes(estimate.status)
  );
  const activeJobs = projects.filter(
    (project) => !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(project.status ?? "ACTIVE")
  );
  const draftContracts = contracts.filter((contract) => contract.status === "DRAFT");
  const metricItems = [
    {
      label: "Open invoices",
      value: String(openInvoices.length),
      detail: "Need review, posting, or follow-up"
    },
    {
      label: "Estimates to follow up",
      value: String(estimatesToFollowUp.length),
      detail: "Draft, sent, or viewed"
    },
    { label: "Active jobs", value: String(activeJobs.length), detail: "Scheduled or in progress" },
    {
      label: "Draft agreements",
      value: String(draftContracts.length),
      detail: "Need details or review"
    }
  ];
  metrics.replaceChildren(
    ...metricItems.map((item) => {
      const wrapper = document.createElement("div");
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      const detail = document.createElement("small");
      term.textContent = item.label;
      value.textContent = item.value;
      detail.textContent = item.detail;
      wrapper.append(term, value, detail);
      return wrapper;
    })
  );

  const today = localCalendarDate();
  const upcoming = calendarEvents
    .filter((event) => event.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 4);
  elements["owner-today-list"].replaceChildren(
    ...(upcoming.length
      ? upcoming.map((event) =>
          ownerWorkspaceItem(
            `${formatOwnerDate(event.date)} · ${event.title}`,
            `${calendarTypeLabel(event)} · ${event.source?.reference ?? "Planning item"}`,
            "Open calendar",
            () => openOwnerAction("calendar")
          )
        )
      : [
          ownerWorkspaceEmpty(
            "No upcoming items in this calendar view. Plan a job or add a work item."
          )
        ])
  );

  const followUps = [
    ...estimatesToFollowUp.slice(0, 2).map((estimate) => ({
      title: `${estimate.estimateNumber ?? estimate.provisionalIdentifier} · ${estimate.customerName}`,
      detail: `${formatRole(estimate.status)} · ${formatMinor(estimate.grandTotalMinor)}`,
      label: "Open estimate",
      action: () => openOwnerAction("estimate")
    })),
    ...openInvoices
      .filter((invoice) => invoice.dueDate && invoice.dueDate < today)
      .slice(0, 2)
      .map((invoice) => ({
        title: `${invoice.invoiceNumber ?? invoice.provisionalIdentifier} · ${invoice.customerNameSnapshot}`,
        detail: `Past due ${formatOwnerDate(invoice.dueDate)} · ${formatMinor(invoice.grandTotalMinor, invoice.currency)}`,
        label: "Open invoices",
        action: () => openOwnerAction("invoice")
      }))
  ];
  elements["owner-attention-list"].replaceChildren(
    ...(followUps.length
      ? followUps.map((item) =>
          ownerWorkspaceItem(item.title, item.detail, item.label, item.action)
        )
      : [
          ownerWorkspaceEmpty(
            "No sales follow-up is currently flagged. Create an estimate when a new opportunity arrives."
          )
        ])
  );

  const jobsAndContracts = [
    ...activeJobs.slice(0, 3).map((project) => ({
      title: project.name,
      detail: `${project.projectNumber ?? "Job"} · ${customerNameForId(project.customerId)}`,
      label: "Open job",
      action: () => openOwnerAction("job")
    })),
    ...draftContracts.slice(0, 3).map((contract) => ({
      title: contract.title,
      detail: `${contract.unresolvedVariables?.length ?? 0} required field${contract.unresolvedVariables?.length === 1 ? "" : "s"} remaining`,
      label: "Open agreement",
      action: () => openContract(contract.id)
    }))
  ];
  elements["owner-jobs-list"].replaceChildren(
    ...(jobsAndContracts.length
      ? jobsAndContracts.map((item) =>
          ownerWorkspaceItem(item.title, item.detail, item.label, item.action)
        )
      : [ownerWorkspaceEmpty("Create a job or agreement to begin the delivery workflow.")])
  );
}

function ownerWorkspaceItem(title, detail, actionLabel, action) {
  const article = document.createElement("article");
  article.className = "owner-workspace-item";
  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  const text = document.createElement("p");
  const button = document.createElement("button");
  heading.textContent = title;
  text.textContent = detail;
  button.type = "button";
  button.className = "text-command";
  button.textContent = actionLabel;
  button.addEventListener("click", action);
  copy.append(heading, text);
  article.append(copy, button);
  return article;
}

function ownerWorkspaceEmpty(message) {
  const item = document.createElement("p");
  item.className = "empty-state";
  item.textContent = message;
  return item;
}

function customerNameForId(customerId) {
  return (
    customers.find((customer) => customer.id === customerId)?.displayName ?? "No customer selected"
  );
}

function formatOwnerDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date);
}

function openOwnerAction(action) {
  const destinations = {
    invoice: { workspaceId: "sales-workspace", targetId: "invoice-form" },
    estimate: { workspaceId: "sales-workspace", targetId: "estimate-form" },
    contact: { workspaceId: "sales-workspace", targetId: "customer-form" },
    job: { planningTab: "projects", targetId: "project-form" },
    calendar: { planningTab: "calendar", targetId: "calendar-heading" },
    contract: { workspaceId: "contracts-workspace", targetId: "contract-form" },
    contracts: { workspaceId: "contracts-workspace", targetId: "contract-form" },
    sales: { workspaceId: "sales-workspace", targetId: "invoice-designer-section" }
  };
  const destination = destinations[action];
  if (!destination) return;
  if (destination.planningTab) {
    openPlanningTab(destination.planningTab, { scroll: false });
  } else {
    navigateTo(destination.workspaceId, { scrollToTop: false });
  }
  globalThis.setTimeout(() => {
    const target = document.getElementById(destination.targetId);
    target?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
    focusCreateTarget(target);
  }, 0);
}
