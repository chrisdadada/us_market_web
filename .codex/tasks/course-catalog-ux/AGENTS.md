# Course Catalog UX Task Rules

## Task Variables

- `TASK_ID=course-catalog-ux`
- `TASK_GOAL=优化懂币猫前台交易实战课程的列表、未授权详情和已授权学习路径，消除重复、含混和低效操作；每个页面先用真实字段出高保真图，经用户确认后再实施。`
- `WORKSPACE_ROOT=/Users/linlifu/Documents/New project`
- `TASK_AGENTS_FILE=/Users/linlifu/Documents/New project/.codex/tasks/course-catalog-ux/AGENTS.md`
- `ADVISOR_WORKSPACE=/Users/linlifu/Documents/New project/.codex/tasks/course-catalog-ux`
- `TASK_OUTPUTS_DIR=/Users/linlifu/Documents/New project/.codex/tasks/course-catalog-ux/outputs`
- `TASK_ARTIFACT_PREFIX=COURSEUX_`
- `TASK_ARTIFACT_GLOB=COURSEUX_[0-9]{8}T[0-9]{6}Z_*_decision.md`
- `BRIDGE_ROOT=/Volumes/SSD 500G/quant_research/devspace_bridge/devspace`
- `STATE_ROOT=/Users/linlifu/.local/share/devspace/advisor-inbox`
- `ADVISOR_COMMAND=advisor:course-catalog-ux`
- `HEARTBEAT_ID=course-catalog-ux-gpt`
- `ENABLE_HEARTBEAT=false`

## Goal Boundary

This task serves only the current thread's course-catalog experience work. It is not a project-wide product goal and cannot inherit another task's state, decisions, parameters, conclusions, artifacts, numbering, or next step.

The current product sequence is design first:

1. Verify the current course list, locked detail, and unlocked learning paths against real local fields.
2. Produce a coherent high-fidelity proposal for user confirmation.
3. Only after confirmation, implement the confirmed frontend changes and verify them locally.

## Source Scope

Codex may read these task sources:

- Current-thread course screenshots explicitly supplied by the user.
- `/Users/linlifu/Documents/New project/AGENTS.md` as read-only project constraints.
- `/Users/linlifu/Documents/New project/docs/product.md` as read-only confirmed product context.
- `/Users/linlifu/Documents/New project/main-web/src/App.tsx`.
- `/Users/linlifu/Documents/New project/main-web/src/styles.css`.
- `/Users/linlifu/Documents/New project/main-web/src/api.ts`.
- The task-local rules, scripts, mockups, and artifacts under this task directory.
- The two reference files listed below, mechanism-only and read-only.

GPT advisor may read only the task directory. Project evidence must first be frozen into task-local decision/checks/guards by Codex.

## Write Scope

Continuously allowed:

- Task-local rules, advisor script, outputs, mockups, screenshots, and checks under this task directory.
- `STATE_ROOT/course-catalog-ux/` through the task advisor only.
- Local builds, tests, static checks, and local screenshot verification that do not change external state.

Conditionally allowed after the user confirms the high-fidelity design:

- `main-web/src/App.tsx`.
- `main-web/src/styles.css`.
- `main-web/src/api.ts` only if the confirmed frontend contract requires a type adjustment supported by the current API.

Read-only unless separately authorized:

- Repository-level `AGENTS.md`.
- Root `package.json`.
- Backend files, databases, production data, production users/content/permissions, and deployment scripts.
- Bridge package files and reference scripts.

## Reference Files

- `/Volumes/SSD 500G/quant_research/devspace_bridge/devspace/scripts/run-pa-advisor.mjs`
- `/Volumes/SSD 500G/quant_research/devspace_bridge/devspace/package.json`

These files explain the mechanism only. They are not task authority and must not be modified by this task.

## Separate Authorization

`SEPARATE_AUTH_SCOPE` includes production or dev deployment, backend/API contract changes, database reads or writes outside temporary tests, production users/content/permissions, every Open portfolio read used for recalculation and every write/migration/recalculation/import/restore/replacement, external publishing, paid services, accounts, secrets, trading, broker actions, messages, and any expansion beyond course-catalog UX.

## Conservative Default

`CONSERVATIVE_DEFAULT=fail closed; keep course source read-only until the high-fidelity design is confirmed; do not deploy; do not touch databases or Open portfolio data.`

Evidence absence, state mismatch, parsing failure, lock conflict, unconfirmed UI, or scope ambiguity must stop execution. Never make a failure green by weakening checks, changing the goal, or borrowing another task's state.
