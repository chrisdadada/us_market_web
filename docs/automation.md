# Data Refresh

This project has one dedicated data-refresh worktree and one main refresh
entrypoint. Do not run refresh jobs from the feature-development workspace.

```bash
export AUTOMATION_ROOT="/Users/linlifu/Documents/New project-automation-refresh"
bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

The worktree must be clean and checked out on `codex/automation-refresh`.
It must also contain the current `codex/dev-integration` commit.
`scripts/refresh_workspace_guard.sh` stops the run before downloading data otherwise.

It updates recent Polygon daily stock bars, rebuilds current-year universe and split-adjusted daily files, refreshes FRED and available Polygon fundamentals, rebuilds research features, rebuilds the product DB, and runs the release gate.

After DB-first validation, release gate, product DB coverage, and packaging pass,
the automation deploys the rebuilt `data/product.db` to dev. The dev
data step backs up the current DB and preserves dev-side content and Open holding
runtime tables before replacing it.

The coverage gate validates both snapshot dates and the payload fields used by
the product pages. In particular, the bottom-strategy payload must carry complete,
ordered QQQ/SPY daily history through the current dataset date. A missing field,
old automation branch, or mismatched `datasets`/`raw_payloads` payload stops the
run before either environment is changed.

Production data is skipped unless the current run carries explicit Open holding
data approval. This never promotes production site code, admin assets, user data,
or other modules.
Production data deploys must go through `scripts/deploy_prod_data.sh`, which
backs up the current prod DB and preserves prod-side runtime tables such as
content and open-portfolio records.

Restricted Benzinga event feeds are requested through a forward-looking window by default so the product can pick up upcoming earnings dates when the account is entitled to that feed. If the feed returns 403, the refresh logs a warning and keeps the rest of the product data pipeline moving.

Future earnings are populated through `scripts/download_earnings_calendar.py`, which merges Nasdaq's public web calendar endpoint plus every configured API provider into the product DB build input. Optional provider keys are `FMP_API_KEY`, `ALPHA_VANTAGE_API_KEY`/`ALPHAVANTAGE_API_KEY`, and `FINNHUB_API_KEY`. The script logs provider row counts and warns when key watchlist symbols are missing from the forward window. The product builder keeps company earnings separate from macro events.

Sector gaps are supplemented by the `sector_overrides` table in `data/product.db`, especially ADRs and overseas listings where the upstream ticker metadata is sparse.

## Manual Run

Use one manual command when you want to refresh local data, rebuild `data/product.db`, and deploy it to dev:

```bash
SKIP_IF_SUCCESSFUL_TODAY=0 RUN_OPTIONS_FLOW=0 RUN_MINUTE_BARS=0 RUN_REFERENCE=0 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

The refresh fails closed when `REQUIRE_FRESH_ASOF=1`: if the rebuilt product ASOF is older than the latest expected NYSE trading day, it stops before deploy/promote instead of publishing stale data.

To stop before any dev or prod data deploy:

```bash
DEPLOY_AFTER_REFRESH=0 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

To deploy dev but skip the production product DB update:

```bash
DEPLOY_PROD_DATA_AFTER_REFRESH=0 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

## Logs

Detailed run logs are written to:

```text
/Users/linlifu/Documents/New project-automation-refresh/logs/automation/
```

## Useful Overrides

Run a one-off custom range:

```bash
START_DATE=2026-05-13 END_DATE=2026-05-15 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

Skip restricted Benzinga feeds that currently return 403:

```bash
RUN_RESTRICTED_EVENTS=0 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

Adjust the forward-looking event window:

```bash
EVENTS_FUTURE_DAYS=120 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

Add optional API earnings calendar providers:

```bash
FMP_API_KEY=... FINNHUB_API_KEY=... ALPHA_VANTAGE_API_KEY=... bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

Process a wider recovery window:

```bash
DAYS_BACK=30 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

Run the slower options flow separately:

```bash
RUN_OPTIONS_FLOW=1 OPTIONS_MAX_DAYS=1 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

Run the slower minute-bar refresh separately:

```bash
RUN_MINUTE_BARS=1 REQUIRE_FRESH_ASOF=0 bash "${AUTOMATION_ROOT}/scripts/automated_refresh.sh"
```

For catch-up after downtime, run more days manually:

```bash
OPTIONS_MAX_DAYS=5 bash "${AUTOMATION_ROOT}/scripts/options_refresh.sh"
```

The script uses a lock directory, so overlapping runs exit without starting a second refresh.
