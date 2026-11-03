// Projects, time, and calendar (`projects-workspace`).

import { formatMinor } from "../../money.js";
import { api, jsonRequest } from "../api.js";
import { preferredScrollBehavior } from "../lib/browser.js";
import { enhanceCreatableSelect } from "../lib/creatable-select.js";
import { commandButton, microsFromDecimal, moneyFromForm, option, row } from "../lib/dom.js";
import { localDateTimeToIso, toDateTimeLocal } from "../lib/format.js";
import { showError, showNotice } from "../lib/notices.js";
import { activeRoleIs, formatRole } from "../lib/roles.js";
import {
  loadCustomerRelationship,
  loadEvidenceInbox,
  loadWorkItemContacts,
  registerWorkspaceCalls
} from "../lib/workspace-calls.js";
import {
  navigateTo,
  refreshContextualSearches,
  revealWorkspaceTarget,
  syncWorkspaceNavigationState
} from "../shell.js";
import {
  activeWorkspaceId,
  calendarEvents,
  customerContacts,
  customerContactsById,
  customers,
  elements,
  identity,
  projectWorkItems,
  projects,
  setCalendarEvents,
  setProjectWorkItems,
  setProjects,
  setup,
  teamMembers
} from "../state.js";

let activeProject = null;
let activeProjectWorkItemId = null;
let selectedCalendarEventId = null;
let calendarLoadRequestId = 0;
let calendarMoveDraft = null;
let calendarFocusDate = new Date();
calendarFocusDate.setHours(0, 0, 0, 0);
let calendarView = "week";

registerWorkspaceCalls({
  calendarTypeLabel,
  loadCalendar,
  loadProjects,
  openPlanningTab,
  planningRelatedItemLabel,
  planningTabFromHash,
  renderProjectSelects,
  renderProjectWorkItemSelects,
  renderProjectWorkItems,
  reviewCapture,
  syncPlanningTabs
});

export function initProjects() {
  elements["refresh-projects"].addEventListener("click", loadProjects);
  elements["refresh-calendar"].addEventListener("click", loadCalendar);
  elements["calendar-previous"].addEventListener("click", () => moveCalendarPeriod(-1));
  elements["calendar-next"].addEventListener("click", () => moveCalendarPeriod(1));
  elements["calendar-today"].addEventListener("click", () => {
    calendarFocusDate = calendarToday();
    syncCalendarControls();
    void loadCalendar();
  });
  elements["calendar-date"].addEventListener("change", () => {
    const value = elements["calendar-date"].value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    calendarFocusDate = calendarDateFromString(value);
    void loadCalendar();
  });
  document.querySelectorAll("[data-calendar-view]").forEach((button) =>
    button.addEventListener("click", () => {
      calendarView = button.dataset.calendarView;
      syncCalendarControls();
      void loadCalendar();
    })
  );
  for (const filterId of [
    "calendar-project-filter",
    "calendar-work-item-filter",
    "calendar-invoice-filter",
    "calendar-bill-filter",
    "calendar-authority-filter"
  ])
    elements[filterId].addEventListener("change", renderCalendar);
  document
    .querySelectorAll("[data-planning-tab]")
    .forEach((button) =>
      button.addEventListener("click", () => openPlanningTab(button.dataset.planningTab))
    );
  elements["project-form"].addEventListener("submit", createProject);
  elements["project-work-item-form"].addEventListener("submit", saveProjectWorkItem);
  elements["project-work-item-form"].elements.customerId.addEventListener("change", () => {
    void loadWorkItemContacts();
  });
  elements["project-work-item-form"].elements.kind.addEventListener(
    "change",
    syncProjectWorkItemDateControls
  );
  elements["cancel-project-work-item-edit"].addEventListener("click", resetProjectWorkItemForm);
  elements["refresh-project-work-items"].addEventListener("click", loadProjectWorkItems);
  for (const filterId of [
    "work-item-kind-filter",
    "work-item-status-filter",
    "work-item-project-filter"
  ])
    elements[filterId].addEventListener("change", renderProjectWorkItems);
  elements["work-item-custom-status-filter"].addEventListener("input", renderProjectWorkItems);
  elements["time-entry-form"].addEventListener("submit", createTimeEntry);
  elements["mileage-form"].addEventListener("submit", createMileage);
  elements["capture-form"].addEventListener("submit", uploadCapture);
}

export async function loadProjects() {
  const [projectsResponse, timeResponse, capturesResponse, workItemsResponse] = await Promise.all([
    api("/v1/projects"),
    api("/v1/time-entries"),
    api("/v1/capture-reviews"),
    api("/v1/project-work-items")
  ]);
  if (!projectsResponse.ok) {
    if (projectsResponse.status !== 403) showError(projectsResponse);
    elements["projects-workspace"].hidden = true;
    return;
  }
  setProjects((await projectsResponse.json()).projects);
  const timeEntries = timeResponse.ok ? (await timeResponse.json()).timeEntries : [];
  const captures = capturesResponse.ok ? (await capturesResponse.json()).captures : [];
  setProjectWorkItems(workItemsResponse.ok ? (await workItemsResponse.json()).workItems : []);
  renderProjectSelects();
  renderProjectWorkItemSelects();
  renderProjectWorkItems();
  elements.projects.replaceChildren(...projects.map(renderProjectRow));
  if (activeProject) {
    const refreshed = projects.find((project) => project.id === activeProject.id);
    if (refreshed) await showProject(refreshed, false);
    else {
      activeProject = null;
      renderProjectActivity({ timeEntries, mileageLogs: [], captureReviews: [] });
    }
  } else {
    renderProjectActivity({ timeEntries, mileageLogs: [], captureReviews: captures });
  }
  if (activeWorkspaceId === "projects-workspace") void loadCalendar();
  void loadCustomerRelationship();
  refreshContextualSearches();
}

export function planningTabFromHash() {
  const match = /^#planning=(crm|calendar|projects|tasks|time|budgets|capture)$/.exec(
    window.location.hash
  );
  return match?.[1] ?? null;
}

export function openPlanningTab(tab, { updateHash = true, scroll = true } = {}) {
  const targets = {
    crm: { workspace: "projects-workspace", target: "customer-relationships-heading" },
    calendar: { workspace: "projects-workspace", target: "calendar-heading" },
    projects: { workspace: "projects-workspace", target: "projects" },
    tasks: { workspace: "projects-workspace", target: "project-work-items-heading" },
    time: { workspace: "projects-workspace", target: "time-entry-form" },
    budgets: { workspace: "planning-workspace", target: "budget-form" },
    capture: { workspace: "projects-workspace", target: "capture-form" }
  };
  const destination = targets[tab];
  if (!destination) return;
  if (updateHash) window.history.replaceState(null, "", `#planning=${tab}`);
  navigateTo(destination.workspace, { scrollToTop: false });
  revealWorkspaceTarget(destination.workspace, destination.target);
  syncPlanningTabs(tab);
  syncWorkspaceNavigationState(destination.workspace);
  if (tab === "calendar") void loadCalendar();
  if (tab === "tasks") void loadProjectWorkItems();
  if (scroll)
    document.getElementById(destination.target)?.scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    });
}

function syncPlanningTabs(tab) {
  for (const button of document.querySelectorAll("[data-planning-tab]"))
    button.toggleAttribute("aria-current", button.dataset.planningTab === tab);
}

function calendarToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function calendarDateFromString(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function calendarDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function calendarWeekStart(date) {
  const start = new Date(date);
  const weekday = start.getDay();
  start.setDate(start.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  start.setHours(0, 0, 0, 0);
  return start;
}

function calendarRange() {
  if (calendarView === "month") {
    const start = new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth(), 1);
    const end = new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth() + 1, 0);
    return { startDate: calendarDateString(start), endDate: calendarDateString(end) };
  }
  if (calendarView === "day") {
    const date = calendarDateString(calendarFocusDate);
    return { startDate: date, endDate: date };
  }
  const start = calendarWeekStart(calendarFocusDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { startDate: calendarDateString(start), endDate: calendarDateString(end) };
}

function calendarRangeLabel() {
  const { startDate, endDate } = calendarRange();
  const start = calendarDateFromString(startDate);
  const end = calendarDateFromString(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameDay = startDate === endDate;
  if (sameDay)
    return new Intl.DateTimeFormat("en-CA", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(start);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" })
  });
  const endFormatter = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  return `${formatter.format(start)} – ${endFormatter.format(end)}`;
}

function moveCalendarPeriod(offset) {
  const next = new Date(calendarFocusDate);
  if (calendarView === "month") next.setMonth(next.getMonth() + offset);
  else if (calendarView === "week" || calendarView === "agenda")
    next.setDate(next.getDate() + 7 * offset);
  else next.setDate(next.getDate() + offset);
  next.setHours(0, 0, 0, 0);
  calendarFocusDate = next;
  syncCalendarControls();
  void loadCalendar();
}

function syncCalendarControls() {
  elements["calendar-date"].value = calendarDateString(calendarFocusDate);
  elements["calendar-range-title"].textContent = calendarRangeLabel();
  for (const button of document.querySelectorAll("[data-calendar-view]")) {
    const selected = button.dataset.calendarView === calendarView;
    button.setAttribute("aria-pressed", String(selected));
  }
}

function setCalendarState({ loading = false, error = "", empty = false } = {}) {
  elements["calendar-loading"].hidden = !loading;
  elements["calendar-error"].hidden = !error;
  elements["calendar-error"].textContent = error;
  elements["calendar-empty"].hidden = !empty;
}

async function loadCalendar() {
  if (!identity?.activeOrganizationId) return;
  const requestId = ++calendarLoadRequestId;
  syncCalendarControls();
  const { startDate, endDate } = calendarRange();
  setCalendarState({ loading: true });
  elements["calendar-status"].textContent = "Loading schedule…";
  const response = await api(
    `/v1/calendar/events?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    {},
    true
  );
  if (requestId !== calendarLoadRequestId) return;
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.error?.message ?? "Calendar events could not be loaded.";
    const isResultLimit = body?.error?.code === "CALENDAR_RESULT_LIMIT_EXCEEDED";
    setCalendarEvents([]);
    renderCalendar();
    setCalendarState({
      error: isResultLimit
        ? `${message} This calendar does not show a partial result; choose a narrower range.`
        : response.status === 422
          ? `${message} Narrow the date range and try again.`
          : message
    });
    elements["calendar-status"].textContent = "Calendar unavailable";
    return;
  }
  const result = await response.json();
  if (requestId !== calendarLoadRequestId) return;
  setCalendarEvents(Array.isArray(result.calendar?.events) ? result.calendar.events : []);
  setCalendarState();
  elements["calendar-status"].textContent =
    `${calendarEvents.length} item${calendarEvents.length === 1 ? "" : "s"} in ${calendarRangeLabel()}.`;
  renderCalendar();
}

function calendarEventVisible(event) {
  const kindFilters = {
    PROJECT_START: elements["calendar-project-filter"].checked,
    PROJECT_END: elements["calendar-project-filter"].checked,
    WORK_ITEM_START: elements["calendar-work-item-filter"].checked,
    WORK_ITEM_DUE: elements["calendar-work-item-filter"].checked,
    WORK_ITEM_MILESTONE: elements["calendar-work-item-filter"].checked,
    INVOICE_DUE: elements["calendar-invoice-filter"].checked,
    BILL_DUE: elements["calendar-bill-filter"].checked
  };
  const authority = elements["calendar-authority-filter"].value;
  return kindFilters[event.kind] && (authority === "ALL" || event.authority === authority);
}

function calendarTypeLabel(event) {
  if (event.eventType && event.kind.startsWith("WORK_ITEM")) {
    return event.eventType;
  }
  return (
    {
      PROJECT_START: "Job starts",
      PROJECT_END: "Job ends",
      WORK_ITEM_START: "Scheduled item",
      WORK_ITEM_DUE: "Task due",
      WORK_ITEM_MILESTONE: "Milestone",
      INVOICE_DUE: "Invoice due",
      BILL_DUE: "Bill due"
    }[event.kind] ?? event.kind
  );
}

function calendarDisplayTitle(event) {
  if (event.source.type === "PROJECT_WORK_ITEM") return event.source.reference || event.title;
  return event.title;
}

function calendarStatusLabel(event) {
  return event.customStatus || formatRole(event.sourceStatus || event.authority);
}

function calendarClientOrJobLabel(event) {
  return [event.customerName, event.projectName].filter(Boolean).join(" · ") || "—";
}

function calendarCanManagePlanning() {
  return activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES");
}

function calendarEventIsTimed(event) {
  return (
    event.source.type === "PROJECT_WORK_ITEM" &&
    typeof event.startAt === "string" &&
    !Number.isNaN(new Date(event.startAt).valueOf())
  );
}

function calendarCanMoveEvent(event) {
  return calendarEventIsTimed(event) && event.canReschedule === true && calendarCanManagePlanning();
}

function visibleCalendarEvents() {
  const timedRecords = new Set();
  return calendarEvents.filter(calendarEventVisible).filter((event) => {
    if (!calendarEventIsTimed(event)) return true;
    const key = `${event.source.type}:${event.source.id}`;
    if (timedRecords.has(key)) return false;
    timedRecords.add(key);
    return true;
  });
}

function calendarTimeZone() {
  const candidate = setup?.settings?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

function calendarTimeParts(value) {
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: calendarTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    fields.filter((field) => field.type !== "literal").map((field) => [field.type, field.value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function calendarEventDate(event) {
  if (!calendarEventIsTimed(event)) return event.date;
  const parts = calendarTimeParts(event.startAt);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function calendarTimeLabel(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: calendarTimeZone(),
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function calendarDateLabel(dateString, { weekday = true } = {}) {
  const date = calendarDateFromString(dateString);
  return new Intl.DateTimeFormat("en-CA", {
    ...(weekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function calendarWhenLabel(event) {
  if (!calendarEventIsTimed(event)) return calendarDateLabel(event.date);
  const start = calendarTimeParts(event.startAt);
  const startDate = `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`;
  const end =
    event.endAt && !Number.isNaN(new Date(event.endAt).valueOf()) ? new Date(event.endAt) : null;
  const endLabel = end ? ` – ${calendarTimeLabel(end)}` : "";
  return `${calendarDateLabel(startDate)} · ${calendarTimeLabel(event.startAt)}${endLabel}`;
}

function calendarMinutesFor(value) {
  const parts = calendarTimeParts(value);
  return parts.hour * 60 + parts.minute;
}

function calendarEventDurationMinutes(event) {
  if (!calendarEventIsTimed(event)) return 30;
  const start = new Date(event.startAt);
  const end = event.endAt ? new Date(event.endAt) : null;
  if (!end || Number.isNaN(end.valueOf()) || end <= start) return 30;
  return Math.max(30, Math.round((end.valueOf() - start.valueOf()) / 60_000));
}

function calendarTimeInputValue(event) {
  const minutes = calendarMinutesFor(event.startAt);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function calendarTimeZoneOffsetMilliseconds(value) {
  const parts = calendarTimeParts(value);
  const wallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallClockAsUtc - new Date(value).valueOf();
}

function calendarDateTimeToIso(dateString, minutes) {
  const [year, month, day] = dateString.split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wallClockAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1)
    instant = wallClockAsUtc - calendarTimeZoneOffsetMilliseconds(new Date(instant));
  const result = new Date(instant);
  const parts = calendarTimeParts(result);
  if (
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  )
    return null;
  return result.toISOString();
}

function calendarDatesForTimedView() {
  const { startDate, endDate } = calendarRange();
  const dates = [];
  for (let current = calendarDateFromString(startDate); calendarDateString(current) <= endDate; ) {
    dates.push(calendarDateString(current));
    current = new Date(current);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function renderCalendar() {
  const visibleEvents = visibleCalendarEvents();
  const timedView = calendarView === "day" || calendarView === "week";
  elements["calendar-timed-grid"].hidden = !timedView;
  elements["calendar-grid"].hidden = calendarView !== "month";
  elements["calendar-agenda-section"].hidden = calendarView !== "agenda";
  if (timedView) {
    renderCalendarTimedView(visibleEvents);
    elements["calendar-empty"].hidden =
      visibleEvents.length !== 0 || !elements["calendar-error"].hidden;
    refreshSelectedCalendarEvent(visibleEvents);
    return;
  }
  if (calendarView === "agenda") {
    renderCalendarAgenda(visibleEvents);
    elements["calendar-empty"].hidden =
      visibleEvents.length !== 0 || !elements["calendar-error"].hidden;
    refreshSelectedCalendarEvent(visibleEvents);
    return;
  }
  const byDate = new Map();
  for (const event of visibleEvents) {
    const date = calendarEventDate(event);
    const day = byDate.get(date) ?? [];
    day.push(event);
    byDate.set(date, day);
  }
  const grid = elements["calendar-grid"];
  const headings = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => {
    const heading = document.createElement("div");
    heading.className = "calendar-weekday";
    heading.textContent = label;
    heading.setAttribute("aria-hidden", "true");
    return heading;
  });
  const first = new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth(), 1);
  const daysInMonth = new Date(
    calendarFocusDate.getFullYear(),
    calendarFocusDate.getMonth() + 1,
    0
  ).getDate();
  const blankDays = Array.from({ length: first.getDay() }, () => {
    const blank = document.createElement("div");
    blank.className = "calendar-day calendar-day--blank";
    blank.setAttribute("aria-hidden", "true");
    return blank;
  });
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(calendarFocusDate.getFullYear(), calendarFocusDate.getMonth(), index + 1);
    const dateString = calendarDateString(date);
    const events = byDate.get(dateString) ?? [];
    const cell = document.createElement("div");
    cell.className = "calendar-day";
    const label = document.createElement("span");
    label.className = "calendar-day-number";
    label.textContent = String(index + 1);
    cell.append(label);
    for (const event of events.slice(0, 3)) {
      cell.append(createCalendarEventButton(event));
    }
    if (events.length > 3) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "calendar-more-events";
      more.textContent = `+${events.length - 3} more`;
      more.addEventListener("click", () => showCalendarEvent(events[3]));
      cell.append(more);
    }
    return cell;
  });
  grid.replaceChildren(...headings, ...blankDays, ...days);
  elements["calendar-empty"].hidden =
    visibleEvents.length !== 0 || !elements["calendar-error"].hidden;
  refreshSelectedCalendarEvent(visibleEvents);
}

function renderCalendarAgenda(events) {
  const rows = [...events]
    .sort((left, right) => {
      const leftDate = calendarEventDate(left);
      const rightDate = calendarEventDate(right);
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return (left.startAt || "").localeCompare(right.startAt || "");
    })
    .map((event) => {
      const tr = row([
        calendarWhenLabel(event),
        calendarDisplayTitle(event),
        calendarClientOrJobLabel(event),
        calendarStatusLabel(event),
        event.amountMinor === null ? "—" : formatMinor(event.amountMinor, event.currency ?? "CAD")
      ]);
      const actions = document.createElement("td");
      actions.append(commandButton("Details", () => showCalendarEvent(event)));
      tr.append(actions);
      return tr;
    });
  elements["calendar-agenda"].replaceChildren(
    ...(rows.length ? rows : [row(["No matching events", "", "", "", "", ""])])
  );
}

function calendarTimedEntries(events, dates) {
  const visibleDates = new Set(dates);
  return events.filter(calendarEventIsTimed).flatMap((event) => {
    const start = new Date(event.startAt);
    const fallbackEnd = new Date(start.valueOf() + 30 * 60_000);
    const suppliedEnd = event.endAt ? new Date(event.endAt) : null;
    const end = suppliedEnd && suppliedEnd > start ? suppliedEnd : fallbackEnd;
    const startParts = calendarTimeParts(start);
    const endParts = calendarTimeParts(end);
    const startDate = `${startParts.year}-${String(startParts.month).padStart(2, "0")}-${String(
      startParts.day
    ).padStart(2, "0")}`;
    const endDate = `${endParts.year}-${String(endParts.month).padStart(2, "0")}-${String(
      endParts.day
    ).padStart(2, "0")}`;
    return dates
      .filter((date) => visibleDates.has(date) && date >= startDate && date <= endDate)
      .map((date) => {
        const startMinutes = date === startDate ? startParts.hour * 60 + startParts.minute : 0;
        let endMinutes = date === endDate ? endParts.hour * 60 + endParts.minute : 24 * 60;
        if (date === startDate && date === endDate && endMinutes <= startMinutes)
          endMinutes = Math.min(24 * 60, startMinutes + 30);
        if (date !== startDate && date === endDate && endMinutes === 0) endMinutes = 24 * 60;
        return { event, date, startMinutes, endMinutes: Math.max(startMinutes + 15, endMinutes) };
      });
  });
}

function calendarTimedBounds(entries) {
  if (!entries.length) return { start: 8 * 60, end: 18 * 60 };
  const earliest = Math.min(...entries.map((entry) => entry.startMinutes));
  const latest = Math.max(...entries.map((entry) => entry.endMinutes));
  let start = Math.max(0, Math.floor((earliest - 60) / 60) * 60);
  let end = Math.min(24 * 60, Math.ceil((latest + 60) / 60) * 60);
  start = Math.min(start, 8 * 60);
  end = Math.max(end, 18 * 60);
  if (end - start < 8 * 60) end = Math.min(24 * 60, start + 8 * 60);
  if (end - start < 8 * 60) start = Math.max(0, end - 8 * 60);
  return { start, end };
}

function layoutCalendarTimedEntries(entries) {
  const byDate = new Map();
  for (const entry of entries) {
    const day = byDate.get(entry.date) ?? [];
    day.push(entry);
    byDate.set(entry.date, day);
  }
  const positioned = [];
  for (const dayEntries of byDate.values()) {
    const sorted = [...dayEntries].sort(
      (left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes
    );
    let cluster = [];
    let clusterEnd = -1;
    const layOutCluster = () => {
      if (!cluster.length) return;
      const columnEnds = [];
      const assigned = cluster.map((entry) => {
        let column = columnEnds.findIndex((end) => end <= entry.startMinutes);
        if (column < 0) column = columnEnds.length;
        columnEnds[column] = entry.endMinutes;
        return { ...entry, column };
      });
      const columnCount = Math.max(1, columnEnds.length);
      positioned.push(...assigned.map((entry) => ({ ...entry, columnCount })));
      cluster = [];
      clusterEnd = -1;
    };
    for (const entry of sorted) {
      if (cluster.length && entry.startMinutes >= clusterEnd) layOutCluster();
      cluster.push(entry);
      clusterEnd = Math.max(clusterEnd, entry.endMinutes);
    }
    layOutCluster();
  }
  return positioned;
}

function calendarMinuteLabel(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(2026, 0, 1, hour, minute));
}

function createCalendarEventButton(event, { timed = false } = {}) {
  const eventButton = document.createElement("button");
  eventButton.type = "button";
  eventButton.className = `calendar-event calendar-event--${event.financial ? "financial" : "project"}`;
  eventButton.dataset.calendarEventId = event.id;
  const context = event.customerName || event.projectName;
  eventButton.textContent = `${calendarDisplayTitle(event)}${context ? ` · ${context}` : ""}`;
  eventButton.setAttribute(
    "aria-label",
    `${calendarWhenLabel(event)}, ${calendarDisplayTitle(event)}, ${calendarStatusLabel(event)}`
  );
  eventButton.addEventListener("click", () => showCalendarEvent(event));
  let touchStart = null;
  eventButton.addEventListener(
    "touchstart",
    (touchEvent) => {
      const touch = touchEvent.changedTouches[0];
      touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    { passive: true }
  );
  eventButton.addEventListener(
    "touchmove",
    (touchEvent) => {
      const touch = touchEvent.changedTouches[0];
      if (!touch || !touchStart) return;
      if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 12)
        touchStart = null;
    },
    { passive: true }
  );
  eventButton.addEventListener("touchend", (touchEvent) => {
    const touch = touchEvent.changedTouches[0];
    if (!touchStart || !touch) return;
    const tapped = Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) <= 12;
    touchStart = null;
    if (!tapped) return;
    touchEvent.preventDefault();
    showCalendarEvent(event);
  });
  if (!timed || !calendarCanMoveEvent(event)) return eventButton;
  // WebKit on touch devices treats a draggable button as a drag target before it treats it as
  // an activatable control. Mobile users retain the explicit date/time editor in the inspector.
  if (window.matchMedia?.("(pointer: coarse)").matches || globalThis.navigator.maxTouchPoints > 0) {
    eventButton.title = "Open to view or edit this appointment";
    return eventButton;
  }
  eventButton.draggable = true;
  eventButton.classList.add("calendar-event--movable");
  eventButton.title = "Drag to move this appointment";
  eventButton.addEventListener("dragstart", (dragEvent) => {
    dragEvent.dataTransfer?.setData("application/x-pennywise-calendar-event", event.id);
    if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = "move";
    eventButton.classList.add("calendar-event--dragging");
  });
  eventButton.addEventListener("dragend", () => {
    eventButton.classList.remove("calendar-event--dragging");
    document
      .querySelectorAll(".calendar-timed-day--dragover")
      .forEach((day) => day.classList.remove("calendar-timed-day--dragover"));
  });
  return eventButton;
}

function renderCalendarTimedView(events) {
  const dates = calendarDatesForTimedView();
  const entries = layoutCalendarTimedEntries(calendarTimedEntries(events, dates));
  const bounds = calendarTimedBounds(entries);
  const slotHeight = 28;
  const totalSlots = (bounds.end - bounds.start) / 30;
  const scheduleHeight = totalSlots * slotHeight;
  const allDayByDate = new Map();
  for (const event of events.filter((candidate) => !calendarEventIsTimed(candidate))) {
    const date = calendarEventDate(event);
    if (!dates.includes(date)) continue;
    const day = allDayByDate.get(date) ?? [];
    day.push(event);
    allDayByDate.set(date, day);
  }

  const root = elements["calendar-timed-grid"];
  const frame = document.createElement("div");
  frame.className = "calendar-timed-frame";
  frame.style.setProperty("--calendar-day-count", String(dates.length));
  frame.style.setProperty("--calendar-schedule-height", `${scheduleHeight}px`);
  frame.style.setProperty("--calendar-half-hour-height", `${slotHeight}px`);

  const header = document.createElement("div");
  header.className = "calendar-timed-header";
  const corner = document.createElement("div");
  corner.className = "calendar-timed-corner";
  corner.textContent = "Time";
  header.append(corner);
  for (const date of dates) {
    const label = document.createElement("div");
    label.className = "calendar-timed-day-heading";
    if (date === calendarDateString(calendarToday()))
      label.classList.add("calendar-timed-day-heading--today");
    label.textContent = new Intl.DateTimeFormat("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(calendarDateFromString(date));
    header.append(label);
  }

  const allDayRow = document.createElement("div");
  allDayRow.className = "calendar-all-day-row";
  const allDayLabel = document.createElement("div");
  allDayLabel.className = "calendar-all-day-label";
  allDayLabel.textContent = "All day";
  allDayRow.append(allDayLabel);
  for (const date of dates) {
    const cell = document.createElement("div");
    cell.className = "calendar-all-day-cell";
    for (const event of allDayByDate.get(date) ?? []) cell.append(createCalendarEventButton(event));
    allDayRow.append(cell);
  }

  const body = document.createElement("div");
  body.className = "calendar-timed-body";
  const axis = document.createElement("div");
  axis.className = "calendar-time-axis";
  for (let minute = bounds.start; minute < bounds.end; minute += 60) {
    const label = document.createElement("span");
    label.className = "calendar-time-label";
    label.style.top = `${((minute - bounds.start) / 30) * slotHeight}px`;
    label.textContent = calendarMinuteLabel(minute);
    axis.append(label);
  }
  body.append(axis);

  for (const date of dates) {
    const day = document.createElement("div");
    day.className = "calendar-timed-day";
    day.dataset.calendarDropDate = date;
    day.dataset.calendarBoundsStart = String(bounds.start);
    day.setAttribute("aria-label", `Schedule for ${calendarDateLabel(date)}`);
    day.addEventListener("dragover", (dragEvent) => {
      if (!dragEvent.dataTransfer?.types.includes("application/x-pennywise-calendar-event")) return;
      dragEvent.preventDefault();
      dragEvent.dataTransfer.dropEffect = "move";
      day.classList.add("calendar-timed-day--dragover");
    });
    day.addEventListener("dragleave", () => day.classList.remove("calendar-timed-day--dragover"));
    day.addEventListener("drop", (dropEvent) => {
      const eventId = dropEvent.dataTransfer?.getData("application/x-pennywise-calendar-event");
      const event = calendarEvents.find((candidate) => candidate.id === eventId);
      if (!event || !calendarCanMoveEvent(event)) return;
      dropEvent.preventDefault();
      day.classList.remove("calendar-timed-day--dragover");
      const rect = day.getBoundingClientRect();
      const relativeY = Math.max(0, Math.min(rect.height - 1, dropEvent.clientY - rect.top));
      const slot = Math.floor(relativeY / slotHeight);
      const minute = Math.min(bounds.end - 30, bounds.start + slot * 30);
      void rescheduleCalendarEvent(event, date, minute);
    });
    for (const entry of entries.filter((candidate) => candidate.date === date)) {
      const button = createCalendarEventButton(entry.event, { timed: true });
      button.classList.add("calendar-timed-event");
      const width = 100 / entry.columnCount;
      button.style.top = `${((entry.startMinutes - bounds.start) / 30) * slotHeight + 2}px`;
      button.style.height = `${Math.max(
        slotHeight - 4,
        ((entry.endMinutes - entry.startMinutes) / 30) * slotHeight - 4
      )}px`;
      button.style.left = `calc(${entry.column * width}% + 3px)`;
      button.style.width = `calc(${width}% - 6px)`;
      day.append(button);
    }
    body.append(day);
  }
  frame.append(header, allDayRow, body);
  root.replaceChildren(frame);
  const scheduleKey = `${calendarView}:${dates.join(",")}:${entries
    .map((entry) => `${entry.event.id}:${entry.startMinutes}:${entry.endMinutes}`)
    .sort()
    .join("|")}`;
  const movedToNewPeriod = root.dataset.calendarScheduleKey !== scheduleKey;
  root.dataset.calendarScheduleKey = scheduleKey;
  if (movedToNewPeriod && window.matchMedia?.("(max-width: 860px)").matches && entries.length) {
    const firstEntry = [...entries].sort(
      (left, right) => left.date.localeCompare(right.date) || left.startMinutes - right.startMinutes
    )[0];
    root.scrollTop = Math.max(
      0,
      ((firstEntry.startMinutes - bounds.start) / 30) * slotHeight - 2 * slotHeight
    );
    root.scrollLeft = Math.max(0, dates.indexOf(firstEntry.date) * 164 - 66);
  }
}

function refreshSelectedCalendarEvent(events) {
  if (!selectedCalendarEventId) return;
  const selected = events.find((event) => event.id === selectedCalendarEventId);
  if (selected) showCalendarEvent(selected, false);
  else {
    selectedCalendarEventId = null;
    calendarMoveDraft = null;
  }
}

function planningRelatedItemLabel(relatedResourceType, relatedResourceId) {
  if (!relatedResourceType) return null;
  if (relatedResourceType === "PROJECT") {
    const project = projects.find((candidate) => candidate.id === relatedResourceId);
    if (project) return `${project.projectNumber} — ${project.name}`;
  }
  return `Linked ${formatRole(relatedResourceType).toLowerCase()}`;
}

function calendarLinkedItemLabel(event) {
  return planningRelatedItemLabel(event.relatedResourceType, event.relatedResourceId);
}

function calendarMoveEditor(event) {
  const form = document.createElement("form");
  form.className = "calendar-move-editor";
  const legend = document.createElement("strong");
  legend.textContent = "Move appointment";
  const date = document.createElement("input");
  date.type = "date";
  date.name = "date";
  const draft = calendarMoveDraft?.eventId === event.id ? calendarMoveDraft : null;
  date.value = draft?.date ?? calendarEventDate(event);
  date.setAttribute("aria-label", "New date");
  const time = document.createElement("input");
  time.type = "time";
  time.name = "time";
  time.step = "1800";
  time.value = draft?.time ?? calendarTimeInputValue(event);
  time.setAttribute("aria-label", "New start time");
  const submit = commandButton("Save time");
  submit.type = "submit";
  form.append(legend, date, time, submit);
  const preserveDraft = () => {
    calendarMoveDraft = { eventId: event.id, date: date.value, time: time.value };
  };
  date.addEventListener("input", preserveDraft);
  date.addEventListener("change", preserveDraft);
  time.addEventListener("input", preserveDraft);
  time.addEventListener("change", preserveDraft);
  form.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const [hours, minutes] = time.value.split(":").map(Number);
    if (!date.value || Number.isNaN(hours) || Number.isNaN(minutes)) {
      showNotice("Choose both a date and a start time.", true);
      return;
    }
    void rescheduleCalendarEvent(event, date.value, hours * 60 + minutes);
  });
  return form;
}

async function rescheduleCalendarEvent(event, date, minute) {
  if (!calendarCanMoveEvent(event)) {
    showNotice("Your role can view this appointment but cannot change its schedule.", true);
    return;
  }
  const startAt = calendarDateTimeToIso(date, minute);
  if (!startAt) {
    showNotice(
      "That local time is not available in this company’s time zone. Choose another time.",
      true
    );
    return;
  }
  const currentResponse = await api(`/v1/project-work-items/${event.source.id}`, {}, true);
  if (!currentResponse.ok) return showError(currentResponse);
  const current = (await currentResponse.json()).workItem;
  const duration = calendarEventDurationMinutes({
    ...event,
    startAt: current.startAt,
    endAt: current.endAt
  });
  const endAt = new Date(new Date(startAt).valueOf() + duration * 60_000).toISOString();
  const response = await api(
    `/v1/project-work-items/${event.source.id}`,
    jsonRequest({ version: current.version, startAt, endAt }, "PATCH")
  );
  if (!response.ok) {
    if (response.status === 409) {
      calendarMoveDraft = null;
      await Promise.all([loadProjectWorkItems(), loadCalendar()]);
      showNotice(
        "This appointment changed in another session. The current schedule is now shown.",
        true
      );
      return;
    }
    return showError(response);
  }
  const moved = { ...event, startAt, endAt };
  calendarMoveDraft = null;
  // Keep the selected appointment truthful immediately, including on mobile
  // browsers where a background calendar refresh can complete after the user
  // has opened its detail panel. The subsequent server refresh remains the
  // source of truth and reconciles any other changed fields.
  setCalendarEvents(
    calendarEvents.map((candidate) =>
      candidate.id === moved.id ? { ...candidate, ...moved } : candidate
    )
  );
  renderCalendar();
  await Promise.all([loadProjectWorkItems(), loadCalendar()]);
  showNotice(`${calendarDisplayTitle(moved)} moved to ${calendarWhenLabel(moved)}.`);
}

function showCalendarEvent(event, scroll = true) {
  if (selectedCalendarEventId !== event.id) calendarMoveDraft = null;
  selectedCalendarEventId = event.id;
  const details = elements["calendar-event-details"];
  const heading = document.createElement("h3");
  heading.id = "calendar-event-details-heading";
  heading.textContent = calendarDisplayTitle(event);
  const summary = document.createElement("p");
  summary.textContent = `${calendarWhenLabel(event)} · ${calendarTypeLabel(event)} · ${calendarStatusLabel(event)}`;
  const description = event.description ? document.createElement("p") : null;
  if (description) description.textContent = event.description;
  const facts = document.createElement("dl");
  const factRows = [
    ...(event.customerName ? [["Client", event.customerName]] : []),
    ...(event.contactName ? [["Contact", event.contactName]] : []),
    ...(event.projectName ? [["Job", event.projectName]] : []),
    ...(event.assigneeName ? [["Assigned to", event.assigneeName]] : []),
    ...(event.location ? [["Location", event.location]] : []),
    ...(event.category ? [["Category", event.category]] : []),
    ...(event.label ? [["Label", event.label]] : []),
    ...(calendarLinkedItemLabel(event) ? [["Linked item", calendarLinkedItemLabel(event)]] : []),
    ...(event.amountMinor === null
      ? []
      : [["Amount", formatMinor(event.amountMinor, event.currency ?? "CAD")]])
  ];
  for (const [term, value] of factRows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    facts.append(dt, dd);
  }
  const actions = document.createElement("div");
  actions.className = "calendar-detail-actions";
  const actionLabel =
    event.source.type === "PROJECT_WORK_ITEM"
      ? "Open and edit"
      : event.source.type === "PROJECT"
        ? "Open job"
        : event.source.type === "INVOICE"
          ? "Go to invoices"
          : "Go to bills";
  actions.append(commandButton(actionLabel, () => openCalendarRecord(event)));
  if (calendarCanMoveEvent(event)) actions.append(calendarMoveEditor(event));
  const guidance = document.createElement("p");
  guidance.className = "calendar-guardrail";
  guidance.textContent = event.financial
    ? "This due date comes from a financial document. Open it to change the date; the calendar never changes accounting."
    : calendarEventIsTimed(event)
      ? calendarCanManagePlanning()
        ? "Drag this appointment to another time slot, or use the date and time controls above. Scheduling changes do not create accounting entries."
        : "This appointment is view-only for your role."
      : "Add a start and end time in the planning item to place it in the timed schedule.";
  details.replaceChildren(
    heading,
    summary,
    ...(description ? [description] : []),
    facts,
    actions,
    guidance
  );
  if (scroll) details.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
}

function openCalendarRecord(event) {
  if (event.source.type === "PROJECT_WORK_ITEM") {
    const workItem = projectWorkItems.find((candidate) => candidate.id === event.source.id);
    openPlanningTab("tasks", { updateHash: true, scroll: false });
    if (workItem) showProjectWorkItemDetails(workItem);
    else {
      void loadProjectWorkItems().then(() => {
        const refreshed = projectWorkItems.find((candidate) => candidate.id === event.source.id);
        if (refreshed) showProjectWorkItemDetails(refreshed);
        else showNotice("This planning item is no longer available.", true);
      });
    }
    return;
  }
  if (event.source.type === "PROJECT") {
    const project = projects.find((candidate) => candidate.id === event.source.id);
    openPlanningTab("projects", { updateHash: true, scroll: false });
    if (project) void showProject(project);
    else showNotice("This job is no longer available.", true);
    return;
  }
  navigateTo(event.source.type === "INVOICE" ? "sales-workspace" : "purchases-workspace");
  showNotice(
    event.source.type === "INVOICE"
      ? "Open the invoice list to review or change this due date."
      : "Open the bill list to review or change this due date."
  );
}

async function loadProjectWorkItems() {
  if (!identity?.activeOrganizationId) return;
  const response = await api("/v1/project-work-items", {}, true);
  if (!response.ok) {
    if (response.status === 403) elements["project-work-items-panel"].hidden = true;
    else showError(response);
    return;
  }
  elements["project-work-items-panel"].hidden = false;
  setProjectWorkItems((await response.json()).workItems);
  renderProjectWorkItemSelects();
  renderProjectWorkItems();
  if (activeProjectWorkItemId) {
    const selected = projectWorkItems.find((item) => item.id === activeProjectWorkItemId);
    if (selected) showProjectWorkItemDetails(selected, false);
    else activeProjectWorkItemId = null;
  }
}

function renderProjectWorkItemSelects() {
  if (!elements["project-work-item-form"]) return;
  const form = elements["project-work-item-form"];
  const projectValue = form.elements.projectId.value;
  const customerValue = form.elements.customerId.value;
  const contactValue = form.elements.contactId.value;
  const assigneeValue = form.elements.assigneeMembershipId.value;
  const filterValue = elements["work-item-project-filter"].value;
  const activeProjects = projects.filter((project) => project.status !== "ARCHIVED");
  form.elements.projectId.replaceChildren(
    option("", "No project"),
    ...activeProjects.map((project) =>
      option(project.id, `${project.projectNumber} | ${project.name}`)
    )
  );
  form.elements.customerId.replaceChildren(
    option("", "No client"),
    ...customers
      .filter((customer) => customer.active)
      .map((customer) =>
        option(customer.id, `${customer.customerNumber} | ${customer.displayName}`)
      )
  );
  elements["work-item-project-filter"].replaceChildren(
    option("", "All projects"),
    ...activeProjects.map((project) =>
      option(project.id, `${project.projectNumber} | ${project.name}`)
    )
  );
  form.elements.assigneeMembershipId.replaceChildren(
    option("", "Unassigned"),
    ...teamMembers
      .filter((member) => member.status === "ACTIVE")
      .map((member) => option(member.id, member.displayName || member.email))
  );
  if ([...form.elements.projectId.options].some((entry) => entry.value === projectValue))
    form.elements.projectId.value = projectValue;
  if ([...form.elements.customerId.options].some((entry) => entry.value === customerValue))
    form.elements.customerId.value = customerValue;
  if (
    [...form.elements.assigneeMembershipId.options].some((entry) => entry.value === assigneeValue)
  )
    form.elements.assigneeMembershipId.value = assigneeValue;
  const contacts = customerContactsById.get(form.elements.customerId.value) ?? [];
  form.elements.contactId.replaceChildren(
    option("", "No contact"),
    ...contacts
      .filter((contact) => contact.active)
      .map((contact) => option(contact.id, contact.name))
  );
  if ([...form.elements.contactId.options].some((entry) => entry.value === contactValue))
    form.elements.contactId.value = contactValue;
  if (
    [...elements["work-item-project-filter"].options].some((entry) => entry.value === filterValue)
  )
    elements["work-item-project-filter"].value = filterValue;
}

function renderProjectWorkItems() {
  if (!elements["project-work-items"]) return;
  const kind = elements["work-item-kind-filter"].value;
  const status = elements["work-item-status-filter"].value;
  const projectId = elements["work-item-project-filter"].value;
  const customStatus = elements["work-item-custom-status-filter"].value.trim().toLowerCase();
  const visible = projectWorkItems.filter(
    (item) =>
      (!kind || item.kind === kind) &&
      (!status || item.status === status) &&
      (!projectId || item.projectId === projectId) &&
      (!customStatus || (item.customStatus ?? "").toLowerCase().includes(customStatus))
  );
  elements["project-work-items"].replaceChildren(
    ...(visible.length
      ? visible.map(renderProjectWorkItemRow)
      : [row(["No planning items match these filters.", "", "", "", ""])])
  );
  const terminal = new Set(["COMPLETED", "CANCELLED"]);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const soonDate = soon.toISOString().slice(0, 10);
  elements["work-item-open-count"].textContent = String(
    projectWorkItems.filter((item) => !terminal.has(item.status)).length
  );
  elements["work-item-blocked-count"].textContent = String(
    projectWorkItems.filter((item) => item.status === "BLOCKED").length
  );
  elements["work-item-due-count"].textContent = String(
    projectWorkItems.filter(
      (item) =>
        !terminal.has(item.status) &&
        item.dueDate &&
        item.dueDate >= today &&
        item.dueDate <= soonDate
    ).length
  );
  elements["work-item-complete-count"].textContent = String(
    projectWorkItems.filter((item) => item.status === "COMPLETED").length
  );
}

function planningScheduleLabel(item) {
  if (item.startAt || item.endAt) {
    const start = item.startAt ? new Date(item.startAt) : null;
    const end = item.endAt ? new Date(item.endAt) : null;
    const startParts = start && !Number.isNaN(start.valueOf()) ? calendarTimeParts(start) : null;
    const startDate = startParts
      ? `${startParts.year}-${String(startParts.month).padStart(2, "0")}-${String(startParts.day).padStart(2, "0")}`
      : null;
    return `${startDate ? calendarDateLabel(startDate) : "No start date"} · ${start ? calendarTimeLabel(start) : "No start time"}${end ? ` – ${calendarTimeLabel(end)}` : ""}`;
  }
  if (item.kind === "MILESTONE") return item.dueDate || "No date";
  return `${item.startDate || "No start"} → ${item.dueDate || "No due date"}`;
}

function renderProjectWorkItemRow(item) {
  const itemCell = document.createElement("div");
  itemCell.className = "work-item-name";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const metadata = document.createElement("small");
  const project = projects.find((candidate) => candidate.id === item.projectId);
  metadata.textContent = `${formatRole(item.kind)} · ${formatRole(item.priority)}${project ? ` · ${project.projectNumber}` : ""}`;
  if (item.customStatus) metadata.textContent += ` · ${item.customStatus}`;
  itemCell.append(title, metadata);
  const assignee = teamMembers.find((member) => member.id === item.assigneeMembershipId);
  const status = document.createElement("select");
  status.setAttribute("aria-label", `Status for ${item.title}`);
  for (const value of ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"])
    status.append(option(value, formatRole(value)));
  status.value = item.status;
  status.addEventListener("change", () => updateProjectWorkItemStatus(item, status.value));
  const actions = document.createElement("div");
  actions.className = "table-command-group";
  actions.append(
    commandButton("Details", () => showProjectWorkItemDetails(item)),
    commandButton("Edit", () => editProjectWorkItem(item)),
    commandButton("Archive", () => archiveProjectWorkItem(item))
  );
  return row([
    itemCell,
    planningScheduleLabel(item),
    assignee?.displayName || assignee?.email || "Unassigned",
    status,
    actions
  ]);
}

function syncProjectWorkItemDateControls() {
  const form = elements["project-work-item-form"];
  const milestone = form.elements.kind.value === "MILESTONE";
  form.elements.startDate.disabled = milestone;
  form.elements.dueDate.required = milestone;
  if (milestone) form.elements.startDate.value = "";
  elements["work-item-date-help"].textContent = milestone
    ? "A milestone appears once on the calendar and requires a due date."
    : "Tasks and reminders may use a start, a due date, or both.";
}

async function saveProjectWorkItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const workItemId = String(data.get("workItemId") ?? "");
  const kind = String(data.get("kind"));
  const payload = {
    kind,
    title: data.get("title"),
    description: String(data.get("description") || "") || null,
    priority: data.get("priority"),
    projectId: String(data.get("projectId") || "") || null,
    customerId: String(data.get("customerId") || "") || null,
    contactId: String(data.get("contactId") || "") || null,
    assigneeMembershipId: String(data.get("assigneeMembershipId") || "") || null,
    eventType: String(data.get("eventType") || "") || undefined,
    customStatus: String(data.get("customStatus") || "") || null,
    category: String(data.get("category") || "") || null,
    label: String(data.get("label") || "") || null,
    location: String(data.get("location") || "") || null,
    startAt: localDateTimeToIso(data.get("startAt")),
    endAt: localDateTimeToIso(data.get("endAt")),
    relatedResourceType: String(data.get("relatedResourceType") || "") || null,
    relatedResourceId: String(data.get("relatedResourceId") || "") || null,
    startDate: kind === "MILESTONE" ? null : String(data.get("startDate") || "") || null,
    dueDate: String(data.get("dueDate") || "") || null,
    ...(workItemId ? { version: Number(data.get("version")) } : {})
  };
  const response = await api(
    workItemId ? `/v1/project-work-items/${workItemId}` : "/v1/project-work-items",
    jsonRequest(payload, workItemId ? "PATCH" : "POST")
  );
  if (!response.ok) {
    if (response.status === 409) {
      await loadProjectWorkItems();
      const latest = projectWorkItems.find((item) => item.id === workItemId);
      if (latest) editProjectWorkItem(latest, false);
      return showNotice(
        "This planning item changed in another session. The latest version is loaded for review.",
        true
      );
    }
    return showError(response);
  }
  resetProjectWorkItemForm();
  await Promise.all([loadProjectWorkItems(), loadCalendar()]);
  showNotice(
    workItemId ? "Planning item updated." : "Planning item added to the shared work plan."
  );
}

function editProjectWorkItem(item, scroll = true) {
  const form = elements["project-work-item-form"];
  activeProjectWorkItemId = item.id;
  form.elements.workItemId.value = item.id;
  form.elements.version.value = String(item.version);
  form.elements.kind.value = item.kind;
  form.elements.priority.value = item.priority;
  form.elements.title.value = item.title;
  form.elements.description.value = item.description ?? "";
  form.elements.projectId.value = item.projectId ?? "";
  form.elements.customerId.value = item.customerId ?? "";
  void loadWorkItemContacts().then(() => {
    form.elements.contactId.value = item.contactId ?? "";
  });
  form.elements.eventType.value = item.eventType ?? "";
  form.elements.customStatus.value = item.customStatus ?? "";
  form.elements.category.value = item.category ?? "";
  form.elements.label.value = item.label ?? "";
  form.elements.location.value = item.location ?? "";
  form.elements.startAt.value = item.startAt ? toDateTimeLocal(item.startAt) : "";
  form.elements.endAt.value = item.endAt ? toDateTimeLocal(item.endAt) : "";
  form.elements.relatedResourceType.value = item.relatedResourceType ?? "";
  form.elements.relatedResourceId.value = item.relatedResourceId ?? "";
  form.elements.assigneeMembershipId.value = item.assigneeMembershipId ?? "";
  form.elements.startDate.value = item.startDate ?? "";
  form.elements.dueDate.value = item.dueDate ?? "";
  elements["work-item-form-heading"].textContent = "Edit planning item";
  elements["save-project-work-item"].textContent = "Save planning item";
  elements["cancel-project-work-item-edit"].hidden = false;
  syncProjectWorkItemDateControls();
  if (scroll)
    elements["work-item-form-heading"].scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    });
}

function resetProjectWorkItemForm() {
  const form = elements["project-work-item-form"];
  form.reset();
  activeProjectWorkItemId = null;
  form.elements.workItemId.value = "";
  form.elements.version.value = "";
  elements["work-item-form-heading"].textContent = "New planning item";
  elements["save-project-work-item"].textContent = "Create planning item";
  elements["cancel-project-work-item-edit"].hidden = true;
  renderProjectWorkItemSelects();
  syncProjectWorkItemDateControls();
}

async function updateProjectWorkItemStatus(item, status) {
  if (status === item.status) return;
  const response = await api(
    `/v1/project-work-items/${item.id}/status`,
    jsonRequest({ status, version: item.version })
  );
  if (!response.ok) {
    await loadProjectWorkItems();
    return showError(response);
  }
  await Promise.all([loadProjectWorkItems(), loadCalendar()]);
  showNotice(`${item.title} is now ${formatRole(status).toLowerCase()}.`);
}

async function archiveProjectWorkItem(item) {
  if (!window.confirm(`Archive “${item.title}”? Its audit history will be retained.`)) return;
  const response = await api(
    `/v1/project-work-items/${item.id}/archive`,
    jsonRequest({ version: item.version })
  );
  if (!response.ok) return showError(response);
  if (activeProjectWorkItemId === item.id) resetProjectWorkItemForm();
  await Promise.all([loadProjectWorkItems(), loadCalendar()]);
  showNotice("Planning item archived.");
}

function showProjectWorkItemDetails(item, scroll = true) {
  activeProjectWorkItemId = item.id;
  const panel = elements["project-work-item-details"];
  const heading = document.createElement("h3");
  heading.id = "project-work-item-details-heading";
  heading.textContent = item.title;
  const description = document.createElement("p");
  description.textContent = item.description || "No additional details.";
  const facts = document.createElement("dl");
  const project = projects.find((candidate) => candidate.id === item.projectId);
  const assignee = teamMembers.find((member) => member.id === item.assigneeMembershipId);
  for (const [term, value] of [
    ["Type", formatRole(item.kind)],
    ["Event type", formatRole(item.eventType || item.kind)],
    ...(item.customStatus ? [["Status note", item.customStatus]] : []),
    ...(item.category ? [["Category", item.category]] : []),
    ...(item.label ? [["Label", item.label]] : []),
    ["Status", formatRole(item.status)],
    ["Priority", formatRole(item.priority)],
    ["Project", project ? `${project.projectNumber} | ${project.name}` : "No project"],
    [
      "Client",
      customers.find((customer) => customer.id === item.customerId)?.displayName ?? "No client"
    ],
    [
      "Contact",
      customerContacts.find((contact) => contact.id === item.contactId)?.name ?? "No contact"
    ],
    ...(item.location ? [["Location", item.location]] : []),
    ...(planningRelatedItemLabel(item.relatedResourceType, item.relatedResourceId)
      ? [
          [
            "Linked item",
            planningRelatedItemLabel(item.relatedResourceType, item.relatedResourceId)
          ]
        ]
      : []),
    ["Assignee", assignee?.displayName || assignee?.email || "Unassigned"],
    ["Schedule", planningScheduleLabel(item)]
  ]) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    facts.append(dt, dd);
  }
  const dependencyHeading = document.createElement("h4");
  dependencyHeading.textContent = "Dependencies";
  const dependencyList = document.createElement("ul");
  dependencyList.className = "work-item-dependency-list";
  for (const dependencyId of item.dependencyIds) {
    const dependency = projectWorkItems.find((candidate) => candidate.id === dependencyId);
    const entry = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = dependency?.title ?? "Unavailable planning item";
    entry.append(
      label,
      commandButton("Remove", () => removeProjectWorkItemDependency(item, dependencyId))
    );
    dependencyList.append(entry);
  }
  if (!item.dependencyIds.length) {
    const empty = document.createElement("li");
    empty.textContent = "No dependencies.";
    dependencyList.append(empty);
  }
  const addDependency = document.createElement("div");
  addDependency.className = "work-item-dependency-add";
  const dependencySelect = document.createElement("select");
  dependencySelect.setAttribute("aria-label", `Dependency for ${item.title}`);
  dependencySelect.append(
    option("", "Choose an item"),
    ...projectWorkItems
      .filter(
        (candidate) =>
          candidate.id !== item.id &&
          !item.dependencyIds.includes(candidate.id) &&
          !candidate.archivedAt
      )
      .map((candidate) => option(candidate.id, candidate.title))
  );
  const add = commandButton("Add dependency", () => {
    if (dependencySelect.value) void addProjectWorkItemDependency(item, dependencySelect.value);
  });
  add.disabled = dependencySelect.options.length <= 1;
  addDependency.append(dependencySelect, add);
  const dependentNote = document.createElement("p");
  dependentNote.className = "field-help";
  dependentNote.textContent = item.dependentIds.length
    ? `${item.dependentIds.length} other planning item(s) depend on this one.`
    : "No other planning items depend on this one.";
  panel.replaceChildren(
    heading,
    description,
    facts,
    dependencyHeading,
    dependencyList,
    addDependency,
    dependentNote
  );
  if (scroll) panel.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
}

async function addProjectWorkItemDependency(item, dependsOnItemId) {
  const response = await api(
    `/v1/project-work-items/${item.id}/dependencies`,
    jsonRequest({ dependsOnItemId, version: item.version })
  );
  if (!response.ok) return showError(response);
  await loadProjectWorkItems();
  showNotice("Dependency added. Circular dependencies are rejected automatically.");
}

async function removeProjectWorkItemDependency(item, dependsOnItemId) {
  const response = await api(
    `/v1/project-work-items/${item.id}/dependencies/${dependsOnItemId}`,
    jsonRequest({ version: item.version }, "DELETE")
  );
  if (!response.ok) return showError(response);
  await loadProjectWorkItems();
  showNotice("Dependency removed.");
}

function renderProjectSelects() {
  const customerOptions = customers
    .filter((customer) => customer.active)
    .map((customer) => option(customer.id, `${customer.customerNumber} | ${customer.displayName}`));
  const projectFormCustomerId = elements["project-form"].elements.customerId.value;
  elements["project-form"].elements.customerId.replaceChildren(...customerOptions);
  if (
    [...elements["project-form"].elements.customerId.options].some(
      (item) => item.value === projectFormCustomerId
    )
  )
    elements["project-form"].elements.customerId.value = projectFormCustomerId;
  enhanceCreatableSelect(elements["project-form"].elements.customerId, {
    label: "Project customer",
    placeholder: customers.length ? "Search customers" : "No customers yet",
    emptyText: "No customers yet. Use + to add the first customer.",
    createButton: elements["project-form"].querySelector('[data-contextual-create="customer"]'),
    createLabel: "Create a new customer",
    canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "SALES")
  });
  const projectOptions = projects
    .filter((project) => project.status !== "ARCHIVED")
    .map((project) => option(project.id, `${project.projectNumber} | ${project.name}`));
  for (const formId of ["time-entry-form", "mileage-form", "capture-form"]) {
    const select = elements[formId].elements.projectId;
    const previous = select.value;
    select.replaceChildren(
      ...(formId === "mileage-form" || formId === "capture-form" ? [option("", "No project")] : []),
      ...projectOptions.map((item) => item.cloneNode(true))
    );
    if ([...select.options].some((item) => item.value === previous)) select.value = previous;
    enhanceCreatableSelect(select, {
      label: formId === "time-entry-form" ? "Time-entry project" : "Project",
      placeholder: projects.length ? "Search projects" : "No projects yet",
      emptyText: "No projects yet. Use + to add the first project.",
      createButton: elements[formId].querySelector('[data-contextual-create="project"]'),
      createLabel: "Create a new project",
      canCreate: activeRoleIs("OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "PROJECTS")
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const formId of ["time-entry-form", "mileage-form"])
    if (!elements[formId].elements.entryDate.value)
      elements[formId].elements.entryDate.value = today;
}

function renderProjectRow(project) {
  const tr = row([
    project.projectNumber,
    project.name,
    project.customerName ?? "",
    formatRole(project.status),
    project.budgetMinor === null ? "No budget" : formatMinor(project.budgetMinor)
  ]);
  const actions = document.createElement("td");
  actions.append(commandButton("Open", () => showProject(project)));
  const statusActions = {
    ACTIVE: ["hold", "Hold"],
    ON_HOLD: ["resume", "Resume"],
    COMPLETED: ["archive", "Archive"]
  }[project.status];
  if (statusActions)
    actions.append(
      commandButton(statusActions[1], () => setProjectStatus(project, statusActions[0]))
    );
  tr.append(actions);
  return tr;
}

async function showProject(project, scroll = true) {
  const response = await api(`/v1/projects/${project.id}`);
  if (!response.ok) return showError(response);
  activeProject = (await response.json()).project;
  elements["project-detail"].textContent =
    `${activeProject.projectNumber} | ${activeProject.name} | ${activeProject.customerName}\n` +
    `Status: ${formatRole(activeProject.status)} | Billing: ${formatRole(activeProject.billingMethod)} | ` +
    `Budget: ${activeProject.budgetMinor === null ? "none" : formatMinor(activeProject.budgetMinor)}`;
  renderProjectActivity(activeProject);
  if (scroll)
    elements["project-detail-heading"].scrollIntoView({
      behavior: preferredScrollBehavior(),
      block: "start"
    });
}

function renderProjectActivity(detail) {
  const entries = (detail.timeEntries ?? []).map((entry) => ({
    date: entry.entryDate,
    type: "Time",
    description: entry.description ?? "Time entry",
    amount: formatMinor(entry.amountMinor),
    status: formatRole(entry.status),
    action: ["DRAFT", "SUBMITTED"].includes(entry.status)
      ? commandButton("Approve", () => approveTimeEntry(entry))
      : null
  }));
  const mileage = (detail.mileageLogs ?? []).map((entry) => ({
    date: entry.entryDate,
    type: "Mileage",
    description: entry.purpose,
    amount: formatMinor(entry.amountMinor),
    status: formatRole(entry.status),
    action: null
  }));
  const captures = (detail.captureReviews ?? []).map((capture) => ({
    date: new Date(capture.createdAt).toISOString().slice(0, 10),
    type: capture.kind === "BILL" ? "Bill evidence" : "Receipt",
    description: capture.reviewNotes ?? "Evidence awaiting review",
    amount: capture.ocrConfidence
      ? `OCR ${Math.round(Number(capture.ocrConfidence) * 100)}%`
      : "Manual review",
    status: formatRole(capture.status),
    action: ["REVIEW_REQUIRED", "RECEIVED"].includes(capture.status)
      ? commandButton("Approve", () => reviewCapture(capture, "APPROVED"))
      : null
  }));
  elements["project-activity"].replaceChildren(
    ...[...entries, ...mileage, ...captures].map((item) => {
      const tr = row([item.date, item.type, item.description, item.amount, item.status]);
      const actions = document.createElement("td");
      if (item.action) actions.append(item.action);
      tr.append(actions);
      return tr;
    })
  );
}

async function setProjectStatus(project, action) {
  const response = await api(
    `/v1/projects/${project.id}/${action}`,
    jsonRequest({ version: project.version })
  );
  if (!response.ok) return showError(response);
  await loadProjects();
  const message =
    action === "archive"
      ? "archived"
      : action === "hold"
        ? "put on hold"
        : action === "resume"
          ? "resumed"
          : `${action}d`;
  showNotice(`Project ${message}.`);
}

async function createProject(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const budgetMinor = data.get("budgetMinor") ? moneyFromForm(data, "budgetMinor") : null;
  if (data.get("budgetMinor") && budgetMinor === null) return;
  const response = await api(
    "/v1/projects",
    jsonRequest({
      customerId: data.get("customerId"),
      projectNumber: data.get("projectNumber"),
      name: data.get("name"),
      description: data.get("description") || null,
      billingMethod: data.get("billingMethod"),
      startDate: data.get("startDate") || null,
      endDate: data.get("endDate") || null,
      budgetMinor,
      tags: []
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadProjects();
  showNotice("Project created. You can now record work against it.");
}

async function createTimeEntry(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const durationMicros = microsFromDecimal(data.get("hours"), "Hours");
  const rateMinor = moneyFromForm(data, "rateMinor");
  if (durationMicros === null || rateMinor === null) return;
  const response = await api(
    `/v1/projects/${data.get("projectId")}/time-entries`,
    jsonRequest({
      entryDate: data.get("entryDate"),
      durationMicros,
      rateMinor,
      description: data.get("description") || null,
      billable: data.get("billable") === "on"
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadProjects();
  showNotice("Time draft saved. Approve it after review.");
}

async function createMileage(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const distanceMicros = microsFromDecimal(data.get("distance"), "Distance");
  const reimbursementRateMinor = moneyFromForm(data, "reimbursementRateMinor");
  if (distanceMicros === null || reimbursementRateMinor === null) return;
  const response = await api(
    "/v1/mileage",
    jsonRequest({
      projectId: data.get("projectId") || null,
      entryDate: data.get("entryDate"),
      purpose: data.get("purpose"),
      distanceMicros,
      vehicleLabel: data.get("vehicleLabel") || null,
      reimbursementRateMinor
    })
  );
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadProjects();
  showNotice("Mileage draft saved.");
}

async function uploadCapture(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const file = data.get("file");
  if (!(file instanceof globalThis.File) || file.size === 0)
    return showNotice("Choose a receipt or bill file.", true);
  if (file.size > 10 * 1024 * 1024)
    return showNotice("Capture files must be 10 MB or smaller.", true);
  const query = new URLSearchParams({ kind: String(data.get("kind")) });
  if (data.get("projectId")) query.set("projectId", String(data.get("projectId")));
  const response = await api(`/v1/capture-reviews/upload?${query.toString()}`, {
    method: "POST",
    headers: { "content-type": file.type, "x-file-name": file.name },
    body: await file.arrayBuffer()
  });
  if (!response.ok) return showError(response);
  event.target.reset();
  await loadProjects();
  showNotice("File uploaded and held for review.");
}

async function approveTimeEntry(entry) {
  const response = await api(
    `/v1/time-entries/${entry.id}/approve`,
    jsonRequest({ version: entry.version })
  );
  if (!response.ok) return showError(response);
  await loadProjects();
  showNotice("Time entry approved.");
}

async function reviewCapture(capture, status) {
  const response = await api(
    `/v1/capture-reviews/${capture.id}/review`,
    jsonRequest({ status, reviewNotes: capture.reviewNotes ?? null, version: capture.version })
  );
  if (!response.ok) return showError(response);
  await Promise.all([loadProjects(), loadEvidenceInbox()]);
  showNotice("Evidence review updated.");
}
