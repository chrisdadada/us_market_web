# Data Refresh

This project now has one main refresh entrypoint:

```bash
bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

It updates recent Polygon daily stock bars, rebuilds current-year universe and split-adjusted daily files, refreshes FRED and available Polygon fundamentals, rebuilds research features, regenerates front-end JSON, validates JSON, and runs the release gate.

Restricted Benzinga event feeds are requested through a forward-looking window by default so the product can pick up upcoming earnings dates when the account is entitled to that feed. If the feed returns 403, the refresh logs a warning and keeps the rest of the product data pipeline moving.

Future earnings are populated through `scripts/download_earnings_calendar.py`, which merges Nasdaq's public web calendar endpoint plus every configured API provider into `data/manual/earnings-calendar.json`. Optional provider keys are `FMP_API_KEY`, `ALPHA_VANTAGE_API_KEY`/`ALPHAVANTAGE_API_KEY`, and `FINNHUB_API_KEY`. The script logs provider row counts and warns when key watchlist symbols are missing from the forward window. The product builder merges that file with local Polygon/Benzinga snapshots and keeps manual entries separate from macro events.

Sector gaps are supplemented by `data/sector-overrides.json`. Use that file for clear manual classifications, especially ADRs and overseas listings where the upstream ticker metadata is sparse.

## Manual Run

Use one manual command when you want to refresh local data, rebuild `data/product.db`, and deploy it:

```bash
SKIP_IF_SUCCESSFUL_TODAY=0 RUN_OPTIONS_FLOW=0 RUN_MINUTE_BARS=0 RUN_REFERENCE=0 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

The refresh fails closed when `REQUIRE_FRESH_ASOF=1`: if the rebuilt product ASOF is older than the latest expected NYSE trading day, it stops before deploy/promote instead of publishing stale data.

## Logs

Detailed run logs are written to:

```text
/Users/linlifu/Documents/New project/logs/automation/
```

## Useful Overrides

Run a one-off custom range:

```bash
START_DATE=2026-05-13 END_DATE=2026-05-15 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Skip restricted Benzinga feeds that currently return 403:

```bash
RUN_RESTRICTED_EVENTS=0 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Adjust the forward-looking event window:

```bash
EVENTS_FUTURE_DAYS=120 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Add optional API earnings calendar providers:

```bash
FMP_API_KEY=... FINNHUB_API_KEY=... ALPHA_VANTAGE_API_KEY=... bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Process a wider recovery window:

```bash
DAYS_BACK=30 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Run the slower options flow separately:

```bash
RUN_OPTIONS_FLOW=1 OPTIONS_MAX_DAYS=1 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Run the slower minute-bar refresh separately:

```bash
RUN_MINUTE_BARS=1 REQUIRE_FRESH_ASOF=0 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

For catch-up after downtime, run more days manually:

```bash
OPTIONS_MAX_DAYS=5 bash "/Users/linlifu/Documents/New project/scripts/options_refresh.sh"
```

The script uses a lock directory, so overlapping runs exit without starting a second refresh.
