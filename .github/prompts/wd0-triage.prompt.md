---
description: "WD0 — Triage a PennyWise workflow symptom into a proven root cause and a fix prompt"
agent: agent
---

The owner authorizes WD0 by running this prompt.

Symptom: ${input:symptom:What happened, when (local time), which build, which workflow}

Follow [WD0](../../docs/tasks/workflow-debugging/WD0-triage-a-workflow-symptom.md) exactly. Also follow
[AGENTS.md](../../AGENTS.md) and the shared rules in
[the workflow-debugging README](../../docs/tasks/workflow-debugging/README.md). WD0 diagnoses only, so
stop after the triage report.
