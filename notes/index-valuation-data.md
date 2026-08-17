# 纳指100估值观察数据说明

## 当前结论

当前已接入 QQQ 当前持仓权重、外接盘最新日线价格、分红明细，以及 Nasdaq 100 周频前瞻 PE 历史序列。产品页可展示当前前瞻 PE、近 3/5/10 年历史位置和趋势；PB、ROE、PEG 等其它指标的历史分位仍等待完整同口径财务数据。

## 已检查的数据

- `/Volumes/Extreme SSD/market-data-lab/data/processed/polygon/stocks/1d`
  - 发现 2515 个 parquet 文件，日线覆盖约 `2016-05-11` 至 `2026-05-12`，字段包含 `symbol`、`trade_date`、`open`、`high`、`low`、`close`、`volume`。
- `/Volumes/Extreme SSD/market-data-lab/data/processed/polygon/stocks_split_adjusted/1d`
  - 发现 11 个年度 parquet 文件，包含拆股调整后的 `adj_close` 等字段。
- `/Volumes/Extreme SSD/market-data-lab/data/features/polygon/universe/daily_tradable_universe_by_year`
  - 发现 11 个年度 parquet 文件，包含美股可交易池和基础证券字段；这不是 QQQ/NDX 或 SPY 成分权重。
- `/Volumes/Extreme SSD/market-data-lab/data/raw/polygon_rest/dividends_by_year`
  - 发现 11 个年度 parquet 文件，字段包含 `ticker`、`cash_amount`、`ex_dividend_date`、`frequency`。
- `/Volumes/Extreme SSD/market-data-lab/data/raw/polygon_rest/financials`
  - 发现 5 个 parquet 文件，覆盖 `2016-05`、`2016-06`、`2016-07`、`2026-05` 的部分财报抓取批次。
  - 用 `conda run -n quant python` 可读取最新批次，但它不是覆盖全部成分、可按日期对齐的 TTM 财务面板。
- Invesco QQQ 持仓接口
  - 返回 `effectiveDate`、`totalNumberOfHoldings`、`holdings[].ticker`、`issuerName`、`units`、`percentageOfTotalNetAssets`。
  - 当前快照日期为 `2026-05-16`，可用于当前权重，不可用于历史分位。
- Nasdaq 100 前瞻 PE 历史接口
  - `https://historyofmarket.com/api/ndx/forward-pe.json`
  - 提供周频历史前瞻 PE，以及独立计算的最新前瞻 PE；产品数据保留二者原始边界，只在图表末端追加最新读数。
- `/Volumes/Extreme SSD/market-data-lab/data/raw/polygon_rest/tickers_active.parquet` 和 `tickers_inactive.parquet`
  - 文件存在，schema 包含 `ticker`、`name`、`market`、`primary_exchange`、`type`、`active` 等基础字段。
  - 这些是股票列表，不包含 QQQ/NDX 或 SPY 成分权重。
- 产品 DB
  - 现有产品数据主要是市场温度、宏观序列、强势扫描、财报质量、事件机会等。
  - 未发现可直接作为指数估值计算输入的权重、历史市值、每日 TTM EPS 或指数级估值序列。
- `/Users/linlifu/Documents/美股PA ` 与 `/Users/linlifu/Documents/pcdn_ng/data`
  - 发现较多 SPY/QQQ 价格行为研究产物，但未发现成分权重、TTM 财务面板或估值历史序列。

## 不能直接计算的原因

- QQQ 当前成分和权重已可用；仍缺历史生效日期和历史权重，不能生成趋势和历史分位。
- 成分股最新价格已覆盖当前 QQQ 估值持仓。
- 缺每日或定期可对齐的 TTM EPS、每股净资产、净利润、股东权益等连续财务口径。
- 缺未来盈利增速预期或一致的增长率口径，不能计算 PEG。
- 本地 Polygon financials 是财报事件数据，不是可直接用于每日指数估值的面板数据。

## 后续需补的数据

- QQQ/NDX 或 SPY 当前和历史成分：`date`、`ticker`、`action` 或完整快照。
- 成分权重：`date`、`ticker`、`weight`。
- 成分股日线价格或市值：`date`、`ticker`、`close`、`shares_outstanding` 或 `market_cap`。
- TTM 财务面板：`date`、`ticker`、`ttm_eps`、`book_value_per_share`、`ttm_net_income`、`shareholders_equity`。
- 分红面板：`date`、`ticker`、`ttm_dividend_per_share` 或可按除息日滚动计算的分红明细。
- PEG 所需增长率：`date`、`ticker`、`forward_eps_growth`，并明确使用 1 年、3 年或长期增长口径。

## 可采用计算口径

- PE：按成分权重聚合 `price / ttm_eps`，并对负 EPS 和极端值设置透明过滤规则。
- PB：按成分权重聚合 `price / book_value_per_share`。
- ROE：按权重聚合 `ttm_net_income / shareholders_equity`，或按总净利润除以总权益做指数口径。
- 股息率：按权重聚合 `ttm_dividend_per_share / price`。
- PEG：按同一权重聚合 `PE / forward_eps_growth`，增长率必须使用统一来源和同一周期。
- 历史分位：用同一口径生成的日度或周度历史序列计算，避免把不同来源口径混在一起。
- 当前股息率：按 QQQ 当前权重聚合近 365 天普通现金分红与最新收盘价。

## 前端可用字段

- `status: "partial_data"`：模块已有当前持仓权重和部分当前指标。
- `weightAsOf`、`priceAsOf`：权重日期和价格日期。
- `holdingsCoverage`：当前持仓、价格、股息率和财务覆盖。
- `topHoldings`：按权重排序的前十大持仓。
- `metrics[].status: "computed"`：当前可计算指标；目前仅股息率。
- `metrics[].status: "waiting_for_data"`：仍缺口径的指标，当前包括 PE、PB、ROE、PEG。
- `historyPercentiles.status: "waiting_for_data"`：未生成历史分位。
- `forwardValuation.history`：近 10 年周频前瞻 PE。
- `forwardValuation.ranges`：近 3/5/10 年的 30%线、中位线、70%线、历史位置和最低值距离。
