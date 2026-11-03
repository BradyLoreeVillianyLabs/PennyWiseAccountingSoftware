// Searchable pickers that can create a record in place.

import { beginContextualCreation } from "./workspace-calls.js";

const creatablePickerRegistry = new WeakMap();

export function enhanceCreatableSelect(select, configuration = {}) {
  if (!(select instanceof globalThis.HTMLSelectElement)) return;
  let state = creatablePickerRegistry.get(select);
  if (!state) {
    const wrapper = document.createElement("span");
    wrapper.className = "creatable-picker";
    wrapper.dataset.creatableFor = select.name;
    select.parentElement?.insertBefore(wrapper, select);
    wrapper.append(select);
    select.classList.add("creatable-picker-source");
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.role = "combobox";
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-label", configuration.label ?? select.name);
    input.placeholder = configuration.placeholder ?? "Type to search";
    const listbox = document.createElement("div");
    listbox.id = `creatable-list-${Math.random().toString(36).slice(2)}`;
    listbox.className = "creatable-picker-listbox";
    listbox.setAttribute("role", "listbox");
    listbox.hidden = true;
    input.setAttribute("aria-controls", listbox.id);
    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.className = "creatable-picker-create contextual-add-action";
    createButton.textContent = "+";
    createButton.title =
      configuration.createLabel ?? `Create a new ${configuration.label ?? "record"}`;
    createButton.setAttribute("aria-label", createButton.title);
    wrapper.prepend(input);
    wrapper.append(createButton, listbox);
    state = {
      select,
      wrapper,
      input,
      listbox,
      createButton,
      configuration,
      activeIndex: -1,
      timer: null
    };
    creatablePickerRegistry.set(select, state);
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    const refresh = () => renderCreatableSelectOptions(state);
    state.refresh = refresh;
    input.addEventListener("focus", refresh);
    input.addEventListener("input", () => {
      select.value = "";
      select.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
      if (state.timer) globalThis.clearTimeout(state.timer);
      state.timer = globalThis.setTimeout(refresh, 120);
    });
    input.addEventListener("keydown", (event) => handleCreatableSelectKeydown(event, state));
    input.addEventListener("blur", () => {
      globalThis.setTimeout(() => {
        if (!wrapper.contains(document.activeElement)) closeCreatableSelect(state);
      }, 120);
    });
    select.addEventListener("change", () => {
      const selected = select.selectedOptions[0];
      if (selected?.value) input.value = selected.textContent ?? "";
      else if (!input.matches(":focus")) input.value = "";
      configuration.onChange?.(select.value);
    });
    createButton.addEventListener("click", () => {
      const typed = input.value.trim();
      if (!typed && configuration.requireTypedCreate) {
        input.focus();
        return;
      }
      const source = configuration.createButton ?? createButton;
      if (source.dataset) source.dataset.contextualTypedValue = typed;
      closeCreatableSelect(state);
      beginContextualCreation(source);
    });
    const observer = new globalThis.MutationObserver(refresh);
    observer.observe(select, { childList: true });
    state.observer = observer;
  } else if (configuration.createButton) {
    state.configuration = { ...state.configuration, ...configuration };
  }
  state.configuration = { ...state.configuration, ...configuration };
  state.createButton.hidden =
    configuration.canCreate === false || Boolean(configuration.createButton);
  if (configuration.createButton)
    configuration.createButton.hidden = configuration.canCreate === false;
  state.input.disabled = select.disabled;
  state.input.placeholder = configuration.placeholder ?? state.input.placeholder;
  state.input.setAttribute("aria-label", configuration.label ?? select.name);
  if (select.value && !state.input.matches(":focus"))
    state.input.value = select.selectedOptions[0]?.textContent ?? "";
  state.refresh?.();
}

function renderCreatableSelectOptions(state) {
  if (!state?.select?.isConnected) return;
  const query = state.input.value.trim().toLocaleLowerCase();
  const options = [...state.select.options].filter((candidate) => candidate.value);
  const matches = options.filter((candidate) =>
    String(candidate.textContent ?? "")
      .toLocaleLowerCase()
      .includes(query)
  );
  state.listbox.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "creatable-picker-empty";
    empty.textContent = state.configuration.emptyText ?? "No matching records yet.";
    empty.setAttribute("role", "status");
    state.listbox.append(empty);
  }
  matches.forEach((candidate, index) => {
    const optionElement = document.createElement("div");
    optionElement.className = "creatable-picker-option";
    optionElement.textContent = candidate.textContent ?? "";
    optionElement.id = `${state.listbox.id}-option-${index}`;
    optionElement.setAttribute("role", "option");
    optionElement.setAttribute(
      "aria-selected",
      candidate.value === state.select.value ? "true" : "false"
    );
    optionElement.addEventListener("mousedown", (event) => event.preventDefault());
    optionElement.addEventListener("click", () => {
      state.select.value = candidate.value;
      state.select.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
      closeCreatableSelect(state);
      state.input.focus();
    });
    state.listbox.append(optionElement);
  });
  if (
    query &&
    !options.some((candidate) => candidate.textContent?.trim().toLocaleLowerCase() === query)
  ) {
    const create = document.createElement("div");
    create.className = "creatable-picker-option creatable-picker-create-option";
    create.textContent = `+ Create '${state.input.value.trim()}'`;
    create.setAttribute("role", "option");
    create.addEventListener("mousedown", (event) => event.preventDefault());
    create.addEventListener("click", () => state.createButton.click());
    state.listbox.append(create);
  }
  state.activeIndex = -1;
  const isFocused = document.activeElement === state.input;
  state.input.setAttribute("aria-expanded", isFocused ? "true" : "false");
  state.listbox.hidden = !isFocused;
}

function handleCreatableSelectKeydown(event, state) {
  if (event.key === "Escape") {
    closeCreatableSelect(state);
    return;
  }
  const options = [...state.listbox.querySelectorAll('[role="option"]')];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!options.length) return;
    event.preventDefault();
    state.activeIndex =
      (state.activeIndex + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
    options.forEach((item, index) =>
      item.classList.toggle("is-active", index === state.activeIndex)
    );
    state.input.setAttribute("aria-activedescendant", options[state.activeIndex].id);
  } else if (event.key === "Enter" && state.activeIndex >= 0) {
    event.preventDefault();
    options[state.activeIndex].click();
  }
}

function closeCreatableSelect(state) {
  if (!state) return;
  state.listbox.hidden = true;
  state.input.setAttribute("aria-expanded", "false");
  state.input.removeAttribute("aria-activedescendant");
}
