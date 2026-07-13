# US Market Web Decision

PROJECT_ID: us-market-web
PROJECT_GOAL: 把懂币猫建设成面向中文美股用户、前后台边界清楚、数据有据、权限可靠、可安全持续迭代的投资信息产品。
DECISION_STATUS: FAILURE
CREATED_AT: 2026-07-13T08:51:15Z

## EVIDENCE

- The first formal advisor run reviewed `USMW_20260713T084143Z_channel-bootstrap_decision.md` but failed the output contract because its response did not name that complete filename.
- The failure is frozen at `/Users/linlifu/.local/share/devspace/advisor-inbox/us-market-web/archive/2026-07-13T08-49-36.177Z_2ed536a1-e417-4b9c-8f82-9d1ac6923b1d_failure.json` with SHA-256 `a3960fe82936c0ad4518635789a623bcd026b8dc14f0298087b4cf9465baf284`.
- `latest.json` and `state.json` were not created, so the failed review did not become authoritative state.
- `advisor.lock` was removed after failure.
- The response validator correctly remained fail closed; relaxing it would violate the required `REVIEWED EVIDENCE` contract.
- The failure archive did not preserve the invalid GPT response, so the exact omission cannot be independently reconstructed from the archive.

## CURRENT CAPABILITY

- Deterministic decision/check selection, dry-run, lock cleanup, hash calculation, and rejection of an invalid GPT response are runnable.
- Successful archive/latest/state publication has not yet been demonstrated.

## GOAL GAP

The channel still needs one auditable successful review while preserving this failure and retaining future invalid model responses for diagnosis.

## AUTHORIZATION

- Allowed now: repair failure evidence capture and make the output instruction explicit without weakening the validator.
- Not allowed: delete or rewrite the frozen failure, loosen the exact-filename rule, modify production, or touch `Open 持仓` data.

## MCP SOURCES

No MCP business-data source was used.

## ONE_ALLOWED_NEXT_STEP

Preserve future invalid GPT responses in archive-only failure records, explicitly require the exact filename in `REVIEWED EVIDENCE`, keep the existing validator unchanged, and run the advisor against this new FAILURE decision; stop if any contract condition fails again.
