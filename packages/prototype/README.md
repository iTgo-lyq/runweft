# Hub 交互原型

八个入口覆盖身份与空间、任务详情、机器、Runtime、Agent、仓库、个人选择和成员。页面主体从 `src/hub` 在提交 `23ca1d4` 抽取，独立维护在 `src/ui`；身份壳与请求替换为本包内存演示，不引入后端。原型不是产品或真实 HAPI 执行验证。

在本目录运行：

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run build
bun run test
bun run screenshots
```

构建将 HTML/CSS/JavaScript 合成 `dist/<id>/index.html`。可使用任意静态 HTTP 服务预览；受限 iframe 的 24 组真实交互验收由 `verify.mjs` 自动执行。场景切换、空间切换和资源编辑使用内存；刷新或“重置演示”恢复初始值。导入身份/接受邀请使用 `demo`，不输入真实凭据。

清单在 `prototype.json`，上传入口在 `publish-entries.json`。每次发布必须从干净、已推送的源码提交构建，再登记固定版本；后续更新不会覆盖历史地址。Cloudflare 发布步骤随 R2 适配器维护。
