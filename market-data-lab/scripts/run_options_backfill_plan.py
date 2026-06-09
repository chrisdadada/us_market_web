from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import pandas_market_calendars as mcal

from common import ROOT, data_path, load_env, parse_date


def trading_days(start: date, end: date) -> list[date]:
    schedule = mcal.get_calendar("NYSE").schedule(start_date=start, end_date=end)
    return [day.date() for day in schedule.index]


def day_is_done(day: date, min_rows: int) -> bool:
    out = data_path(
        "raw",
        "polygon_rest",
        "options_aggs_1d",
        f"{day:%Y%m%d}_{day:%Y%m%d}",
        "option_aggs_1d.parquet",
    )
    if not out.exists() or out.stat().st_size == 0:
        return False
    try:
        import pandas as pd

        return len(pd.read_parquet(out, columns=["option_ticker"])) >= min_rows
    except Exception:
        return False


def read_plan(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def run_day(row: dict[str, str], day: date, args: argparse.Namespace) -> int:
    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "download_polygon_options_aggs.py"),
        "--underlyings",
        row["underlyings"],
        "--start",
        day.isoformat(),
        "--end",
        day.isoformat(),
        "--dte",
        row["dte"],
        "--dte-tolerance",
        row["dte_tolerance"],
        "--pause",
        row["pause_seconds"],
        "--rate-limit-sleep",
        str(args.rate_limit_sleep),
        "--max-retries",
        str(args.max_retries),
        "--save-every",
        str(args.save_every),
        "--resume",
        "--overwrite",
    ]
    print(" ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=ROOT).returncode


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description="Run staged Polygon options daily backfill with resume.")
    parser.add_argument("--plan", type=Path, default=ROOT / "config" / "options_backfill_plan.csv")
    parser.add_argument("--phase", default="core_etf")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--max-days", type=int, default=1)
    parser.add_argument("--min-rows-done", type=int, default=1)
    parser.add_argument("--save-every", type=int, default=10)
    parser.add_argument("--rate-limit-sleep", type=float, default=70.0)
    parser.add_argument("--max-retries", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    rows = [row for row in read_plan(args.plan) if row["phase"] == args.phase]
    if not rows:
        raise SystemExit(f"No plan rows found for phase={args.phase}")

    launched = 0
    for row in rows:
        start = parse_date(args.start, parse_date(row["start"]))
        end = parse_date(args.end, parse_date(row["end"]))
        if not start or not end:
            raise SystemExit("Invalid start/end")
        for day in trading_days(start, end):
            if day_is_done(day, args.min_rows_done):
                print(f"done {args.phase} {day}", flush=True)
                continue
            if args.dry_run:
                print(f"would_run {args.phase} {day} {row['underlyings']}", flush=True)
                launched += 1
            else:
                print(f"run {args.phase} {day}", flush=True)
                code = run_day(row, day, args)
                if code != 0:
                    raise SystemExit(code)
                launched += 1
            if launched >= args.max_days:
                print(f"max-days reached: {args.max_days}", flush=True)
                return

    print(f"completed phase={args.phase}; launched={launched}", flush=True)


if __name__ == "__main__":
    main()
