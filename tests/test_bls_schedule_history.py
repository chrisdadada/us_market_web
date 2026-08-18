import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_product_data as product_data


class BlsScheduleHistoryTest(unittest.TestCase):
    def test_year_schedule_adds_historical_cpi_and_payroll_releases(self) -> None:
        html = """
        <table class="release-list"><tbody>
          <tr><td class="date-cell"><p>Friday, January 9, 2026</p></td>
              <td class="time-cell"><p>08:30 AM</p></td>
              <td class="desc-cell"><p><strong>Employment Situation</strong> for December 2025</p></td></tr>
          <tr><td class="date-cell"><p>Tuesday, January 13, 2026</p></td>
              <td class="time-cell"><p>08:30 AM</p></td>
              <td class="desc-cell"><p><strong>Consumer Price Index</strong> for December 2025</p></td></tr>
        </tbody></table>
        """
        def fetch(url: str) -> str:
            if url.endswith("bls.ics"):
                raise OSError("calendar feed unavailable")
            return html

        with patch.object(product_data, "fetch_text", side_effect=fetch):
            rows = product_data.build_bls_macro_events(date(2026, 1, 1), date(2026, 1, 31))

        self.assertEqual(
            [(row["date"], row["time"], row["title"]) for row in rows],
            [
                ("2026-01-09", "21:30", "美国非农就业"),
                ("2026-01-13", "21:30", "美国 CPI"),
            ],
        )

    def test_official_cache_is_used_when_bls_blocks_the_request(self) -> None:
        with patch.object(product_data, "fetch_text", side_effect=OSError("blocked")):
            rows = product_data.build_bls_macro_events(date(2026, 1, 1), date(2026, 1, 31))

        self.assertEqual(
            [(row["date"], row["title"]) for row in rows],
            [("2026-01-09", "美国非农就业"), ("2026-01-13", "美国 CPI")],
        )


if __name__ == "__main__":
    unittest.main()
