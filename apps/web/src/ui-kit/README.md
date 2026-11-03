# UI kit

The shared components for UI v2 landing pages. This file is the props contract that Wave 2 streams
code against, as described in `docs/pennywise/declutter/02_TARGET_UX_SPEC.md` §2–§3. The `shell`
stream owns these files and implements them in U1; every other stream only consumes them. Ask for a
contract change on your GitHub issue.

Today each component is a stub that returns an empty `DocumentFragment`, so calling one is safe but
renders nothing.

## Components

Import each component from its own file, for example
`import { KpiCard } from "../ui-kit/kpi-card.js";`.

| Component        | File                 | Props                                                                |
| ---------------- | -------------------- | -------------------------------------------------------------------- |
| `KpiCard`        | `kpi-card.js`        | `label`, `value`, `comparison?`, `sparkline?`, `onSelect?`           |
| `Pipeline`       | `pipeline.js`        | `steps: [{ key, label, count }]`, `activeKey?`, `onSelect(key)`      |
| `ListInspector`  | `list-inspector.js`  | `list`, `inspector`, `selectedId?`, `emptyMessage?`                  |
| `TaskPanel`      | `task-panel.js`      | `title`, `content`, `open?`, `onClose()`                             |
| `AttentionQueue` | `attention-queue.js` | `items: [{ id, message, actionLabel, onAction() }]`, `emptyMessage?` |
| `EmptyState`     | `empty-state.js`     | `message`, `action?: { label, onAction() }`                          |

The JSDoc in each file is the authoritative description of its props.

## Rules for every component

- **Flag.** Render UI v2 surfaces only when `isUiV2Enabled()` from `src/ui-flags.js` returns true. The
  classic layout must keep working with the flag off.
- **Money.** `value` and every other displayed amount arrive as preformatted strings. Format them
  through `apps/web/money.js`, and never do arithmetic on money with a JavaScript `number`.
- **Existing nodes.** `ListInspector` and `TaskPanel` receive existing DOM nodes and move them. Do not
  recreate them, so element IDs, form names, and event bindings stay intact.
- **Security policy.** Build DOM with `createElement`. Do not use `innerHTML`, inline scripts, or inline
  `style` attributes.
- **Accessibility.** Every component needs keyboard and screen-reader support, and colour must never
  be the only signal.
