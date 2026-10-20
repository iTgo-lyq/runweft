# Hub 交互原型

八个入口覆盖账号与首次连接、任务、机器、Runtime、Agent、仓库、我的选择和成员。所有入口是同一个应用，入口 ID 只决定打开时的第一屏；身份与空间位于工作台侧栏。视觉与交互规范见 [UI 库的 DESIGN.md](../ui/DESIGN.md)，原型特有的例外见本目录 [DESIGN.md](DESIGN.md)。原型只用虚构的内存数据，不是产品或真实 HAPI 执行验证。

| 位置 | 内容 |
| --- | --- |
| `src/app.js` | 工作台壳、路由、账号状态切换、演示控制 |
| `src/mock.js` | 虚构数据与内存接口，字段沿用产品投影 |
| `src/ui/` | DOM 工具与通用控件（按钮、检查器、菜单、对话框、纬线等） |
| `src/pages/` | 各页面：账号、任务、机器与 Runtime、Agent、仓库、我的选择、成员、账号设置 |
| `src/style.css`、`src/shell.html` | 浅色/深色令牌与组件样式；页面骨架和内联图标 |

右下角“演示”切换数据场景（正常、空数据、首次加载失败、刷新失败、离线或结果未知、登录过期）、在“产品协作”的角色（所有者、管理员、成员）、外观（跟随系统、浅色、深色）和账号场景。账号页可用任意用户名和密码；重置码和邀请输入 `demo`。刷新或“重置演示”恢复初始数据。

在本目录运行：

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run build
bun run dev        # http://127.0.0.1:4175/tasks/index.html
bun run test
bun run screenshots
```

构建将 HTML/CSS/JavaScript 合成自包含的 `dist/<id>/index.html`；`bun build.mjs --git-preview` 同时写出 Git 交付用的 `preview/<id>/index.html`。`verify.mjs` 在受限 iframe 中覆盖 8 个入口 × 桌面 1440×1000、平板 834×1112、手机 390×844：加载、隔离、无外部请求和存储、无横向溢出、各入口主要操作（平板和手机用触摸），以及数据场景、键盘焦点回归、外观切换、减少动态效果和减少透明度。`--screenshots` 另存每个入口与设备的浅色和深色截图，并改用 SwiftShader GPU 合成：无头 Chromium 的软件渲染不会对带圆角的玻璃做背景模糊，截图会比真实浏览器显得更不透明。CI 的临时 Ubuntu runner 和不允许 user namespace 的机器上设置 `CI=true`，关闭 Chromium 进程沙箱；iframe 权限仍仅为 allow-scripts。

清单在 `prototype.json`，上传入口在 `publish-entries.json`。每次发布必须从干净、已推送的源码提交构建，再登记固定版本；后续更新不会覆盖历史地址。

## Cloudflare R2 发布

适配器和失败测试来自 open-folio `73c07d4` 的原型包，使用相同协议，写入独立 `runweft/<requestId>/` 前缀。Bucket 采用 Standard 存储；适配器不创建资源、不调整计划、不删除文件。已有公开 R2 Bucket 可以复用，凭据由发布机器注入；[根目录 `.env.example`](../../.env.example) 列出所需变量；首次配置复制为仓库根目录 `.env` 并执行 `chmod 600 .env`，已有文件只补充相关项。`.env` 和 `.env.local` 已被 Git 忽略。发布脚本按自身位置定位仓库，仅读取五项 R2 配置，优先级为进程环境变量、`.env.local`、`.env`；显式空值也保留，配置值不做变量插值。无需传入 `--env-file`，请求和回执路径仍相对当前工作目录解析。自动 CI 不持有上传凭据。

先提交并推送源码、确保工作区干净，然后在仓库根目录执行：

```sh
bun run --cwd packages/prototype build
bun run --cwd packages/prototype screenshots
# 使用仓库外的唯一临时目录保存请求与回执。
prototype_publish_dir=$(mktemp -d /tmp/runweft-prototype.XXXXXX)
node .agents/skills/spec-trail/prototype/scripts/publish.mjs prepare \
  --directory packages/prototype/dist --entries packages/prototype/publish-entries.json \
  --repository https://github.com/iTgo-lyq/runweft --out "$prototype_publish_dir/request.json"
node packages/prototype/publish-r2.mjs \
  --request "$prototype_publish_dir/request.json" --result "$prototype_publish_dir/result.json"
# change-id 替换为本次 Change；无关联 Change 时省略 --change。
node .agents/skills/spec-trail/prototype/scripts/publish.mjs register \
  --request "$prototype_publish_dir/request.json" --result "$prototype_publish_dir/result.json" --change change-id
node .agents/skills/spec-trail/prototype/scripts/validate.mjs --browser \
  --playwright "$PWD/packages/prototype/node_modules/playwright/index.mjs"
```

随后提交推送清单与 Change 引用。上传前检查准备时的摘要；使用 `If-None-Match: *` 条件写入，相同版本只接受完全相同的字节和 MIME。全部对象上传并匿名读取核对后才生成成功回执。若中断或网络失败，使用保存的同一 request 重试；登记失败可复用成功 result，不重新构建或改变原产物。部分对象存在不代表完成发布。

源码/Change 由归档提交及合入协作分支的合并提交保留，新归档不创建保留标签。历史归档与已有标签保持原样；旧归档没有新版有效合并记录时，工作台不通过旧标签回退读取原型。R2 对象需由 Bucket 管理者持续保留，不配置自动过期。当前凭据可读写对象，但读取生命周期配置返回 403，无法核实自动删除规则；Git 记录不能代替托管存储的保留保证。r2.dev 适合开发预览且有限流，免费额度按账户实际使用计算。
