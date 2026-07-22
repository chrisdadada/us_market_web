# 课程媒体交付

## 当前结论

2026-07-22 对 dev 课程媒体做了只读检查：

- 7 个课程封面、28 个课程视频，共 35 个媒体引用。
- 总体积约 15.6 GB，35 个对象均支持 HTTP Range。
- 35 个地址均为腾讯 COS 短期签名直链，没有观察到 CDN 缓存命中。
- 15 个视频超过 Cloudflare Free 的 512 MB 单对象缓存上限。
- 多条课程仍引用原始 `.mov` 或大体积 `.mp4`，不能视为已经全部切换到优化版本。

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

1. 在 dev 核对 28 个视频的转码状态、输出对象和当前 `video_key`，先解决仍引用旧大文件的问题。
2. 在 dev 建立腾讯 CDN 私有 COS 回源与 CDN URL 鉴权的最小闭环，不把外部 COS 视频接入 Cloudflare 免费 CDN。
3. 用两个不同的有效签名验证缓存复用，并确认过期、篡改、无课程权限请求均不能访问；同时验收 Range、国内播放速度和实际回源成本。
4. 未获得当次人工授权前，不修改 prod 数据库、prod COS、DNS 或媒体链接。

## Dev CDN 白名单

后端支持把单个 dev 视频切到腾讯 CDN Type A 鉴权，默认关闭且不会改变现有播放链路：

```bash
COURSE_CDN_ENABLED=1
COURSE_CDN_DOMAIN=https://lesson-dev.dongbimao.org
COURSE_CDN_AUTH_KEY=<独立的 CDN Type A 密钥>
COURSE_CDN_SIGN_TTL_SECONDS=1800
COURSE_CDN_VIDEO_KEYS=lesson/path/to/poc-video.mp4
```

`COURSE_CDN_VIDEO_KEYS` 只接受精确对象 Key。未命中白名单的视频继续使用 COS 签名地址；上传、转码和课程封面不经过 CDN。关闭 `COURSE_CDN_ENABLED` 并重启 dev 服务即可回滚。

腾讯 CDN 侧的 Type A 过期时间必须与 `COURSE_CDN_SIGN_TTL_SECONDS` 一致。私有 COS 必须同时开启 CDN 服务授权、回源鉴权和 CDN URL 鉴权。

## 参考

- [Cloudflare CDN 视频与大文件条款](https://www.cloudflare.com/service-specific-terms-application-services/)
- [Cloudflare 单对象缓存限制](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)
- [腾讯 CDN URL 鉴权](https://cloud.tencent.com/document/product/228/41623)
