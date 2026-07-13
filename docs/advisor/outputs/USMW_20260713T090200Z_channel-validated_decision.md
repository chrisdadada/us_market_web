# US Market Web Decision

PROJECT_ID: us-market-web
PROJECT_GOAL: 把懂币猫建设成面向中文美股用户、前后台边界清楚、数据有据、权限可靠、可安全持续迭代的投资信息产品。
DECISION_STATUS: PASS
CREATED_AT: 2026-07-13T09:02:00Z

## EVIDENCE

- `BRIDGE_ROOT` built successfully with Node `v22.23.1` before advisor execution.
- The initial contract failure remains frozen in `USMW_20260713T085115Z_advisor-contract-failure_decision.md` and its archive-only failure record; it was not rewritten or deleted.
- GPT successfully reviewed the complete failure decision through Codex SDK `read_only` mode and produced all six required sections.
- Review archive `/Users/linlifu/.local/share/devspace/advisor-inbox/us-market-web/archive/2026-07-13T08-56-38.521Z_1db060c0-a019-4374-825e-836334a74985.json` is byte-identical to `latest.json`.
- `latest.json`, `state.json`, the authoritative decision filename, decision SHA-256, and checks SHA-256 matched after publication; `advisor.lock` was removed.
- The response contract now requires exactly six sections in fixed order and the exact reviewed filename as the first evidence item. Its self-test passed five checks.
- A second normal run returned `unchanged` without invoking GPT.
- A forced run with an existing lock failed closed with non-zero status and left `latest.json/state.json` unchanged.
- AppleDouble and temporary decision-like files did not affect latest-decision selection.
- A bounded sensitive-pattern scan found no API key, password, email address, user record, or `open_portfolio_trades` reference in the successful review archive.

## GPT CONTRIBUTION

- Confirmed that end-to-end channel acceptance was the immediate bottleneck.
- Identified the original validator's weak checks for section order/count and first-evidence position.
- Identified that read-only prevents writes but does not itself prevent reading sensitive workspace files.

## CODEX ADJUDICATION

- CONFIRMED: complete channel acceptance was the shortest substantive step before business work.
- CORRECTED: tightened the response contract and added deterministic self-tests without relaxing any failure rule.
- CORRECTED: preserved future invalid GPT responses in archive-only failure records.
- REJECTED: did not treat GPT advice as authorization and did not enter production, Open portfolio, external publishing, or paid-service scope.

## CURRENT CAPABILITY

The project now has an isolated, deterministic and fail-closed GPT strategic advisor channel with read-only execution, complete decision/check selection, archive/latest/state ordering, hashes, unchanged no-op, force support, lock exclusion, invalid-response preservation, and adversarial Codex verification.

## GOAL GAP

The channel is ready, but it has not yet selected and executed the first evidence-backed product or engineering step toward the project goal.

## AUTHORIZATION

- Allowed: one bounded local project step selected from current evidence, including code/docs/tests and dev-safe validation.
- Separate authorization remains mandatory for production, production data/users/content/permissions, every `Open 持仓` mutation, external publishing, paid services, trading/broker actions, secrets/permissions, and scope expansion.
- Conservative default: fail closed and stop.

## MCP SOURCES

No MCP business-data source was used in this channel-validation round.

## ONE_ALLOWED_NEXT_STEP

Run the validated read-only advisor against this PASS decision to identify the single highest-leverage current product or engineering bottleneck, then let Codex independently confirm, correct, or reject and execute at most one locally authorized step with its required checks.
