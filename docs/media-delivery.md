# 课程媒体交付

## 当前结论

2026-07-22 对 dev 课程媒体做了只读检查：

- 7 个课程封面、28 个课程视频，共 35 个媒体引用。
- 总体积约 15.6 GB，35 个对象均支持 HTTP Range。
- 35 个地址均为腾讯 COS 短期签名直链，没有观察到 CDN 缓存命中。
- 15 个视频超过 Cloudflare Free 的 512 MB 单对象缓存上限。
- 28 个视频均为 H.264/AAC、宽度不超过 1920，当前平均码率均未超过 3000 kbps；没有视频达到自动重转码门槛。
- 其中 13 个对象使用 `.mov` 容器，但不能只按扩展名判定需要转码。仅换容器基本不降低流量，重新编码还可能损伤课程中的小字和图表。

因此，Cloudflare Free 可以继续承载网页、脚本和样式等普通网站内容，但不用于代理现有腾讯 COS 课程视频。Cloudflare 的 Free / Pro / Business 条款要求视频和其他大文件使用 Stream、R2 等指定服务；文件未超过 512 MB 只代表没有触发缓存尺寸限制，不代表可以用免费 CDN 分发。

禁止通过忽略 COS 签名参数来提高缓存命中率，否则可能绕过课程权限。

## 验收工具

`scripts/audit_media_delivery.py` 只读取每个对象的首字节，用于检查文件大小、Range、缓存命中和 Cloudflare Free 适配性。报告不会保存 URL 查询参数。

公开静态文件：

```bash
python3 scripts/audit_media_delivery.py --public --url https://dev.example.com/assets/app.js
```

私有签名媒体应通过标准输入传入，避免签名出现在进程参数中：

```bash
printf '%s\n' "$SIGNED_MEDIA_URL" | python3 scripts/audit_media_delivery.py --stdin
```

批量清点时可只请求一次并输出汇总：

```bash
python3 scripts/audit_media_delivery.py --stdin --attempts 1 --summary-only
```

CDN PoC 验收时必须明确要求 Range 和第二次请求命中缓存：

```bash
python3 scripts/audit_media_delivery.py --stdin --require-range --require-cache-hit
```

## 下一步门槛

1. 保留当前 28 个视频，不按文件扩展名批量重转码；后续新视频继续按真实编码、尺寸和码率判定。
2. 在 dev 建立腾讯 CDN 私有 COS 回源与 CDN URL 鉴权的最小闭环，不把外部 COS 视频接入 Cloudflare 免费 CDN。
3. 用两个不同的有效签名验证缓存复用，并确认过期、篡改、无课程权限请求均不能访问；同时验收 Range、播放速度和实际回源成本。
4. 未获得当次人工授权前，不修改 prod 数据库、prod COS、DNS 或媒体链接。

只读媒体规格盘点仅允许在 dev 运行：

```bash
python3 scripts/audit_course_media.py \
  --environment dev \
  --db /var/lib/ytd-gainers-dev/app.db \
  --probe-video-metadata \
  --output .local/media-audits/dev-video-metadata-YYYYMMDDTHHMMSSZ.json
```

报告不保存 COS 签名地址或凭证；探测失败会原样计入失败数量，不会猜测为达标。

## Dev 播放地址发放基线

后端仅在用户通过权限校验且成功生成播放地址后记录 `course_play_grant`。它表示播放地址发放成功，不代表视频实际开始播放、观看完成或产生了多少流量；真实传输量仍以 COS / CDN 账单与访问日志为准。

聚合报告只读取 dev 用户库和指定的视频元数据报告，不输出用户身份、签名地址、IP 或单次访问时间：

```bash
python3 scripts/report_course_media_usage.py \
  --metadata /opt/dongbimao-dev/.local/media-audits/dev-video-metadata-YYYYMMDDTHHMMSSZ.json \
  --from 2026-07-22 \
  --to 2026-08-01
```

公开的 `/api/analytics/event` 仍只接受 `nav_click`，不能由前台伪造课程播放地址发放记录。

## Dev 每日媒体成本证据

`scripts/report_dev_media_costs.py` 把现有 dev 证据汇总为一份只读 JSON：

- 最新课程媒体库存及原视频体积；
- 当前 HLS 覆盖和原文件保留情况；
- 所有闲时转码批次的成功、失败、待处理数量及历史估算费用；
- 指定时段内的播放地址发放量。

它不会把播放地址发放量冒充观看量或流量，也不会把价目估算冒充腾讯云账单。腾讯账单和实际出网流量尚未接入时，报告状态为 `partial`；自动化需要完整费用证据时加 `--require-external-costs`，此时返回状态码 `2`，避免把不完整数据当成完成。

```bash
python3 scripts/report_dev_media_costs.py \
  --from 2026-07-22 \
  --to 2026-07-24
```

脚本只允许读取 `/var/lib/ytd-gainers-dev/app.db`、dev 媒体报告目录和 dev HLS 批次目录，不读取 prod，不写数据库、COS 或腾讯云配置。

## Dev HLS 试点

2026-07-23 已在 dev 课程第 35 课启用离线 HLS 试点：

- 原 MP4 保留在 `video_source_key`，当前播放入口指向 `lesson/hls/dev-pilot/lesson-35-offline-20260723/master.m3u8`。
- 主清单包含 1080、720、480 三档，每档 230 个分片，时长均为 1149.9 秒。
- 播放接口和 HLS 清单继续校验登录与课程权限；清单使用同源接口，媒体分片使用短期 COS 签名地址。
- Safari 使用原生 HLS，其他支持 MSE 的浏览器按需加载 `hls.js`，不会让未进入播放页的用户下载播放器代码。
- dev 验收已覆盖主清单、三档子清单及每档首段、中段、末段的 Range 读取；prod 数据和媒体地址未切换。

回滚只需把 dev 第 35 课的 `video_key` 恢复为 `video_source_key`。未获得当次人工授权前，不得把该 HLS 地址或相关代码推广到 prod。

2026-07-23 完成 dev 全量闲时转码：

- 除第 35 课试点外，剩余 27 节共 997.9 分钟，按 1080、720、480 三档提交闲时转码；估算费用 41.91 元。
- 两个批次状态分别记录在 `/opt/dongbimao-dev/.local/hls-batches/20260723-batch-01.json` 和 `20260723-batch-02.json`，共 81 个任务，没有失败或遗漏。
- 非 16:9 视频按原始比例缩放，不拉伸、不放大；例如第 1 课使用 1920×708、1280×472、854×314。
- 28 节已发布视频全部切换为 HLS，28 份 `video_source_key` 均保留。每节只有在三档清单、时长和分片读取全部通过后才单独切换。
- 登录播放链路已抽查全部 6 个有视频的课程系列；prod 课程库没有 dev HLS 引用，prod 媒体和代码未切换。
- Open 持仓保护指纹保持不变：`open_portfolio_trades` 33 行，`open_portfolio_symbol_rules` 442 行。

批处理脚本默认只输出计划。创建付费任务必须显式使用 `--submit` 并指定状态文件；中断后使用同一状态文件续提，不会重新提交已经记录的任务。完成后使用 `--reconcile --activate` 核对并逐课切换。

## Dev CDN 白名单

后端支持把单个 dev 视频切到腾讯 CDN Type A 鉴权，默认关闭且不会改变现有播放链路：

```bash
COURSE_CDN_ENABLED=1
COURSE_CDN_DOMAIN=https://lesson-dev.dongbimao.org
COURSE_CDN_AUTH_KEY=<独立的 CDN Type A 密钥>
COURSE_CDN_SIGN_TTL_SECONDS=7200
COURSE_CDN_VIDEO_KEYS=lesson/hls/dev-batch/20260723-batch-02/lesson-36/
```

`COURSE_CDN_VIDEO_KEYS` 接受精确对象 Key，也接受以 `/` 结尾的目录前缀。HLS 试验只配置单个课程目录，该目录中的媒体分片使用 CDN，播放清单仍由登录后的同源接口鉴权返回。未命中白名单的视频继续使用 COS 签名地址；上传、转码和课程封面不经过 CDN。关闭 `COURSE_CDN_ENABLED` 并重启 dev 服务即可回滚。

腾讯 CDN 侧的 Type A 过期时间必须与 `COURSE_CDN_SIGN_TTL_SECONDS` 一致。HLS 课程不得低于 7200 秒，避免长视频播放过程中分片地址失效。私有 COS 必须同时开启 CDN 服务授权、回源鉴权和 CDN URL 鉴权。

2026-07-23 的 dev CDN 接入检查没有改变线上配置：

- 腾讯 CDN 境内加速要求 `lesson-dev.dongbimao.org` 先完成备案，当前控制台因此不允许添加该域名。
- 成都 COS 访问域名配置正确，但用户侧抽样分片首字节为 2.6 至 7.6 秒，完整下载为 4.6 至 9.4 秒，慢点位在 COS 传输链路，不在播放器界面。
- COS 全球加速域名尚未启用，试读返回 HTTP 400；没有开通付费加速，也没有切换 DNS、dev 环境变量或媒体链接。
- 在境内 CDN 域名可用前保持 CDN 关闭，不能为绕过备案改用可能拖慢中国用户播放的境外线路。

## 参考

- [Cloudflare CDN 视频与大文件条款](https://www.cloudflare.com/service-specific-terms-application-services/)
- [Cloudflare 单对象缓存限制](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [腾讯 CDN URL 鉴权](https://cloud.tencent.com/document/product/228/41623)
