# Course Catalog UX Decision

TASK_ID: course-catalog-ux
TASK_GOAL: 优化懂币猫前台交易实战课程的列表、未授权详情和已授权学习路径，消除重复、含混和低效操作；每个页面先用真实字段出高保真图，经用户确认后再实施。
DECISION_STATUS: PASS
CREATED_AT: 2026-07-13T11:47:42Z
GUARDS_REQUIRED: true

## EVIDENCE

- User asked to push the GPT + Codex channel until the two roles are genuinely complementary.
- `gpt_product_plan` and `gpt_product_review` were attempted for this turn, but the plugin reported `OPENAI_API_KEY is not configured`; these failures are recorded and did not grant authority.
- The local isolated advisor channel remains available and authoritative for task-local review state only.
- Current frozen state says the course UX task must cover course catalog, locked detail, and unlocked learning path before any implementation.
- Current field boundary remains unchanged: course update status, price fields, access state, optional grant expiry, lesson count, and lesson rows exist; personal learning progress, current lesson persistence, and payment flow do not exist.
- Codex inspected the high-fidelity mockups with browser screenshots and found a real mobile issue: the catalog cover crop exposed source-card body text. Codex corrected the task-local mockup crop and regenerated the mobile catalog screenshot.
- Current screenshots:
  - `mockups/course-catalog-desktop.png`
  - `mockups/course-detail-desktop.png`
  - `mockups/course-learning-desktop.png`
  - `mockups/course-catalog-mobile.png`
  - `mockups/course-detail-mobile.png`
  - `mockups/course-learning-mobile.png`

## GOAL GAP

- Completed: the task now has a visible collaboration loop: GPT/advisor proposes product path, Codex verifies against local fields and screenshots, Codex corrects visual defects, and this decision freezes the outcome.
- Completed: high-fidelity proposal files exist for the three required page states and representative mobile states.
- Missing: user has not yet confirmed the high-fidelity proposal, so product source implementation remains blocked.
- Missing: because the direct GPT plugin tool is not configured, future turns should either use the already working local advisor channel or configure the plugin key outside this task.
- Forbidden: no production or dev deployment, no backend/API/database changes, no Open portfolio access, and no product source changes before user confirmation.

## CODEX CHECK

- CONFIRMED GPT/advisor direction: three-page path must be reviewed together because catalog, locked detail, and unlocked learning can otherwise drift into duplicated or contradictory states.
- CONFIRMED local evidence: `我的课程` and `更多课程` must stay mutually exclusive; no fake "全部课程都买了" duplication should be introduced.
- CORRECTED implementation evidence: the first mobile catalog crop was not acceptable because it showed source-card body text inside the cover; Codex changed the mobile cover scale from `.33` to `.64`.
- CORRECTED process evidence: direct `gpt_product_plan` and `gpt_product_review` cannot currently run because the plugin API key is missing; this is not treated as a green GPT contribution.
- REJECTED scope expansion: payment, membership upsell, progress percentage, continue-learning state, backend changes, and deployment remain out of scope.

## CURRENT BOTTLENECK

The only material bottleneck is user confirmation of the high-fidelity course-page proposal. Until the user confirms the visual direction, Codex must not implement `main-web` changes.

## ONE_ALLOWED_NEXT_STEP

Run the isolated local advisor against this decision, verify latest/state/archive consistency, then present the high-fidelity screenshots to the user with Codex's accept/reject notes. If the user confirms the design, the next step may enter product code; otherwise iterate only in task-local mockups.
