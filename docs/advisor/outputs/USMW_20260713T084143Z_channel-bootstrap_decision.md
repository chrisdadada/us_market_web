# US Market Web Decision

PROJECT_ID: us-market-web
PROJECT_GOAL: 把懂币猫建设成面向中文美股用户、前后台边界清楚、数据有据、权限可靠、可安全持续迭代的投资信息产品。
DECISION_STATUS: ACTIVE
CREATED_AT: 2026-07-13T08:41:43Z

## EVIDENCE

- `package.json` identifies the current project as `us-market-web`.
- `docs/product.md` defines the product as a Chinese-language US-stock information product with separate frontend and admin responsibilities.
- `AGENTS.md` requires evidence-backed data, design approval before UI implementation, dev-first delivery, explicit production authorization, and manual authorization for all `Open 持仓` changes.
- No project-specific complete decision/checks chain existed before this bootstrap artifact.
- The working tree already contains unrelated user changes in `index.html` and `scripts/deploy_prod_data.sh`; this channel must not alter or include them.
- `BRIDGE_ROOT` built successfully with Node `v22.23.1` before advisor execution.

## CURRENT CAPABILITY

- The project has React frontend/admin applications, a Python API, release checks, dev/prod deployment scripts, and durable product/engineering rules.
- The project does not yet have its own isolated GPT strategic review state, deterministic latest-decision selection, or heartbeat-driven GPT/Codex mutual-check loop.

## GOAL GAP

The immediate gap is an isolated, auditable planning and adversarial-review channel that can identify one evidence-backed local step without inheriting another project's goals or crossing production and portfolio boundaries.

## AUTHORIZATION

- Allowed now: local project source/docs, project checks, isolated advisor state, build/test, and dev-safe validation that does not change external state.
- Requires separate user authorization: production release or data deployment, production user/content/permission writes, every `Open 持仓` mutation, external publishing, paid services, trading/broker actions, secrets/permissions, and scope expansion.
- Conservative default: fail closed and stop.

## MCP SOURCES

No MCP business-data source is used by this bootstrap decision.

## ONE_ALLOWED_NEXT_STEP

Build and verify the isolated `us-market-web` advisor channel, run the first read-only GPT review against this complete decision/checks pair, and let Codex independently adjudicate exactly one resulting local step without changing production or `Open 持仓` data.
