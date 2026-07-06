from __future__ import annotations

import os
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "product.db"


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


def load_legacy_sector_overrides(path: Path | None = None) -> dict[str, str]:
    return {}
