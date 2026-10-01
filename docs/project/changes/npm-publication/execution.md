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

- 候选：正式五包重建于干净 T4 提交 `bfa2df88531a2f997038817c901d89ca9cab491e`，dirty=false；四平台 Runweft/HAPI 与独立 Skill hash 均与原验收候选相同，比较证据 `.dev-smoke/npm-publication/candidate-comparison.json`。沿用已有模型验收，不声称重新执行。
- 验证：`bun run test:packages` 通过，包括匹配源码逐文件 Git blob 校验，证据 `.dev-smoke/release-packages-nDC1ok/evidence.json`；五个随包 README 与当前使用说明逐字相同，证据 `.dev-smoke/npm-publication/readme-checks.json`。
- 验证：`bun run test:install` 通过，覆盖专用 registry 安装、服务/信号/reset、重装、缺依赖诊断、卸载与数据保留，证据 `.dev-smoke/install-sMpeaY/evidence.json`。这是本地 registry 验证。
- 验证：实际五个 tarball 的 npm dry-run 全部通过，integrity 与索引相同，证据 `.dev-smoke/npm-publication/preflight.json`。最大包为 Linux x64，134823009 字节；预演不证明真实上传成功。
- 认证：官方网页登录已成功，隔离配置的 `npm whoami` 为 `itgo-lyq`，registry 为 `https://registry.npmjs.org/`。密码/验证码只在官方页面输入，认证配置权限 0600、目录 0700，不提交，发布完成后清理。
- 失败证据：首次发布验证轮询返回 E404，进程退出；再次验证成功后，207306850 字节的 Linux x64 包真实上传返回 E413。两次失败后的公开版本均为 404、零个成功包；旧认证 nonce 不能复用。T4 据此修正源码归档，原大包索引保存在 `.dev-smoke/npm-publication/oversized-index.json`。
- 发布结果：账号 `itgo-lyq` 已公开发布五个 1.1.0 包，全部版本、integrity、平台/入口/依赖和 repository 与冻结候选一致；四个平台公开确认后才发布主包。回执 `.dev-smoke/npm-publication/publication.json` success=true，pendingUploads 为空。
- 恢复：Linux arm64 上传成功后仍待后台扫描，最初一分钟查询不足；依据官方公告保存已接受回执、不重传，与其余平台上传重叠，在主包前完成全部公开确认。过期/已消费的认证链接更换新 nonce，不改变已发布版本。
- 公共验证：四个平台 tarball 先完成匿名下载 SHA-512 验证，证据 `public-install/platform-downloads.json`；完整验证复用同一冻结候选的下载证据，并重新读取五包元数据、下载主包和确认全部 latest=1.1.0，证据 `.dev-smoke/npm-publication/public-install/evidence.json` success=true。
- 安装验证：空 npmrc、专用 cache/prefix 从公共 npm 安装成功；实际 CLI 1.1.0、相邻 HAPI 0.30.7、程序 SHA-256、主包/本机平台包全部 Skill 文件、MCP/Hub 帮助均正确。Linux x64 原生安装；其他平台本次只验证公共下载，不扩张已有实机/模型验收范围。
- 清理：专用 npm logout 返回 0，已删除本次认证 npmrc，证据 `.dev-smoke/npm-publication/cleanup.json`；没有修改用户默认 npm/原生宿主配置。
- 后续：可信发布未由本 Change 配置，源码仓库只有安装测试工作流；一次 npm trust list 查询因额外 2FA 返回 EOTP，未取得当前绑定，不推断 npm 端状态。用户询问的配置步骤按官方文档说明，未因此新增账号绑定或发布自动化。
- Commit：`npm-publication T2: publish five public packages and verify isolated npm installation`。


## T4 缩减平台源码归档并验证构建材料

- 结果：源码归档仅省略其他平台的八份工具压缩包；每包保留 2934 个文件，所有源码、许可和当前平台两份工具均与固定 Git blob 相同。源码归档约 23–29 MB，生成包绑定既有 Runweft 仓库 URL；来源说明列出当前平台完整重建步骤，新增脚本纳入冻结输入。
- 验证：`bun run typecheck`、`bun run test`（256 pass / 0 fail）、`bun run build`、diff-check 和 Change 结构检查通过。实际四平台 CLI 从各自源码归档交叉编译通过，证据 `.dev-smoke/npm-publication/source-archives-v2/evidence.json`；工作区源码在归档内，第三方依赖与 tunwg 复用构建缓存，不带 Web 资产，不代替发行模型验收。
- 返修：首轮编译缺少原版构建要求下载的 tunwg，保持失败证据目录 `source-archives`；补缓存中的对应 tunwg，并将 workspace 依赖明确指向解包源码后通过。发行仍复用原固定 HAPI 可执行程序，T2 已重新核对四平台程序 hash。
- Commit：`npm-publication T4: package HAPI sources with platform-specific build tools`。
