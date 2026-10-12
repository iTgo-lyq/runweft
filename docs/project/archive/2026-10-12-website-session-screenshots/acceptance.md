# HAPI 官方截图官网验收

2026-10-12，按用户持续授权自动验收并发布。

## 结果

- [官网截图区](https://runweft.pages.dev/#session-screenshots)展示 HAPI 官方的会话记录和代码查看截图，注明 [hapi.run](https://hapi.run/) 来源。两图字节与官方一致，图注、替代文本和来源文字由 iclaude 编写。
- 桌面双列、手机单列，可通过普通链接查看原图。原有首屏、安装/接入提示与指南内容保留；六宽度首屏/CTA几何基线一致。
- 15 项发布测试、1 项构建测试、三页六宽度 Playwright、27 个本地链接/锚点、无 JS/键盘原图、子路径与图片解码通过。两张 WebP 共 186,650 字节，整站十文件 296,682 字节。
- 源码 `b90adf05e0ee18a604705f558f30e6f5bbaa6fee` 的[核心 CI](https://github.com/iTgo-lyq/runweft/actions/runs/38199746685)与[Pages CI](https://github.com/iTgo-lyq/runweft/actions/runs/38199746816)成功；[唯一部署](https://cdc18d20.runweft.pages.dev/)和正式域名均通过十文件摘要/MIME、三页浏览器、两图解码与指南链接检查。Pages 没有 Actions artifact。
- Specs 同步范围：`website/product` 的官方截图与静态发布，`website/guide` 的当前验收入口。作者会话、官方文件 URL/hash 和验证摘要见 [verification.json](verification.json)；原始证据在 `.dev-smoke/website-session-screenshots/`。

## 范围

官方图仅展示上游界面，不表示全部 HAPI 客户端、runtime 或控件都已接入 Runweft。此次没有新增产品行为、模型执行或手机真机验收。移动端为 Playwright 窄屏；`--browser-only` 明确跳过重复 npm 安装，npm/HAPI 冻结输入和 1.1.3 保留。正式域名首轮浏览器代理连接超时，直接连接重试通过；HTTP 内容核对正常，两次浏览器使用的传输设置分别保存在证据中。
