# US Market Web Decision

PROJECT_ID: us-market-web
PROJECT_GOAL: 把懂币猫建设成面向中文美股用户、前后台边界清楚、数据有据、权限可靠、可安全持续迭代的投资信息产品。
DECISION_STATUS: PASS
CREATED_AT: 2026-07-13T09:17:22Z

## EVIDENCE

- GPT reviewed `USMW_20260713T090200Z_channel-validated_decision.md` through the isolated read-only advisor channel.
- `GET /api/product/opinions` returned complete `body` content to anonymous callers, while the frontend only covered that content visually.
- The existing release-gate test explicitly asserted that anonymous callers received the complete published body and uploaded image markdown.
- The server already has one authoritative entitlement calculation: active monthly, active yearly, admin, and super-admin accounts have paid access; free and expired accounts do not.
- The implemented response contract preserves public metadata and `summary`, while replacing `body` with an empty string and `highlights` with an empty list for callers without current paid access.
- Active monthly, active yearly, admin, and super-admin callers continue receiving complete content.
- No database schema, stored opinion record, production environment, production data, course authorization, or Open portfolio table was modified.

## GPT CONTRIBUTION

- Identified the missing server-side opinion-content boundary as the highest-leverage current gap to reliable permissions.
- Distinguished real access control from frontend masking and proposed a bounded opinion-endpoint fix rather than global middleware.
- Required Codex to verify entitlement mapping, preview semantics, frontend leakage, and route scope independently.

## CODEX ADJUDICATION

- CONFIRMED: anonymous requests received complete opinion bodies and frontend masking was not a security boundary.
- CONFIRMED: the existing `summary` field is the supported public preview and the existing entitlement helper is the authoritative membership rule.
- CORRECTED: gated `highlights` together with `body` because both can contain paid article content.
- REJECTED: did not introduce a new permission system, change other product endpoints, deploy, or touch any production/Open portfolio state.

## CURRENT CAPABILITY

The opinion API now enforces paid-content access at the server response boundary. Anonymous, free, and expired accounts receive the public preview only; active monthly, active yearly, and administrator accounts receive the complete published article.

## GOAL GAP

This closes one verified content leak. Other frontend and backend permission surfaces still require evidence-based review before the project can claim globally reliable access control.

## AUTHORIZATION

- Allowed: local source, tests, decision/check artifacts, advisor state, and dev-safe validation.
- Separate authorization remains mandatory for production, production data/users/content/permissions, every Open portfolio mutation, external publishing, paid services, trading/broker actions, secrets/permissions, and scope expansion.
- Conservative default: fail closed and stop.

## MCP SOURCES

No MCP business-data source was used. Evidence came from the local project source, temporary test databases, release-gate tests, and the isolated read-only advisor archive.

## ONE_ALLOWED_NEXT_STEP

Run the read-only advisor against this PASS decision, verify that latest/state/archive reference this exact artifact and hashes, then let Codex independently select at most one next local permission surface or product bottleneck without entering any separately authorized scope.
