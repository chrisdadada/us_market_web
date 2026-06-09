# Data Refresh Automation

This project now has one main refresh entrypoint:

```bash
bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

It updates recent Polygon stock bars, rebuilds current-year universe and split-adjusted daily files, refreshes FRED and available Polygon fundamentals, rebuilds research features, regenerates front-end JSON, validates JSON, and runs the release gate.

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

Process a wider recovery window:

```bash
DAYS_BACK=30 bash "/Users/linlifu/Documents/New project/scripts/automated_refresh.sh"
```

The script uses a lock directory, so overlapping runs exit without starting a second refresh.
