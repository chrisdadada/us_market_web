# 数据库说明

懂币猫当前使用两个 SQLite 数据库，各自边界不同：

1. `/var/lib/ytd-gainers/app.db`
   - 运行态数据库，由 `server/auth_api.py` 使用。
   - 存放用户、权限、会话相关账号数据，以及趋势信号事件和当前信号状态。
   - 这类数据不可随意重建，部署静态站点时不应覆盖。

2. `data/product.db`
   - 产品数据仓库，由离线数据脚本生成。
   - 存放市场榜单、板块资金、财经日历、股票事件、财报观察、强弱扫描、市场温度计和期权摘要。
   - 这是可重建数据，默认不提交到 git；本地或服务器执行 `scripts/update_product_data.sh` 会重新生成。

## 为什么先用 SQLite

当前产品是静态前端、Python 小服务和离线数据脚本组合。SQLite 的优势是：

- 单文件，部署和备份简单。
- Python 标准库原生支持，不增加服务依赖。
- 足够支撑当前几千到几十万行级别的产品查询。
- 可以先把数据规范化成表，后续迁移到 Postgres 时 schema 和导入逻辑可以复用。

当出现多任务并发写入、复杂权限查询、实时行情写入或多服务共享数据库时，再迁移到 Postgres。

## 生成方式

```bash
python3 scripts/build_product_db.py
```

指定输出位置：

```bash
PRODUCT_DB=/tmp/product.db python3 scripts/build_product_db.py
```

完整数据更新任务会自动生成 DB：

```bash
bash scripts/update_product_data.sh
```

更新完成后会自动运行覆盖度检查：

```bash
python3 scripts/check_product_coverage.py
```

当前非期权阶段的硬门槛包括股票主表、各涨跌幅/成交额榜单、板块分类缺口、市值缺口和宏观日历。财报日历在真实来源稳定前先作为警告项，接入后再升级为硬门槛；期权流向本阶段只报告，不参与失败判断。

股票库列表页已经改为优先读取 `/api/product/symbols` 的 DB 查询结果，支持查询、板块、市值分层、事件/自选预设和排序参数。顶部全局搜索也优先用同一接口按输入词查询股票。前端只渲染当前表格窗口和当前搜索结果，接口不可用时才回退到旧的本地聚合路径。

人工板块补全已经迁到 `sector_overrides` 表，构建市场榜单和板块资金时都会读取这张表。未来财报日历由下载脚本写入产品 DB，后续也可以接后台人工上传流程。

## 设计原则

- `symbols` 是股票主表，聚合代码、名称、板块、市值、价格、成交额等常用字段。
- 业务表按模块拆分，例如 `market_board_rows`、`sector_flow_rows`、`stock_event_rows`、`calendar_events`。
- 每张业务表都保留 `payload_json`，原始字段不会丢，后续页面新增字段时不用立刻做大迁移。
- `datasets` 和 `raw_payloads` 记录每个数据集的 `asOf`、生成时间、行数和原始 payload，方便排查数据新旧。

## 后续迁移顺序

1. 先让自动化任务稳定生成 `data/product.db`。
2. 增加只读 API，从 DB 查询股票详情、板块排行、财经日历。
3. 前端统一走 API。不要再新增前端直读数据文件的路径。
4. 如果数据量和并发需要，再把 SQLite schema 迁到 Postgres。
