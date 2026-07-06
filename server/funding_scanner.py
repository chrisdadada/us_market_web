from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BINANCE_SPOT = "https://api.binance.com"
BINANCE_FUTURES = "https://fapi.binance.com"
BITGET = "https://api.bitget.com"

SYMBOL_TTL = 300
QUOTE_TTL = 20
REQUEST_TIMEOUT = 12
MAX_WORKERS = 4
ORDERBOOK_LIMIT = 100
MIN_MINUTES_TO_FUNDING = 3
MAX_MINUTES_TO_FUNDING = 90

DEFAULT_PARAMS = {
    "notional_usdt": 1000.0,
    "safety_buffer_usdt": 0.5,
    "binance_spot_fee_bps": 10.0,
    "binance_perp_fee_bps": 4.0,
    "bitget_spot_fee_bps": 10.0,
    "bitget_perp_fee_bps": 6.0,
    "max_basis_bps": 100.0,
    "min_expected_net_usdt": 0.0,
}

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
_last_success: dict[str, Any] | None = None
_last_success_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _get_json(base: str, path: str, params: dict[str, object] | None = None) -> Any:
    url = f"{base}{path}"
    if params:
        url += "?" + urlencode(params)
    last: Exception | None = None
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": "dongbimao-funding-scanner/0.1"})
            with urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                return json.load(response)
        except (HTTPError, URLError, OSError, TimeoutError) as exc:
            last = exc
            if attempt < 2:
                time.sleep(0.35 * (attempt + 1))
    raise RuntimeError(str(last or "request failed"))


def _cached(key: str, ttl: int, loader: Any) -> Any:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = loader()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def _mid(book: dict[str, Any]) -> float:
    if not book.get("bids") or not book.get("asks"):
        raise ValueError("盘口为空")
    return (float(book["bids"][0][0]) + float(book["asks"][0][0])) / 2


def _slip(book: dict[str, Any], side: str, notional: float) -> tuple[float, bool]:
    middle = _mid(book)
    qty_left = notional / middle
    value = 0.0
    filled = 0.0
    levels = book["asks"] if side == "buy" else book["bids"]
    for price_s, qty_s in levels:
        price, qty = float(price_s), float(qty_s)
        take = min(qty_left, qty)
        filled += take
        value += take * price
        qty_left -= take
        if qty_left <= 1e-12:
            break
    if qty_left > 1e-8:
        return 0.0, False
    fair = filled * middle
    cost = value - fair if side == "buy" else fair - value
    return max(cost, 0.0), True


def _binance_pairs() -> list[dict[str, str]]:
    def load() -> list[dict[str, str]]:
        spot = _get_json(BINANCE_SPOT, "/api/v3/exchangeInfo")
        fut = _get_json(BINANCE_FUTURES, "/fapi/v1/exchangeInfo")
        tradfi = {
            item["symbol"]
            for item in fut.get("symbols", [])
            if item.get("contractType") == "TRADIFI_PERPETUAL" and item.get("status") == "TRADING"
        }
        rows = []
        for item in spot.get("symbols", []):
            if item.get("status") != "TRADING" or item.get("quoteAsset") != "USDT":
                continue
            base = item.get("baseAsset", "")
            if not base.endswith("B"):
                continue
            perp = base[:-1] + "USDT"
            if perp in tradfi:
                rows.append({"exchange": "binance", "ticker": base[:-1], "spot_symbol": item["symbol"], "perp_symbol": perp})
        return sorted(rows, key=lambda row: row["ticker"])

    return _cached("pairs:binance", SYMBOL_TTL, load)


def _bitget_pairs() -> list[dict[str, str]]:
    def load() -> list[dict[str, str]]:
        spot = _get_json(BITGET, "/api/v2/spot/public/symbols")
        fut = _get_json(BITGET, "/api/v2/mix/market/contracts", {"productType": "usdt-futures"})
        futures = {item["symbol"] for item in fut.get("data", [])}
        rows = []
        for item in spot.get("data", []):
            if item.get("status") != "online" or item.get("quoteCoin") != "USDT":
                continue
            base = item.get("baseCoin", "")
            if not base.lower().startswith("r"):
                continue
            ticker = base[1:].upper()
            perp = ticker + "USDT"
            if perp in futures:
                rows.append({"exchange": "bitget", "ticker": ticker, "spot_symbol": item["symbol"], "perp_symbol": perp})
        return sorted(rows, key=lambda row: row["ticker"])

    return _cached("pairs:bitget", SYMBOL_TTL, load)


def _funding(pair: dict[str, str]) -> tuple[float, int, int]:
    exchange = pair["exchange"]
    symbol = pair["perp_symbol"]

    def load() -> tuple[float, int, int]:
        if exchange == "binance":
            payload = _get_json(BINANCE_FUTURES, "/fapi/v1/premiumIndex", {"symbol": symbol})
            return float(payload["lastFundingRate"]), int(payload["nextFundingTime"]), int(payload["time"])
        payload = _get_json(BITGET, "/api/v2/mix/market/current-fund-rate", {"symbol": symbol, "productType": "usdt-futures"})
        data = payload.get("data")
        row = data[0] if isinstance(data, list) else data
        if not isinstance(row, dict):
            raise ValueError("资金费返回为空")
        next_update = row.get("nextUpdate") or row.get("nextFundingTime") or row.get("fundingTime")
        request_time = payload.get("requestTime") or row.get("requestTime") or int(time.time() * 1000)
        return float(row["fundingRate"]), int(next_update), int(request_time)

    return _cached(f"funding:{exchange}:{symbol}", QUOTE_TTL, load)


def _orderbooks(pair: dict[str, str]) -> tuple[dict[str, Any], dict[str, Any]]:
    exchange = pair["exchange"]
    spot = pair["spot_symbol"]
    perp = pair["perp_symbol"]

    def load() -> tuple[dict[str, Any], dict[str, Any]]:
        if exchange == "binance":
            spot_book = _get_json(BINANCE_SPOT, "/api/v3/depth", {"symbol": spot, "limit": ORDERBOOK_LIMIT})
            perp_book = _get_json(BINANCE_FUTURES, "/fapi/v1/depth", {"symbol": perp, "limit": ORDERBOOK_LIMIT})
            return spot_book, perp_book
        spot_book = _get_json(BITGET, "/api/v2/spot/market/orderbook", {"symbol": spot, "type": "step0", "limit": ORDERBOOK_LIMIT})
        perp_book = _get_json(BITGET, "/api/v2/mix/market/orderbook", {"symbol": perp, "productType": "usdt-futures", "limit": ORDERBOOK_LIMIT})
        return spot_book["data"], perp_book["data"]

    return _cached(f"book:{exchange}:{spot}:{perp}", QUOTE_TTL, load)


def _pair_fee_bps(pair: dict[str, str], params: dict[str, float]) -> tuple[float, float]:
    if pair["exchange"] == "binance":
        return params["binance_spot_fee_bps"], params["binance_perp_fee_bps"]
    return params["bitget_spot_fee_bps"], params["bitget_perp_fee_bps"]


def _reason_text(reasons: list[str]) -> str:
    labels = {
        "funding": "本期资金费不是正数",
        "net": "扣完成本后不赚钱",
        "basis": "现货和永续差太远",
        "depth": "盘口不够吃",
        "late": "离结算太近",
        "early": "离结算还太远",
        "error": "接口失败",
    }
    return "，".join(labels.get(item, item) for item in reasons) if reasons else "扣完成本仍有收益，价差可接受"


def _scan_one(pair: dict[str, str], params: dict[str, float]) -> dict[str, Any]:
    rate, next_funding, now_ms = _funding(pair)
    notional = params["notional_usdt"]
    spot_fee_bps, perp_fee_bps = _pair_fee_bps(pair, params)
    fee = notional * spot_fee_bps / 10_000 * 2 + notional * perp_fee_bps / 10_000 * 2
    income = notional * rate
    minutes = (next_funding - now_ms) / 60_000
    base_row = {
        **pair,
        "funding_rate": rate,
        "funding_income_usdt": income,
        "fee_usdt": fee,
        "safety_buffer_usdt": params["safety_buffer_usdt"],
        "next_funding_time": datetime.fromtimestamp(next_funding / 1000, timezone.utc).isoformat(timespec="seconds"),
        "minutes_to_funding": minutes,
    }
    if rate <= 0 or minutes < MIN_MINUTES_TO_FUNDING or minutes > MAX_MINUTES_TO_FUNDING:
        reasons = []
        if rate <= 0:
            reasons.append("funding")
        if minutes < MIN_MINUTES_TO_FUNDING:
            reasons.append("late")
        if minutes > MAX_MINUTES_TO_FUNDING:
            reasons.append("early")
        expected = income - fee - params["safety_buffer_usdt"]
        return {
            **base_row,
            "spot_mid": None,
            "perp_mid": None,
            "basis_bps": None,
            "slippage_usdt": None,
            "expected_net_usdt": expected,
            "depth_ok": None,
            "signal": "WAIT",
            "reason": _reason_text(reasons),
        }

    spot_book, perp_book = _orderbooks(pair)
    spot_mid, perp_mid = _mid(spot_book), _mid(perp_book)
    spot_buy, spot_buy_ok = _slip(spot_book, "buy", notional)
    spot_sell, spot_sell_ok = _slip(spot_book, "sell", notional)
    perp_sell, perp_sell_ok = _slip(perp_book, "sell", notional)
    perp_buy, perp_buy_ok = _slip(perp_book, "buy", notional)
    slippage = spot_buy + spot_sell + perp_sell + perp_buy
    basis = (perp_mid / spot_mid - 1) * 10_000
    expected = income - fee - slippage - params["safety_buffer_usdt"]
    depth_ok = spot_buy_ok and spot_sell_ok and perp_sell_ok and perp_buy_ok
    reasons = []
    if expected <= params["min_expected_net_usdt"]:
        reasons.append("net")
    if abs(basis) > params["max_basis_bps"]:
        reasons.append("basis")
    if not depth_ok:
        reasons.append("depth")
    return {
        **base_row,
        "spot_mid": spot_mid,
        "perp_mid": perp_mid,
        "basis_bps": basis,
        "slippage_usdt": slippage,
        "expected_net_usdt": expected,
        "depth_ok": depth_ok,
        "signal": "ENTER" if not reasons else "WAIT",
        "reason": _reason_text(reasons),
    }


def _error_row(pair: dict[str, str], params: dict[str, float], exc: Exception) -> dict[str, Any]:
    return {
        **pair,
        "spot_mid": None,
        "perp_mid": None,
        "basis_bps": None,
        "funding_rate": None,
        "funding_income_usdt": None,
        "fee_usdt": None,
        "slippage_usdt": None,
        "safety_buffer_usdt": params["safety_buffer_usdt"],
        "expected_net_usdt": None,
        "next_funding_time": None,
        "minutes_to_funding": None,
        "depth_ok": False,
        "signal": "WAIT",
        "reason": f"接口失败：{exc}",
    }


def _parse_float(raw: Any, name: str, *, minimum: float = 0.0, maximum: float = 1_000_000.0) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"{name} 参数不正确")
    if value < minimum or value > maximum:
        raise ValueError(f"{name} 参数超出范围")
    return value


def scan(params_in: dict[str, Any] | None = None) -> dict[str, Any]:
    global _last_success
    raw = params_in or {}
    if str(raw.get("cached") or "").lower() in {"1", "true", "yes"}:
        with _last_success_lock:
            if _last_success:
                return {**_last_success, "stale": True}
        return {"updated_at": _now_iso(), "params": dict(DEFAULT_PARAMS), "rows": [], "stale": True, "sort": "funding_rate_desc"}

    params = dict(DEFAULT_PARAMS)
    for key in params:
        if key in raw and raw[key] not in ("", None):
            params[key] = _parse_float(raw[key], key, maximum=1_000_000 if key == "notional_usdt" else 10_000)

    exchange = str(raw.get("exchange") or "all").lower()
    if exchange not in {"all", "binance", "bitget"}:
        raise ValueError("交易所参数不正确")

    try:
        pairs: list[dict[str, str]] = []
        if exchange in {"all", "binance"}:
            pairs += _binance_pairs()
        if exchange in {"all", "bitget"}:
            pairs += _bitget_pairs()

        rows: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            jobs = {pool.submit(_scan_one, pair, params): pair for pair in pairs}
            for job in as_completed(jobs):
                pair = jobs[job]
                try:
                    rows.append(job.result())
                except Exception as exc:
                    rows.append(_error_row(pair, params, exc))

        rows.sort(key=lambda row: row["funding_rate"] if isinstance(row.get("funding_rate"), (int, float)) else -10**18, reverse=True)
        payload = {"updated_at": _now_iso(), "params": params, "rows": rows, "stale": False, "sort": "funding_rate_desc"}
        if rows and any(not str(row.get("reason", "")).startswith("接口失败") for row in rows):
            with _last_success_lock:
                _last_success = payload
        return payload
    except Exception:
        with _last_success_lock:
            if _last_success:
                return {**_last_success, "stale": True}
        raise


def self_test() -> None:
    book = {"bids": [["99", "10"]], "asks": [["101", "10"]]}
    cost, ok = _slip(book, "buy", 100)
    assert ok and round(cost, 8) == 1
    assert _reason_text(["basis"]) == "现货和永续差太远"
    assert _reason_text(["early"]) == "离结算还太远"


if __name__ == "__main__":
    self_test()
    print("self-test ok")
