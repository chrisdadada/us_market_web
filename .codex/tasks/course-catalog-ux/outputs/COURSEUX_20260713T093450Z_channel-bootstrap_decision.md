# Course Catalog UX Decision

TASK_ID: course-catalog-ux
TASK_GOAL: 优化懂币猫前台交易实战课程的列表、未授权详情和已授权学习路径，消除重复、含混和低效操作；每个页面先用真实字段出高保真图，经用户确认后再实施。
DECISION_STATUS: ACTIVE
CREATED_AT: 2026-07-13T09:34:50Z
GUARDS_REQUIRED: true

## EVIDENCE

- Current-thread screenshot `codex-clipboard-d0f583ab-34b7-4506-96d5-cfff1202c9aa.png` shows the current course catalog with real course covers, titles, summaries, lesson counts, progress states, prices, original price, and discount text.
- Current `CoursesPage` derives `unlockedSeries` and `lockedSeries` from the same API result and displays only one set at a time through `我的课程` and `更多课程`; the two lists no longer duplicate the same course.
- The catalog card currently combines cover, title, truncated summary, lesson/progress metadata, price or grant status, and a whole-card detail action.
- The current task history explicitly requires less bold body text, clearer price expression, a restrained lock/permission treatment, coherent list/detail/learning pages, and high-fidelity review before implementation.
- Project product rules keep `交易实战课程` out of the confirmed primary navigation and require real DB/API-backed fields, minimal explanatory copy, and user approval of high-fidelity screens before code changes.
- Repository-level rules and root package configuration are read-only for this task.

## GOAL GAP

- Confirmed: list ownership is already separated into unlocked and locked sets.
- Confirmed: the API supplies enough fields for the current card and detail structures without invented data.
- Missing: one approved, coherent high-fidelity system covering catalog, locked detail, and unlocked learning states.
- Missing: a settled visual hierarchy for price, course status, access state, and the next action.
- Forbidden now: frontend implementation, deployment, backend changes, database changes, and Open portfolio work.

## CODEX CHECK

- CONFIRMED from local source: `我的课程` and `更多课程` are mutually exclusive filtered sets, so the old duplication concern is resolved in code.
- CONFIRMED from the supplied screenshot: card bottoms have inconsistent visual weight because price, status, discount, and action occupy different patterns.
- CONFIRMED from project rules: design must precede implementation and must use existing fields only.
- REJECTED: no project-wide redesign, navigation change, payment work, backend work, or permission-model rewrite belongs to this task.

## CURRENT BOTTLENECK

The task lacks a single approved course experience model that consistently answers ownership, price, access, status, and next action across the three course page states.

## ONE_ALLOWED_NEXT_STEP

Use the read-only GPT advisor to compare at least two evidence-backed course experience routes and recommend one bounded high-fidelity design step. Codex must independently verify it against the current screenshot, source fields, and task rules before creating any mockup. Do not modify product code.
