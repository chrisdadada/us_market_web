# Market Data Lab

最终数据栈：

- Polygon Flat Files：美股全市场 1min OHLCV，后续自己聚合 5m/15m/30m/60m。
- Sharadar / Nasdaq Data Link：基本面、日线、公司行为、退市覆盖、历史成分。
- FRED：宏观、利率、通胀、信用利差、VIX。

数据写入外接 SSD：

```text
/Volumes/Extreme SSD/market-data-lab/data
```

代码保留在当前项目目录。

## 1. 购买和注册

Polygon：

- 注册：https://polygon.io/
- 购买 Stocks 方案，并确认包含 Flat Files。
- 如果只要最近 10 年，Stocks Developer 通常够用。
- 如果想彻底没有历史上限，选 Stocks Advanced 或更高。
- 在 Dashboard 找：
  - API Key
  - Flat Files S3 Access Key
  - Flat Files S3 Secret Key

Sharadar / Nasdaq Data Link：

- 入口：https://data.nasdaq.com/
- 找 Sharadar Core US Equities / Sharadar Fundamentals / Sharadar Equity Prices。
- 需要 Nasdaq Data Link API Key。

FRED：

- 入口：https://fred.stlouisfed.org/docs/api/fred/v2/api_key.html
- 免费申请 API Key。

## 2. 填 Key

编辑 `.env`：

```text
POLYGON_API_KEY=
POLYGON_S3_ACCESS_KEY=
POLYGON_S3_SECRET_KEY=
NASDAQ_DATA_LINK_API_KEY=
FRED_API_KEY=
DATA_ROOT=/Volumes/Extreme SSD/market-data-lab/data
```

## 3. 安装最终依赖

```bash
cd "/Users/linlifu/Documents/New project/market-data-lab"
make install-data-deps
make check-env
```

后续回测脚本的性能规范写在：

```text
ARCHITECTURE.md
```

核心原则：Polars/Parquet 做数据层，NumPy + Numba 做核心交易循环，多进程做参数扫描，指标特征先缓存。

数据质量规范也写在同一个文件里。后续策略只能读取 `processed/` 或 `features/`，不能直接读 `raw/`。

质量报告会输出两类文件：

```text
DATA_ROOT/reports/quality_1m.md
DATA_ROOT/reports/quality_anomalies_1m.parquet
```

其中 Markdown 是摘要，Parquet 是异常明细，后续可以继续用程序复核。

## 4. 先做 Polygon 小样本冒烟测试

默认 `.env` 只设置了 2024-01-02 到 2024-01-05，先确认链路、权限和字段。

```bash
make polygon-smoke
```

它会做四件事：

```text
Polygon Flat Files 下载 -> 转 Parquet -> 聚合 5m/15m/30m/60m -> 生成质量报告
```

输出目录：

```text
/Volumes/Extreme SSD/market-data-lab/data/raw/polygon/
/Volumes/Extreme SSD/market-data-lab/data/processed/bars/
/Volumes/Extreme SSD/market-data-lab/data/reports/
```

## 5. 下载 Sharadar

先测试轻量表：

```bash
/opt/anaconda3/bin/conda run -n quant python scripts/download_sharadar.py --tables TICKERS,ACTIONS,SP500
```

再测试单个 ticker 的基本面：

```bash
/opt/anaconda3/bin/conda run -n quant python scripts/download_sharadar.py --tables SF1 --ticker AAPL
```

确认权限后，再下载大表。

## 6. 下载 FRED 宏观

```bash
make macro
```

宏观序列配置在：

```text
config/fred_series.txt
```

## 7. 扩大历史范围

冒烟测试通过后，再把 `.env` 改成：

```text
INTRADAY_START=2018-01-01
INTRADAY_END=
```

然后按年份或月份批量下载。不要一次性全打满，先按月/季确认速度和空间。

## 8. 数据原则

- 永远存 Polygon 原始 Flat File `.csv.gz`。
- 研究用 Parquet。
- 1min 是唯一分钟原始层。
- 5m/15m/30m/60m 全部从 1min 聚合。
- 日线和基本面以 Sharadar 为准。
- 宏观以 FRED 为准。
