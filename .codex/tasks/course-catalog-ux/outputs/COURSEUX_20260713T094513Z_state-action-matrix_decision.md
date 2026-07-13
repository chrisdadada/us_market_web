# Course Catalog UX Decision

TASK_ID: course-catalog-ux
TASK_GOAL: 优化懂币猫前台交易实战课程的列表、未授权详情和已授权学习路径，消除重复、含混和低效操作；每个页面先用真实字段出高保真图，经用户确认后再实施。
DECISION_STATUS: PASS
CREATED_AT: 2026-07-13T09:45:13Z
GUARDS_REQUIRED: true

## EVIDENCE

- GPT reviewed `COURSEUX_20260713T093450Z_channel-bootstrap_decision.md` in the isolated read-only task workspace and selected a three-page state/action matrix as the single next step.
- `CourseSeries` exposes course-level content status, price fields, access state, optional grant expiry, lesson count, and lesson rows.
- No current frontend field records per-user lesson completion, current lesson persistence, or learning percentage.
- Current code already filters `我的课程` and `更多课程` into mutually exclusive unlocked and locked collections.
- Current helpers show `progressStatus` as `更新中/已完结`, proving it is course publishing progress rather than user learning progress.

## GOAL GAP

- Completed: one evidence-backed state and action model now covers catalog, locked detail, unlocked learning, price combinations, view switching, and common feedback states.
- Unconfirmed: the final high-fidelity visual hierarchy, exact spacing, lock treatment, responsive behavior, and all three screens together.
- Missing evidence: persisted user learning progress and a confirmed payment flow do not exist in the authorized frontend contract.
- Forbidden: product code changes before design confirmation, backend/API/database changes, deployment, and Open portfolio work.

## CODEX CHECK

- CONFIRMED GPT: a shared state model is required before drawing three separate pages.
- CORRECTED GPT: `progressStatus` is course update status, not user learning progress; the matrix removes unsubstantiated `未开始/学习中/已完成` states.
- CORRECTED GPT: `unlocked` proves access only; it does not prove membership, payment, or purchase semantics.
- CONFIRMED local source: locked and unlocked lists are already mutually exclusive.
- REJECTED scope expansion: no navigation, payment, backend, database, deployment, or project-wide redesign was added.

## CURRENT BOTTLENECK

The state semantics are now bounded, but the task still lacks one complete high-fidelity proposal showing the catalog, locked detail, and unlocked learning pages with the same hierarchy and real field constraints.

## ONE_ALLOWED_NEXT_STEP

Create a task-local high-fidelity visual proposal for all three page states from this matrix, including desktop and one representative mobile layout, without modifying product source. The user must confirm the proposal before implementation.
