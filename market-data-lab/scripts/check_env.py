import importlib.util
import sys


REQUIRED = ["pandas", "requests", "pyarrow", "boto3", "polars", "numba"]
OPTIONAL = ["duckdb", "pandas_market_calendars", "exchange_calendars", "joblib", "nasdaqdatalink"]


def status(name):
    return "ok" if importlib.util.find_spec(name) else "missing"


print("python", sys.version.split()[0])
for package in REQUIRED:
    print(package, status(package))
for package in OPTIONAL:
    print(package, status(package), "(optional)")

missing = [package for package in REQUIRED if status(package) == "missing"]
if missing:
    raise SystemExit("Missing required packages: " + ", ".join(missing))
