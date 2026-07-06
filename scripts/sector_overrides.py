from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "product.db"
LEGACY_JSON = ROOT / "data" / "sector-overrides.json"


def product_db_path() -> Path:
    return Path(os.environ.get("PRODUCT_DB") or DEFAULT_DB)


def load_sector_overrides(db_path: Path | None = None) -> dict[str, str]:
    path = db_path or product_db_path()
    if not path.exists():
        return {}
    try:
        with sqlite3.connect(path) as conn:
            rows = conn.execute("SELECT symbol, sector FROM sector_overrides").fetchall()
    except sqlite3.Error:
        return {}
    return {str(symbol).upper(): str(sector) for symbol, sector in rows if symbol and sector}


def load_legacy_sector_overrides(path: Path = LEGACY_JSON) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    sectors = payload.get("sectors")
    if not isinstance(sectors, dict):
        return {}
    return {str(symbol).upper(): str(sector) for symbol, sector in sectors.items() if sector}
