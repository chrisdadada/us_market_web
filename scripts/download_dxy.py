#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import tempfile
import urllib.request
from datetime import date
from functools import reduce
from pathlib import Path

import pandas as pd


DATA_ROOT = Path(os.environ.get("DATA_ROOT") or os.environ.get("MARKET_DATA_ROOT") or "/Volumes/Extreme SSD/market-data-lab/data")
DXY_COMPONENTS = {
    "DEXUSEU": ("eurusd", -0.576),
    "DEXJPUS": ("usdjpy", 0.136),
    "DEXUSUK": ("gbpusd", -0.119),
    "DEXCAUS": ("usdcad", 0.091),
    "DEXSDUS": ("usdsek", 0.042),
    "DEXSZUS": ("usdchf", 0.036),
}
DXY_SCALE = 50.14348112


def read_csv_source(path: Path | None, url: str | None) -> pd.DataFrame:
    if path:
        return pd.read_csv(path)
    if url:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
        with tempfile.NamedTemporaryFile(suffix=".csv") as tmp:
            tmp.write(data)
            tmp.flush()
            return pd.read_csv(tmp.name)
    raise SystemExit("DXY CSV source missing.")


def read_fred_component(fred_dir: Path, series_id: str, column: str) -> pd.DataFrame:
    path = fred_dir / f"{series_id}.parquet"
    if not path.exists():
        raise SystemExit(f"Missing DXY component: {path}")
    frame = pd.read_parquet(path)
    lowered = {str(col).lower(): col for col in frame.columns}
    date_column = lowered.get("date") or frame.columns[0]
    value_column = lowered.get("value") or lowered.get(series_id.lower())
    if value_column is None:
        raise SystemExit(f"Missing value column in {path}")
    out = frame[[date_column, value_column]].copy()
    out.columns = ["date", column]
    out["date"] = pd.to_datetime(out["date"], errors="coerce").dt.date
    out[column] = pd.to_numeric(out[column], errors="coerce")
    return out.dropna().sort_values("date").drop_duplicates("date", keep="last")


def calculate_from_fred(fred_dir: Path) -> pd.DataFrame:
    frames = [read_fred_component(fred_dir, series_id, column) for series_id, (column, _) in DXY_COMPONENTS.items()]
    merged = reduce(lambda left, right: left.merge(right, on="date", how="inner"), frames)
    if merged.empty:
        raise SystemExit(f"No overlapping DXY component rows found in {fred_dir}")
    value = pd.Series(DXY_SCALE, index=merged.index, dtype="float64")
    for _, (column, exponent) in DXY_COMPONENTS.items():
        value = value * (merged[column] ** exponent)
    return pd.DataFrame({"series_id": "DXY", "date": merged["date"], "value": value.round(4), "source": "dxy_formula_fred"})


def keep_newer_existing(output: Path, candidate: pd.DataFrame) -> pd.DataFrame:
    if not output.exists():
        return candidate
    try:
        existing = pd.read_parquet(output)
    except Exception:
        return candidate
    if existing.empty or "date" not in existing.columns:
        return candidate
    existing = existing.copy()
    existing["date"] = pd.to_datetime(existing["date"], errors="coerce").dt.date
    candidate_latest = candidate["date"].max()
    existing_latest = existing["date"].max()
    if pd.notna(existing_latest) and pd.notna(candidate_latest) and existing_latest > candidate_latest:
        print(f"Keeping newer existing DXY {existing_latest}; calculated source only reaches {candidate_latest}.")
        return existing
    return candidate


def normalize_dxy(frame: pd.DataFrame, start: date | None, end: date | None) -> pd.DataFrame:
    lowered = {str(column).strip().lower(): column for column in frame.columns}
    date_column = lowered.get("date") or lowered.get("timestamp") or lowered.get("time")
    value_column = lowered.get("close") or lowered.get("adj close") or lowered.get("adj_close") or lowered.get("value") or lowered.get("dxy")
    if date_column is None or value_column is None:
        raise SystemExit(f"DXY CSV must contain a date column and close/value column. Columns: {list(frame.columns)}")

    out = frame[[date_column, value_column]].copy()
    out.columns = ["date", "value"]
    out["date"] = pd.to_datetime(out["date"], errors="coerce").dt.date
    out["value"] = pd.to_numeric(out["value"], errors="coerce")
    out = out.dropna().sort_values("date").drop_duplicates("date", keep="last")
    if start:
        out = out[out["date"] >= start]
    if end:
        out = out[out["date"] <= end]
    if out.empty:
        raise SystemExit("DXY CSV produced no usable rows for the requested date range.")
    out.insert(0, "series_id", "DXY")
    return out[["series_id", "date", "value"]]


def parse_day(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Download true DXY history from a configured CSV source.")
    parser.add_argument("--start")
    parser.add_argument("--end")
    parser.add_argument("--output", type=Path, default=DATA_ROOT / "raw" / "dxy" / "DXY.parquet")
    parser.add_argument("--fred-dir", type=Path, default=DATA_ROOT / "raw" / "fred")
    args = parser.parse_args()

    source_path = Path(os.environ["DXY_CSV_PATH"]) if os.environ.get("DXY_CSV_PATH") else None
    source_url = os.environ.get("DXY_CSV_URL")
    if source_path or source_url:
        frame = read_csv_source(source_path, source_url)
        out = normalize_dxy(frame, parse_day(args.start), parse_day(args.end))
    else:
        out = calculate_from_fred(args.fred_dir)
        start = parse_day(args.start)
        end = parse_day(args.end)
        if start:
            out = out[out["date"] >= start]
        if end:
            out = out[out["date"] <= end]
        if out.empty:
            raise SystemExit("DXY calculation produced no usable rows for the requested date range.")
        out = keep_newer_existing(args.output, out)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(args.output, index=False)
    latest = out.iloc[-1]
    print(f"DXY {out['date'].min()}..{latest['date']} rows={len(out)} latest={latest['value']:.2f} output={args.output}")


if __name__ == "__main__":
    main()
