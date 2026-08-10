# 架构与编码标准

更新时间：2026-07-06  
适用范围：懂币猫代码、数据脚本、前台、后台、部署和验证。

本文是工程改动的默认标准。和用户当次明确要求冲突时，先停下确认。

## 1. 当前架构

项目当前由五部分组成：

- `main-web/`：新版前台 React 应用。
- `admin-web/`：新版后台 React 应用。
- `server/auth_api.py`：Python HTTP 服务，负责认证、权限、后台接口、产品只读 API。
- `scripts/`：离线数据下载、清洗、构建、发布脚本。
- `data/product.db` 与运行态 `app.db`：SQLite 数据库。

历史遗留：

- `index.html`、`app.js`、`styles.css`、`admin.html` 仍存在 legacy 页面。
- 新功能优先进入 `main-web/` 或 `admin-web/`。
- legacy 只做兼容或紧急修复，不继续扩大。

## 2. 数据库边界

运行态 DB：

- 默认路径：`/var/lib/ytd-gainers/app.db`
- 由 `server/auth_api.py` 使用。
- 存用户、会话、权限、后台操作记录、用户监控事件。
- 不可随意覆盖、重建、提交到 Git。

产品 DB：

- 默认文件：`data/product.db`
- 由离线脚本生成。
- 存股票、市场、板块、重点财经前瞻、猫言猫语等产品数据。
- 属于可重建数据。

原则：

- 用户、权限、会话写运行态 DB。
- 市场数据、产品查询写产品 DB。
- 前台展示优先走 `/api/product/*`。
- 不新增前端直接读取散落 JSON 的路径。

更详细数据库说明见 `docs/database.md`。

## 3. 前后端边界

前台：

- 面向普通用户。
- 不展示后台管理、接口状态、字段完整度、调试信息。
- 类型以 `main-web/src/api.ts` 为准。

后台：

- 面向管理员。
- 管理用户、会员、内容、实战课程、操作记录、用户监控。
- 类型以 `admin-web/src/api.ts` 为准。

后端：

- 所有权限判断必须在 `server/auth_api.py` 服务端完成。
- 前端只负责显示，不作为安全边界。
- 后端接口字段变化，必须同步前端类型和最小验证。

## 4. API 标准

路径约定：

- `/api/auth/*`：登录、注册、会话、密码。
- `/api/product/*`：前台产品只读数据。
- `/api/admin/*`：后台管理数据，必须管理员权限。
- `/api/analytics/event`：登录用户点击埋点。

返回标准：

- 成功返回结构化 JSON。
- 失败返回 `{ "error": "...", "code": "..." }`，其中 `code` 可选。
- 前台错误文案不得暴露技术细节。

字段标准：

- 时间统一 `YYYY-MM-DD HH:mm:ss`。
- 布尔值用 boolean。
- 金额、涨跌、会员状态走共享格式化入口。
- 同一业务含义只能有一个共享出口。

## 5. 权限与安全

必须服务端校验：

- 管理员接口。
- 会员内容。
- 实战课程授权。
- 上传。
- 用户资料和会员修改。

密码标准：

- 忘记密码必须走邮件重置链接。
- 不返回、不展示原密码。
- 重置 token 只存 hash。
- 默认 30 分钟过期，用完即失效。
- 邮件未配置完成前，不上线可点击的忘记密码入口。

后台角色：

- `user`：普通用户。
- `admin`：普通管理员。
- `super_admin`：超级管理员。

管理员权限不得靠前端隐藏按钮实现。

## 6. UI 编码标准

页面流程：

1. 先明确页面类型：前台用户页、后台管理页、详情页、列表页、权限页、工具数据页。
2. 先出高保真图。
3. 用户确认后再实现。
4. 实现后做最小验证。

React 标准：

- 新前台改 `main-web/src/*`。
- 新后台改 `admin-web/src/*`。
- API 类型放各自 `api.ts`。
- 页面通用格式化、权限显示、状态标签优先抽共享函数或组件。
- 页面 CSS 只处理布局和局部间距，通用视觉走共享类。

视觉标准：

- 白版优先。
- 表格清晰，列宽稳定。
- 字号和间距克制。
- 不做大面积解释文案。
- 不用假数据撑 UI。

## 7. Python 与脚本标准

默认：

- Python 数据 / 研究脚本优先使用 Conda `quant` 环境。
- 标准库优先，不为小功能新增依赖。
- 数据脚本要 fail closed：关键数据不新鲜时停止发布。
- 运行日志写到可查位置。

脚本职责：

- `scripts/build_product_db.py`：构建产品 DB。
- `scripts/update_product_data.sh`：更新产品数据。
- `scripts/automated_refresh.sh`：完整自动刷新入口。
- `scripts/deploy_dev.sh`：部署 dev 代码和静态构建，默认不重建产品 DB。
- `scripts/prepare_prod_release.sh`：构建、测试并生成 commit 对应的不可变代码发版包。
- `scripts/promote_prod.sh`：仅校验并切换已验收的 production 代码发版包。
- `scripts/rollback_prod.sh`：按当次明确授权回滚到服务器保留的历史代码发版包。

新增脚本必须说明输入、输出、失败条件。

## 8. 部署标准

环境：

- dev：`https://dev.dongbimao.org`
- prod：`https://www.dongbimao.org`
- admin：`https://admin.dongbimao.org`

标准：

- 默认只允许部署 dev。
- production promote 必须用户当次手动通知并明确授权；不得通过定时任务、历史授权或本地 env 自动更新 prod。
- 代码部署不拉行情、财报、期权等产品数据；数据刷新只走自动化任务或显式数据脚本。
- dev / prod 前台、API、DB 应隔离。
- 当前 `docs/release-flow.md` 记录过“同 API 服务”的历史现状，这是待清理技术债；新改动不得继续加重这个问题。

常用命令：

```bash
npm run build
python3 -m py_compile server/auth_api.py
./scripts/deploy_dev.sh
```

发布细节见 `docs/release-flow.md`。

## 9. 验证标准

改前端：

```bash
npm --prefix main-web run build
npm --prefix admin-web run build
```

改后端：

```bash
python3 -m py_compile server/auth_api.py
```

改用户监控：

```bash
python3 scripts/test_analytics_metrics.py
```

改权限：

```bash
python3 scripts/test_admin_login_guard.py
```

改发布流程：

```bash
bash scripts/run_release_gate.sh
```

只跑和改动相关的最小验证。验证不过，不部署。

## 10. Git 与文件标准

进 Git：

- 源码。
- 脚本。
- 测试。
- 项目规则。
- 文档。

不进 Git：

- 构建产物。
- 缓存。
- 截图临时文件。
- 密钥。
- 运行时 DB。
- 临时包。

工作区已有无关改动时：

- 不回滚。
- 不覆盖。
- 只处理本次任务相关文件。

## 11. 变更前检查

每次动手前先确认：

- 这个改动属于前台、后台、后端、数据脚本还是部署。
- 有没有用户已确认的页面图或边界。
- 数据是否来自现有 DB / API。
- 是否会影响线上行为、写入、成本、权限或对外可见输出。
- 是否需要先让用户确认。

每次交付前检查：

- 前后台没有混用。
- 没有假数据。
- 没有内部说明暴露到前台。
- 类型已同步。
- 最小验证已跑。
- 是否部署已明确说明。
