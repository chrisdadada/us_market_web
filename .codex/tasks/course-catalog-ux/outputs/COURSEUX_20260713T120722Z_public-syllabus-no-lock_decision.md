# Course Catalog UX Decision

TASK_ID: course-catalog-ux
TASK_GOAL: 优化懂币猫前台交易实战课程的列表、未授权详情和已授权学习路径，消除重复、含混和低效操作；每个页面先用真实字段出高保真图，经用户确认后再实施。
DECISION_STATUS: PASS
CREATED_AT: 2026-07-13T12:07:22Z
GUARDS_REQUIRED: true

## EVIDENCE

- User rejected the lock treatment as visually poor.
- User clarified the product rule: locked users should be able to see the course directory; only actual videos should be inaccessible.
- The high-fidelity mockup has been updated task-locally only.
- Catalog card access copy changed from a lock icon plus `需开通` to `查看目录`.
- Locked course detail now exposes visible lesson rows and labels playback as available after opening access.
- Course detail layout width was narrowed and the directory moved to a full-width section to prevent clipped text.

## GOAL GAP

- Completed: locked course exploration now follows the confirmed product logic: view course and directory first, open access to play videos.
- Completed: the ugly lock icon has been removed from the high-fidelity proposal.
- Missing: user has not yet confirmed this revised proposal for implementation.
- Forbidden: product source, backend, database, deployment, payment, and Open portfolio work remain untouched.

## CODEX CHECK

- CONFIRMED user correction: a locked course should still show its directory.
- CORRECTED prior mockup: replaced the lock icon and `需开通` with softer `查看目录`.
- CORRECTED prior detail layout: directory should be readable and full-width instead of squeezed into a narrow side panel.
- REJECTED scope expansion: no payment flow, video permission backend, or product-source implementation was added.

## CURRENT BOTTLENECK

The revised no-lock, public-syllabus high-fidelity design needs user confirmation before implementation.

## ONE_ALLOWED_NEXT_STEP

Show the revised catalog and locked-detail screenshots to the user. If confirmed, implement this exact locked-course behavior in the frontend; otherwise continue iterating only in task-local mockups.
