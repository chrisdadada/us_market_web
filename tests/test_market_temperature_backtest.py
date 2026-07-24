from pathlib import Path
import sys
import tempfile
import unittest

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from backtest_market_temperature import (  # noqa: E402
    add_forward_metrics,
    build_temperature_history,
)


class MarketTemperatureBacktestTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
