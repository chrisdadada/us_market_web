# Data Refresh Automation

This project now has one main refresh entrypoint:

```bash
bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

It updates recent Polygon stock bars, rebuilds current-year universe and split-adjusted daily files, refreshes FRED and available Polygon fundamentals, rebuilds research features, regenerates front-end JSON, validates JSON, and runs the release gate.

Restricted Benzinga event feeds are requested through a forward-looking window by default so the product can pick up upcoming earnings dates when the account is entitled to that feed. If the feed returns 403, the refresh logs a warning and keeps the rest of the product data pipeline moving.

Future earnings can also be populated from Financial Modeling Prep. When `FMP_API_KEY` is configured, the automation downloads `/stable/earnings-calendar` into `data/manual/earnings-calendar.json`; when the key is absent, the step is skipped and the rest of the refresh continues. The product builder merges that file with local Polygon/Benzinga snapshots and keeps manual entries separate from macro events.

Sector gaps are supplemented by `data/sector-overrides.json`. Use that file for clear manual classifications, especially ADRs and overseas listings where the upstream ticker metadata is sparse.

## Schedule

Install the local macOS LaunchAgent:

```bash
bash "/Users/linlifu/Documents/New project/scripts/install_refresh_automation.sh"
```

The default schedule is daily at 19:30 local time. That is intentionally after the US market close plus a buffer, and the script looks back 10 calendar days so holidays, weekends, and delayed Polygon flatfiles are picked up later.

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

Enable the optional FMP earnings calendar pull:

```bash
FMP_API_KEY=... bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

Process a wider recovery window:

```bash
DAYS_BACK=30 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

The script uses a lock directory, so overlapping runs exit without starting a second refresh.
