# Architecture Notes

这些是后续脚本的硬约束，尤其是回测和参数扫描。

## Performance Rules

1. 核心回测循环用 NumPy array + Numba。

   - 交易撮合、持仓状态、止损止盈、权益曲线更新，不用 pandas 行遍历。
   - 默认写成 `@numba.njit(cache=True)`。
   - 输入用连续数组，例如 `close`, `high`, `low`, `signal`, `fee_bps`。

2. 参数扫描用多进程。

   - 优先用 `concurrent.futures.ProcessPoolExecutor`。
   - 可选用 `joblib`。
   - 每个任务只传轻量参数；大数据从本地 Parquet/特征缓存读取，避免巨型对象在进程间复制。

3. 指标和高周期特征必须缓存。

   - EMA、RSI、ADX、ATR、Supertrend、VWAP、1h/4h/daily 特征，先写入 Parquet。
   - 参数扫描只读缓存，不重复计算。
   - 特征目录：

     ```text
     DATA_ROOT/features/
       1m/
       5m/
       15m/
       1h/
       1d/
     ```

4. 中间结果不用 CSV。

   - 原始数据、处理数据、特征、权益曲线、交易明细，默认 Parquet。
   - CSV 只用于最终摘要、人类查看、外部系统需要。

5. 数据层优先 Polars。

   - 读写、筛选、分组、拼接、批处理优先用 Polars。
   - 如果某个金融库只支持 pandas，可以在边界转换。
   - 核心交易循环仍然用 NumPy + Numba，不用 Polars/Pandas 在循环里逐行处理。

## Data Quality Rules

数据质量直接决定策略表现。后续所有策略只能读取 `processed/` 或 `features/`，不能直接读取 `raw/`。

1. 原始数据不可改。

   - `raw/` 只保存供应商原始文件或轻量格式转换。
   - 任何清洗、补齐、复权、过滤都写到 `processed/`。
   - 发现问题先记录报告，不覆盖原始文件。

2. 分钟线必须有 session 标记。

   - 至少区分 `premarket`、`rth`、`afterhours`。
   - 小周期策略默认只用 RTH，除非策略明确需要盘前/盘后。
   - RTH 边界固定为 America/New_York 的 `09:30 <= t < 16:00`。

3. 研究用 RTH 分钟线必须日历补齐。

   - Polygon 有成交才有 bar，低流动性标的可能缺分钟。
   - 补齐后，缺失分钟使用前值填 `open/high/low/close`，`volume=0`，`transactions=0`。
   - 增加 `is_synthetic` 标记，真实 bar 为 `False`，补齐 bar 为 `True`。
   - 由 RTH 1m 聚合出的 5m/15m/30m/60m 必须保留 `transactions`、`synthetic_bars`、`bar_count`、`synthetic_rate`。
   - 策略可以用 `synthetic_rate` 过滤低成交质量的 K 线。

4. 质量报告是强制产物。

   每次下载/处理后输出报告，至少包含：

   - 每个 symbol/day 的 RTH bar 数。
   - 缺失分钟数量和比例。
   - 重复 timestamp。
   - OHLC 逻辑错误：`high < low`、`open/high/low/close` 不一致。
   - 价格异常跳变。
   - 成交量异常。
   - 时区和 session 范围。

5. 复权口径必须显式。

   - 日线策略默认使用复权价格。
   - 分钟线执行层默认使用未复权原始价格。
   - 跨拆股长回测需要维护 split factor，并在研究层生成复权分钟线或事件安全切分。

6. 数据源口径要固定。

   - 行情主源：Polygon。
   - 宏观主源：FRED。
   - 基本面/退市/历史成分主源：Sharadar。
   - 不同数据源只在明确字段边界合并，不混用同类字段。

7. 策略回测必须记录数据版本。

   每次 backtest run 保存：

   - 数据源。
   - 下载日期。
   - 数据日期范围。
   - 标的池版本。
   - 特征版本。
   - 质量报告路径。

## Directory Layout

```text
DATA_ROOT/
  raw/
    polygon/
    sharadar/
    fred/
  processed/
    bars/
      1m/
      5m/
      15m/
      30m/
      60m/
      1d/
    bars_rth/
      1m/
  features/
    1m/
    5m/
    15m/
    1h/
    1d/
  backtests/
    runs/
    equity/
    trades/
    summaries/
  reports/
```

## Backtest Skeleton

核心形态：

```python
import numba as nb
import numpy as np


@nb.njit(cache=True)
def run_backtest(close, signal, fee_bps):
    n = close.shape[0]
    equity = np.empty(n, dtype=np.float64)
    position = 0
    cash = 1.0
    shares = 0.0

    for i in range(n):
        price = close[i]
        sig = signal[i]

        if sig == 1 and position == 0:
            shares = cash / price * (1.0 - fee_bps / 10000.0)
            cash = 0.0
            position = 1
        elif sig == -1 and position == 1:
            cash = shares * price * (1.0 - fee_bps / 10000.0)
            shares = 0.0
            position = 0

        equity[i] = cash + shares * price

    return equity
```

这个只是形状示例，真实策略再加入滑点、仓位、风控、交易时段和多标的组合层。
