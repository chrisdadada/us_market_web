from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from backtest_market_temperature import (  # noqa: E402
    add_candidate_v2,
    add_forward_metrics,
    build_temperature_history,
)
from build_product_data import latest_benchmark_trends, market_temperature_v2_score  # noqa: E402


class MarketTemperatureBacktestTests(unittest.TestCase):
    def test_latest_benchmark_trends_rejects_mismatched_or_stale_prices(self) -> None:
        dates = pd.date_range(end=pd.Timestamp.now(tz="UTC").tz_localize(None), periods=210, freq="B")
        rows = pd.concat([
            pd.DataFrame({"symbol": symbol, "trade_date": dates, "adj_close": range(100, 310)})
            for symbol in ("SPY", "QQQ")
        ], ignore_index=True)
        with patch("build_product_data.load_daily_prices_range", return_value=rows):
            self.assertTrue(all(value is not None for value in latest_benchmark_trends().values()))

        mismatched = rows[~((rows["symbol"] == "QQQ") & (rows["trade_date"] == dates[-1]))]
        with patch("build_product_data.load_daily_prices_range", return_value=mismatched):
            self.assertTrue(all(value is None for value in latest_benchmark_trends().values()))

        stale = rows.assign(trade_date=rows["trade_date"] - pd.Timedelta(days=10))
        with patch("build_product_data.load_daily_prices_range", return_value=stale):
            self.assertTrue(all(value is None for value in latest_benchmark_trends().values()))

    def test_candidate_v2_shared_score_handles_strong_and_stress_states(self) -> None:
        risks = {
            key: 0
            for key in [
                "VIXCLS", "DGS10", "DGS30", "DGS2", "T10Y2Y", "CPIAUCSL",
                "DTWEXBGS", "DCOILWTICO", "DCOILBRENTEU", "UNRATE", "BAMLH0A0HYM2",
            ]
        }
        trends = {
            "spy_above_50": True,
            "spy_above_200": True,
            "qqq_above_50": True,
            "qqq_above_200": True,
        }
        self.assertEqual(market_temperature_v2_score(risks, trends), (100, "偏强"))

        risks["VIXCLS"] = 3
        trends["spy_above_50"] = False
        score, label = market_temperature_v2_score(risks, trends) or (None, None)
        self.assertLessEqual(score, 49)
        self.assertEqual(label, "防守")

        trends["spy_above_200"] = None
        self.assertIsNone(market_temperature_v2_score(risks, trends))

    def test_history_uses_release_lags_and_current_score_formula(self) -> None:
        frames = {
            "CPIAUCSL": pd.DataFrame({
                "date": pd.date_range("2024-01-01", periods=14, freq="MS"),
                "value": [100 + index for index in range(14)],
            }),
        }
        for series_id in [
            "VIXCLS", "DGS10", "DGS30", "DGS2", "T10Y2Y", "FEDFUNDS",
            "DTWEXBGS", "DCOILWTICO", "DCOILBRENTEU", "UNRATE", "BAMLH0A0HYM2",
        ]:
            frames[series_id] = pd.DataFrame({
                "date": ["2024-01-01", "2024-02-01"],
                "value": [1.0, 1.0],
            })

        with tempfile.TemporaryDirectory() as temp_dir:
            fred_dir = Path(temp_dir)
            for series_id in frames:
                (fred_dir / f"{series_id}.parquet").touch()
            original = pd.read_parquet

            def fake_read(path: Path, **_: object) -> pd.DataFrame:
                return frames[path.stem].copy()

            pd.read_parquet = fake_read
            try:
                prices = pd.DataFrame(
                    {"SPY": [100.0, 101.0], "QQQ": [100.0, 102.0]},
                    index=pd.to_datetime(["2025-02-10", "2025-03-20"]),
                )
                history = build_temperature_history(prices, fred_dir)
            finally:
                pd.read_parquet = original

        self.assertLess(history.loc["2025-02-10", "indicator_count"], 12)
        self.assertEqual(history.loc["2025-03-20", "indicator_count"], 12)
        expected = round(100 - history.loc["2025-03-20", "average_risk"] * 28)
        self.assertEqual(history.loc["2025-03-20", "score"], expected)

    def test_forward_return_and_drawdown_use_future_prices_only(self) -> None:
        dates = pd.date_range("2024-01-01", periods=61, freq="B")
        prices = pd.DataFrame({
            "SPY": range(100, 161),
            "QQQ": [100, 90, *range(92, 151)],
        }, index=dates)
        frame = pd.DataFrame({"score": 70}, index=dates)
        result = add_forward_metrics(frame, prices)
        self.assertAlmostEqual(result.iloc[0]["SPY_5d_return"], 0.05)
        self.assertAlmostEqual(result.iloc[0]["QQQ_5d_drawdown"], -0.10)
        self.assertTrue(pd.isna(result.iloc[-1]["SPY_5d_return"]))

    def test_candidate_v2_waits_for_next_day_before_using_price_break(self) -> None:
        dates = pd.date_range("2024-01-01", periods=222, freq="B")
        rising = list(range(100, 320))
        frame = pd.DataFrame({"SPY": [*rising, 1, 1], "QQQ": [*rising, 1, 1]}, index=dates)
        for column in [
            "VIXCLS", "DGS10", "DGS30", "DGS2", "T10Y2Y", "CPIAUCSL",
            "DTWEXBGS", "DCOILWTICO", "DCOILBRENTEU", "UNRATE", "BAMLH0A0HYM2",
        ]:
            frame[f"risk_{column}"] = 0.0
        frame.loc[dates[-1], "risk_VIXCLS"] = 3.0

        result = add_candidate_v2(frame)

        self.assertEqual(result.loc[dates[-2], "v2_label"], "偏强")
        self.assertEqual(result.loc[dates[-1], "v2_label"], "防守")


if __name__ == "__main__":
    unittest.main()
