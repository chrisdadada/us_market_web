from __future__ import annotations

from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd
import pandas_market_calendars as mcal
import pyarrow.parquet as pq

from common import data_path, load_env


def parse_day(path: Path):
    return datetime.strptime(path.name.removesuffix(".parquet"), "%Y-%m-%d").date()


def trading_days(start, end) -> set:
    calendar = mcal.get_calendar("NYSE")
    return {pd.Timestamp(day).date() for day in calendar.schedule(start_date=start, end_date=end).index}


def parquet_files(root: Path) -> list[Path]:
    return sorted(path for path in root.glob("*/*/*.parquet") if not path.name.startswith("._"))


def dataset_summary(name: str, root: Path) -> tuple[list[str], set]:
    files = parquet_files(root)
    if not files:
        return [f"- {name}: missing `{root}`"], set()
    dates = {parse_day(path) for path in files}
    rows = 0
    size = 0
    for path in files:
        metadata = pq.ParquetFile(path).metadata
        rows += metadata.num_rows
        size += path.stat().st_size
    start, end = min(dates), max(dates)
    expected = trading_days(start, end)
    missing = sorted(expected - dates)
    extra = sorted(dates - expected)
    month_counts = Counter(f"{day:%Y-%m}" for day in dates)
    lines = [
        f"## {name}",
        "",
        f"- root: `{root}`",
        f"- range: {start}..{end}",
        f"- files: {len(files):,}",
        f"- rows: {rows:,}",
        f"- size_gb: {size / 1024**3:.2f}",
        f"- missing_trading_days: {len(missing):,}",
        f"- non_trading_day_files: {len(extra):,}",
        "",
        "| month | files |",
        "|---|---:|",
    ]
    for month in sorted(month_counts):
        lines.append(f"| {month} | {month_counts[month]} |")
    lines.append("")
    if missing:
        lines.extend(["Missing sample: " + ", ".join(str(day) for day in missing[:20]), ""])
    if extra:
        lines.extend(["Non-trading sample: " + ", ".join(str(day) for day in extra[:20]), ""])
    return lines, dates


def main() -> None:
    load_env()
    datasets = {
        "processed_1m_all_sessions": data_path("processed", "polygon", "stocks", "1m"),
        "processed_1m_rth": data_path("processed", "polygon", "stocks_rth", "1m"),
        "processed_5m_rth": data_path("processed", "polygon", "stocks_rth", "5m"),
        "processed_15m_rth": data_path("processed", "polygon", "stocks_rth", "15m"),
        "processed_60m_rth": data_path("processed", "polygon", "stocks_rth", "60m"),
        "processed_240m_rth": data_path("processed", "polygon", "stocks_rth", "240m"),
    }
    report = ["# Processed Polygon Inventory", ""]
    all_dates = []
    for name, root in datasets.items():
        lines, dates = dataset_summary(name, root)
        report.extend(lines)
        all_dates.extend(dates)

    tmp_files = list(data_path("processed", "polygon").glob("**/*.tmp"))
    report.extend(
        [
            "## Temp Files",
            "",
            f"- tmp_files: {len(tmp_files):,}",
            "",
        ]
    )
    out = data_path("reports", "processed_polygon_inventory.md")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(report))
    print(out)


if __name__ == "__main__":
    main()
