# 上线测试流程

这个项目的测试 agent 先守住最容易影响收入和体验的链路：登录、免费/付费权限、付费内容访问、会员到期、管理员创建会员。

## 发布前门禁

每次上线前在项目根目录运行：

```bash
python3 -m unittest tests.test_release_gate -v
```

当前门禁会启动一套临时 API 服务和临时 SQLite 数据库，不会污染线上或本地正式数据。

## 用户矩阵

发布前至少覆盖这几类用户：

| 用户类型 | 预期结果 |
| --- | --- |
| 未登录用户 | 可以看公开接口状态，访问付费接口返回 `401 unauthenticated` |
| 免费用户 | 登录成功，但 `entitlements.paid=false`，访问付费接口返回 `403 upgrade_required` |
| 有效付费用户 | 登录后 `plan=paid`，可以读取付费交割记录 |
| 已过期付费用户 | 后台仍保留付费套餐记录，但真实访问权限降级为免费 |
| 超级管理员 | 可以创建会员、查看会员列表和付费统计 |

## 现有自动化覆盖

- `/api/health` 健康检查。
- `/api/auth/status` 登录态和权限返回。
- `/api/pro/trade-records` 免费/付费访问隔离。
- `/api/admin/users/create` 管理员创建免费、付费、过期会员。
- `/api/admin/users` 会员总数、有效付费统计、到期状态。

## 后续扩展顺序

1. 增加前端浏览器冒烟测试：登录弹窗、免费用户锁定态、付费用户解锁态、管理员菜单显示。
2. 增加数据构建测试：`scripts/build_core_signals.py` 和 `scripts/build_strength_scanner.py` 的样本数据回归。
3. 增加部署后巡检：上线后访问健康接口、登录测试账号、验证付费接口权限。
4. 接入 CI：每次合并或部署前自动运行发布门禁。
