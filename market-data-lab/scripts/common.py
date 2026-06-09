from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"


def load_env() -> Dict[str, str]:
    env_path = ROOT / ".env"
    values: Dict[str, str] = {}
    if env_path.exists():
        for raw_line in env_path.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    os.environ.update({k: v for k, v in values.items() if v})
    global DATA_ROOT
    DATA_ROOT = Path(os.environ.get("DATA_ROOT", ROOT / "data")).expanduser()
    return values


def env(name: str, default: Optional[str] = None, required: bool = False) -> Optional[str]:
    value = os.environ.get(name, default)
    if required and not value:
        raise SystemExit(f"Missing {name}. Copy .env.example to .env and fill it in.")
    return value


def read_symbols(path: Path) -> List[str]:
    symbols: List[str] = []
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        symbols.append(line.split()[0].upper())
    return symbols


def read_series(path: Path) -> List[str]:
    series: List[str] = []
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        series.append(line.split(",", 1)[0].strip().upper())
    return series


def eodhd_symbol(symbol: str) -> str:
    return symbol if "." in symbol else f"{symbol}.US"


def parse_date(value: Optional[str], default: Optional[date] = None) -> Optional[date]:
    if not value:
        return default
    return datetime.strptime(value, "%Y-%m-%d").date()


def unix_seconds(day: date, end_of_day: bool = False) -> int:
    hour, minute, second = (23, 59, 59) if end_of_day else (0, 0, 0)
    dt = datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=timezone.utc)
    return int(dt.timestamp())


def write_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)


def data_path(*parts: str) -> Path:
    return DATA_ROOT.joinpath(*parts)


def read_parquet_dir(path: Path) -> pd.DataFrame:
    files = sorted(path.glob("*.parquet"))
    if not files:
        raise SystemExit(f"No parquet files found in {path}")
    return pd.concat((pd.read_parquet(file) for file in files), ignore_index=True)


def chunk_months(start: date, end: date) -> Iterable[tuple[date, date]]:
    current = date(start.year, start.month, 1)
    while current <= end:
        if current.month == 12:
            next_month = date(current.year + 1, 1, 1)
        else:
            next_month = date(current.year, current.month + 1, 1)
        chunk_start = max(start, current)
        chunk_end = min(end, next_month - timedelta(days=1))
        yield chunk_start, chunk_end
        current = next_month
