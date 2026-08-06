from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import auth_api  # noqa: E402


class CalendarResultCopyTest(unittest.TestCase):
    def test_cpi_below_forecast_is_plain_language_positive(self) -> None:
        result = auth_api.macro_result_interpretation("美国 CPI", 3.5, 3.8, 4.2)
        self.assertEqual(result["resultHeadline"], "低于预期")
        self.assertEqual(result["resultMeaning"], "通胀更低，美股短线通常偏利好")
        self.assertEqual(result["resultTone"], "positive")

    def test_rate_hike_explains_borrowing_cost(self) -> None:
        result = auth_api.macro_result_interpretation("FOMC 议息会议", 4.0, 4.0, 3.75)
        self.assertEqual(result["resultHeadline"], "加息 0.25%")
        self.assertEqual(result["resultMeaning"], "借钱更贵，美股短线通常偏利空")

    def test_unchanged_rate_does_not_claim_consensus_without_forecast(self) -> None:
        result = auth_api.macro_result_interpretation("FOMC 议息会议", 3.75, None, 3.75)
        self.assertEqual(result["resultHeadline"], "利率不变")
        self.assertEqual(result["resultMeaning"], "借钱成本没有变化，美股影响偏中性")

    def test_jobs_below_forecast_explains_rate_expectation(self) -> None:
        result = auth_api.macro_result_interpretation("美国非农就业", 57, 110, 129)
        self.assertEqual(result["resultHeadline"], "低于预期")
        self.assertEqual(result["resultMeaning"], "就业降温，降息预期可能升温")
        self.assertEqual(result["resultTone"], "watch")

    def test_cpi_without_consensus_has_no_result_claim(self) -> None:
        self.assertEqual(auth_api.macro_result_interpretation("美国 CPI", 3.5, None, 4.2), {})


if __name__ == "__main__":
    unittest.main()
