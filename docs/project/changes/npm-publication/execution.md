# npm 首次公开发布执行记录

## Plan 评审

iclaude 在当前工作区完成一次只读评审，会话 `991da989-689b-478a-b679-baf7d0560cbe`，is_error=false；结果保存在 `.dev-smoke/reviews/npm-publication/review.json`。主 agent 采纳包内说明矛盾、显式 registry/专用配置、发布额外认证、部分发布保留与公共元数据检查。

未采纳“原样发布过时 README、下版更正”：首次发布前补正确说明，在干净源码重建并重跑包/安装检查；以四平台程序与 Skill hash 完全相同为复用已有模型验收的条件。Linux x64 为实际最大包（207306747 字节），与既定发布顺序一致，不调整顺序。仅本次专用 npm 登录凭据在完成后清理，不修改其他 npm 认证。

## T1 核对发行输入并补齐 npm 安装说明

- 结果：五个包名的公共 registry 查询均为 404；既有候选五个 tarball 与索引 SHA-512、SHA256SUMS、包内 manifest 和 Skill 一致；补公共 npm 安装命令。
- 验证：五个实际 tarball 的 npm publish --dry-run --ignore-scripts --json 均通过且 integrity 与索引相同，证据 `.dev-smoke/npm-publication/original-preflight.json`。临时检查脚本适配本机 npm 11 的按包名 JSON 输出后通过；未将预演当作真实发布。
- 验证：既有 GitHub CI 重跑通过，包括 build、macOS arm64/x64、Linux arm64 安装；run 36848637434，仍不等于四平台完整模型验收。
- 未解决：本机 npm 认证尚未完成；真实上传、包体积接受情况和公共安装仍未验证。
- Commit：`npm-publication T1: prepare public npm installation instructions and release procedure`。

## T2 发布与公共安装验证

- 已完成：`bun run package --all --reuse-hapi` 在干净 T1 提交上重建 1.1.0；候选源码 `9d44a507fd66525c1c9fc456c5c2eb9a93e65cdf`，dirty=false。四平台 Runweft/HAPI 程序 hash 和独立 Skill 均与原候选相同，比较证据 `.dev-smoke/npm-publication/candidate-comparison.json`；复用已有模型验收，不声称重新执行。
- 验证：`bun run test:packages` 通过，证据 `.dev-smoke/release-packages-VHeUaX/evidence.json`；五个解包 README 逐字等于更新后的说明，公共 npm 命令正确，证据 `.dev-smoke/npm-publication/readme-checks.json`。
- 验证：`bun run test:install` 通过，专用 registry 安装、服务/信号/reset、重装、缺依赖诊断、卸载与数据保留；证据 `.dev-smoke/install-WW8ijy/evidence.json`。这是本地 registry，尚非公共 npm 安装。
- 验证：新五包 `npm publish --dry-run --ignore-scripts --json` 均通过，SHA-512 与新索引一致，证据 `.dev-smoke/npm-publication/preflight.json`。专用命令确认 registry 为 `https://registry.npmjs.org/`；未执行真实 publish。
- 认证：隔离配置起初返回 ENEEDAUTH；官方网页登录已成功，`npm whoami` 为 `itgo-lyq`。首个平台 `runweft-linux-x64@1.1.0` 的真实 publish 请求得到官方发布验证提示，已将浏览器验证入口交给用户，当前等待完成。密码/验证码只在官方页面输入，不收进聊天。
- 外部事实：原会话 50283 的发布认证轮询返回 E404（官方 done 请求），进程退出；确认零个成功包后重试。会话 34022 在用户完成新的官方发布验证后返回 E413 Payload Too Large；失败后公开版本仍为 404、publication.json 仍零个成功包，体积拒绝已真实复现。
- 恢复入口：先完成 T4 后的正式候选重建与验证，再在 TTY 启动 `.dev-smoke/npm-publication/publish.mjs`；此前会话均已退出，不能复用旧认证 nonce。五包逐个核验后执行 `.dev-smoke/npm-publication/public-install.mjs`。认证配置权限 0600，目录 0700，均不提交，保留到发布完成后清理。
- 未完成：修正后正式候选检查、真实发布、公共下载/安装、Specs 同步和归档；T2 继续执行，T3 未开始。

## T4 缩减平台源码归档并验证构建材料

- 结果：源码归档仅省略其他平台的八份工具压缩包；每包保留 2934 个文件，所有源码、许可和当前平台两份工具均与固定 Git blob 相同。源码归档约 23–29 MB，生成包绑定既有 Runweft 仓库 URL；来源说明列出当前平台完整重建步骤，新增脚本纳入冻结输入。
- 验证：`bun run typecheck`、`bun run test`（256 pass / 0 fail）、`bun run build`、diff-check 和 Change 结构检查通过。实际四平台 CLI 从各自源码归档交叉编译通过，证据 `.dev-smoke/npm-publication/source-archives-v2/evidence.json`；工作区源码在归档内，第三方依赖与 tunwg 复用构建缓存，不带 Web 资产，不代替发行模型验收。
- 返修：首轮编译缺少原版构建要求下载的 tunwg，保持失败证据目录 `source-archives`；补缓存中的对应 tunwg，并将 workspace 依赖明确指向解包源码后通过。发行仍复用原固定 HAPI 可执行程序，T2 将重新核对四平台程序 hash。
- Commit：`npm-publication T4: package HAPI sources with platform-specific build tools`。
