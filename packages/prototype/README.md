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

手机截图滚动到空间内容，便于从缩略图区分各入口；页面仍保留完整侧栏。构建将 HTML/CSS/JavaScript 合成 `dist/<id>/index.html`。可使用任意静态 HTTP 服务预览；CI 的临时 Ubuntu runner 关闭 Chromium 进程沙箱（其 user namespace 被宿主限制）；iframe 权限仍仅为 allow-scripts，本地默认启用进程沙箱。受限 iframe 的 16 组桌面/手机入口检查由 `verify.mjs` 自动执行：加载、隔离、无外部请求、主导航，以及身份和任务详情的代表性交互；不逐页复演演示 CRUD。场景切换、空间切换和资源编辑使用内存；刷新或“重置演示”恢复初始值。导入身份/接受邀请使用 `demo`，不输入真实凭据。

清单在 `prototype.json`，上传入口在 `publish-entries.json`。每次发布必须从干净、已推送的源码提交构建，再登记固定版本；后续更新不会覆盖历史地址。

## Cloudflare R2 发布

适配器和失败测试来自 open-folio `73c07d4` 的原型包，使用相同协议，写入独立 `runweft/<requestId>/` 前缀。Bucket 采用 Standard 存储；适配器不创建资源、不调整计划、不删除文件。已有公开 R2 Bucket 可以复用，凭据由发布机器注入；`r2.env.example` 列出所需变量，真实文件放仓库外、权限 0600。自动 CI 不持有上传凭据。

先提交并推送源码、确保工作区干净，然后在仓库根目录执行：

```sh
bun run --cwd packages/prototype build
bun run --cwd packages/prototype screenshots
# 使用仓库外的唯一临时目录保存请求与回执。
prototype_publish_dir=$(mktemp -d /tmp/runweft-prototype.XXXXXX)
node .agents/skills/spec-trail/prototype/scripts/publish.mjs prepare \
  --directory packages/prototype/dist --entries packages/prototype/publish-entries.json \
  --repository https://github.com/iTgo-lyq/runweft --out "$prototype_publish_dir/request.json"
node --env-file="$HOME/.config/runweft/r2.env" packages/prototype/publish-r2.mjs \
  --request "$prototype_publish_dir/request.json" --result "$prototype_publish_dir/result.json"
# change-id 替换为本次 Change；无关联 Change 时省略 --change。
node .agents/skills/spec-trail/prototype/scripts/publish.mjs register \
  --request "$prototype_publish_dir/request.json" --result "$prototype_publish_dir/result.json" --change change-id
node .agents/skills/spec-trail/prototype/scripts/validate.mjs --browser \
  --playwright "$PWD/packages/prototype/node_modules/playwright/index.mjs"
```

随后提交推送清单与 Change 引用。上传前检查准备时的摘要；使用 `If-None-Match: *` 条件写入，相同版本只接受完全相同的字节和 MIME。全部对象上传并匿名读取核对后才生成成功回执。若中断或网络失败，使用保存的同一 request 重试；登记失败可复用成功 result，不重新构建或改变原产物。部分对象存在不代表完成发布。

源码/Change 由归档标签保留；R2 对象需由 Bucket 管理者持续保留，不配置自动过期。当前凭据可读写对象，但读取生命周期配置返回 403，无法核实自动删除规则；Git 标签不能代替托管存储的保留保证。r2.dev 适合开发预览且有限流，免费额度按账户实际使用计算。
