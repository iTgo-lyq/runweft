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
- 阻塞：隔离配置的 `npm whoami` 返回 ENEEDAUTH。已发起官方网页登录；此前请求未完成后停止了回退的密码提示，新网页登录仍等待用户。密码/验证码只在官方页面输入，不收进聊天。
- 恢复入口：`.dev-smoke/npm-publication/npm-isolated.mjs` 提供固定 registry/专用配置；登录成功后在 TTY 运行 `node .dev-smoke/npm-publication/publish.mjs`，五包逐个核验后再执行 `node .dev-smoke/npm-publication/public-install.mjs`。实际发布期间若需额外认证，继续官方 CLI 浏览器流程。认证配置权限 0600，目录 0700，均不提交。
- 未完成：真实发布、公共下载/安装、Specs 同步和归档；T2 保持已阻塞，T3 未开始。
