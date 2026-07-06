# 高保真图快速产出流程

这个流程只用于产品评估，不直接代表线上实现。目标是让设计讨论后可以快速出图、快速返工、快速对比。

## 常用命令

```bash
npm run mock:list
npm run mock:shot -- trend-signals
npm run mock:shot -- stock-library
npm run mock:shot -- stock-workbench
npm run mock:shot -- all
```

截图输出在 `mockups/output/`：

- `*-desktop.png`
- `*-mobile.png`

脚本会同时检查：

- 页面标题
- 横向溢出
- 空白页面
- 基本文档高度

## 当前内置模板

- `trend-signals`：趋势信号战报和付费引导
- `stock-library`：股票库终端式列表
- `stock-workbench`：个股详情工作台

## 后续扩展方式

1. 在 `mockups/` 新增一个 HTML。
2. 复用 `mockups/_design-system.css`。
3. 在 `scripts/mock_shot.mjs` 的 `mockups` 配置里加一项。
4. 运行 `npm run mock:shot -- 新名字` 导出图片。

## 产品确认原则

高保真图确认的是页面目标、信息优先级、文案、布局密度和付费表达。确认后再进入正式前端实现，避免边写线上代码边反复改方向。
