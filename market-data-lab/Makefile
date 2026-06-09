CONDA ?= /opt/anaconda3/bin/conda
ENV ?= quant
PY := $(CONDA) run -n $(ENV) python

.PHONY: install-data-deps check-env polygon-download polygon-convert polygon-smoke build-rth aggregate quality sharadar macro

install-data-deps:
	$(CONDA) install -n $(ENV) -y -c conda-forge boto3 duckdb pandas-market-calendars polars numba joblib

check-env:
	$(PY) scripts/check_env.py

polygon-download:
	$(PY) scripts/download_polygon_flatfiles.py download --start $${INTRADAY_START:-2024-01-02} --end $${INTRADAY_END:-2024-01-05} --workers $${POLYGON_DOWNLOAD_WORKERS:-4}

polygon-convert:
	$(PY) scripts/download_polygon_flatfiles.py convert --symbols config/symbols_core.txt --start $${INTRADAY_START:-2024-01-02} --end $${INTRADAY_END:-2024-01-05}

polygon-smoke: polygon-download polygon-convert build-rth aggregate quality

build-rth:
	$(PY) scripts/build_rth_bars.py

aggregate:
	$(PY) scripts/aggregate_bars.py --timeframes 5m 15m 30m 60m

quality:
	$(PY) scripts/quality_report.py --input "$${DATA_ROOT:-/Volumes/Extreme SSD/market-data-lab/data}/processed/bars_rth/1m" --timeframe 1m

sharadar:
	$(PY) scripts/download_sharadar.py --tables $${SHARADAR_TABLES:-TICKERS,ACTIONS,SP500,SF1}

macro:
	$(PY) scripts/download_fred.py --series config/fred_series.txt
