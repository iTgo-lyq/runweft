# 打包与发行操作

测试选择、灵活环境和失败复验见[测试验收手册](testing.md)。发行工程脚本使用调用者提供的 `RUNWEFT_WORK_DIR`；冻结源码另用 `RELEASE_SOURCE`。CI 自动按 run/attempt/job 准备，成功写入证据后回收，公开恢复仍只消费既有日志与候选。


包与发布门禁见[发行规格](project/specs/release/spec.md)，官网操作见 [website/README](../website/README.md)。

## 产品 Skill 分发

工程唯一来源是 `.agents/skills/runweft-kit/`，供本仓库 Agent 使用。npm 主包和平台包继续携带 `skills/runweft-kit/`，独立 tarball 保持 `runweft-kit/` 根目录。

公开安装来源是 [runweft-kit](https://github.com/iTgo-lyq/runweft-kit)。`sync-runweft-kit.yml` 在 main 的 Skill 或同步入口变化时运行，也可手动触发；串行读取最新 main，用 Git archive 导出已提交目录，校验元数据与完整本地引用后，只同步目标 `skills/runweft-kit/`。相同内容不提交，失效文件会删除，目标 README 等其他内容保留。目标 checkout 必须干净且位于 main；推送失败保留已生成提交，如实报告，不能认为外部同步已完成。

源码仓库 Actions secret `RUNWEFT_KIT_SYNC_SSH_KEY` 对应公开仓库专用的可写 deploy key，checkout 源码不保留写凭据。密钥只用于该目标，不使用源码仓库 token 推送另一仓库，不写入源码或日志。公开分发不包含 Runweft 程序源码、SpecTrail 或工程文档；不从公开仓库反向更新源码。公开 Skill 与 npm 版本分别发布，Agent 操作前仍核对已安装 CLI 版本与 `--help`。

skills.sh 收录依赖用户通过 skills CLI 安装时的遥测及平台索引，公开仓库同步成功不等于市场已可搜索。

## 本地候选

从已提交的干净源码构建候选：

```sh
bun run package --all
bun run test:install --candidate dist/packages --case all --report /tmp/runweft-install.json
```

`package` 可用 `--platform darwin-arm64` 选单平台，已核对的 HAPI 构建可加 `--reuse-hapi`。产物在 `dist/packages/`；包输入变化须重新构建验收，固定输入由 `scripts/release-inputs.mjs` 定义。

安装验收使用专用 registry/prefix/cache，直接消费候选原始 tarball，分别检查独立包/symlink 和 npm launcher 的安装、服务信号、MCP 接线与完整卸载；驱动为 Node，程序运行时 PATH 不含 Bun 或源码。报告显式写到 `--report`，成功现场由同一入口清理，不能借固定验收获取常驻开发环境。原生入口会独立从候选准备自己的安装。

## 验收矩阵

| 层级 | 入口与范围 |
| --- | --- |
| 无模型集成 | `bun run test:integration --bin <CLI> -- [测试文件]`；真实 HAPI/Runner、文件/Git、Playwright，各用例拥有独立现场 |
| 原生主链 | `bun run test:native --candidate <目录> --case main --report <文件>`；N1/N4/N5、C-codex/C-claude 五项 |
| HAPI 专项 | 无模型退出/锁/断连用 `test:integration --bin <CLI> -- hub-lifecycle`；原生恢复或历史路径变化加 R-codex/R-claude、L-claude，各用 `test:native --case <ID>` |

发布工作流不按 diff 跳过验收。稳定版本上传 beta 前完成核心、四平台构建和 service-package；access/storage/web 从公共 npm 下载同一候选，与四平台安装及完整卸载并行。稳定版 Linux x64 同时运行真实网页 DOM 的精确版本安装，核对配对程序摘要、README 和五份 Skill 内容。空参数预检和 X.Y.Z-beta.N 预发行构建仍在上传前完成四组；所有已有候选恢复重新执行公共集成和四平台安装。任一必需 job 失败、取消或非预期跳过均阻止晋级。

公共集成使用 Bun 原生文件分片，每片下载并校验同一候选。`bun run test:integration --bin <CLI> -- --shard 1/4` 可单独执行一片；不传分片参数执行全部。安装的 tarball/symlink 与 npm launcher 由 Node 入口负责。通用检查与过滤见[测试验收手册](testing.md)。

四平台构建前检查至少 14 GiB 可用空间；不足时依次清理 GitHub 托管 Linux 镜像的 dotnet、GHC、Android SDK，达到余量即停止，清理失败或仍不足则拒绝继续。构建及上传前验收每秒采样可用空间并记录实际最低值，不将采样值当作瞬时精确峰值；候选恢复不执行构建空间清理。

原生验收调用模型，须已有授权并使用专用认证副本。默认使用 `codex` / `claude`，不自动选择 iclaude；`RUNWEFT_NATIVE_CLAUDE` 可指定 Claude 程序。模型和 effort 取原生配置，也可显式设置 `RUNWEFT_NATIVE_CODEX_MODEL/EFFORT`、`RUNWEFT_NATIVE_CLAUDE_MODEL/EFFORT`，缺少明确值时失败。已有 Chromium 可用 `RUNWEFT_SMOKE_CHROMIUM` 指定。只修改本次副本，报告不包含认证或原生状态摘要，副本刷新认证不影响结果复用。

| 案例 | 保障范围 |
| --- | --- |
| N1 | local/shared，Codex→Codex，一个任务两轮、真实成果/记忆及原生历史 |
| N4 | local/worktree，Claude→Codex，一个任务两轮、工程指令/Skill/MCP、隔离成果和固定 base |
| N5 | hub/remote，Codex→Claude，一个任务两轮、附件/成果、真实 Hub/Runner 重启取回且不重放、原生历史 |
| C-codex / C-claude | 批准/拒绝的真实文件效果与中断；Codex 加 steer 和共享宿主兄弟会话隔离 |
| R-codex / R-claude | 仅明确缺失的原生记录重建，保留业务记忆且本轮输入只发一次 |
| L-claude | 长非 Git 路径两轮原生会话延续 |

冻结产品和验收源码后构建候选。入口直接安装、准备和关闭各自现场，不消费旧交接文件。失败即停止，不自动重跑整组；先诊断和确认停机，再用新现场执行单项，报告路径不得覆盖旧文件。

```sh
bun run test:native --candidate dist/packages --case main --report /tmp/native-main.json
# 同一冻结版本修复环境后定向复验，显式关联首次失败：
bun run test:native --candidate dist/packages --case N5 --retry-of /tmp/native-main.json --report /tmp/native-N5-retry.json
# 推 tag 前由发行 Agent 按改动确定必需集合，显式提供全部相关报告：
bun run test:native --verify-report /tmp/native-main.json --verify-report /tmp/native-N5-retry.json --source <冻结提交40位> --required-cases N1,N4,N5,C-codex,C-claude
```

main 中途失败后未运行的案例需分别执行并把报告传给校验器；缺项、失败未被显式复验、重复成功或输入不一致均拒绝。代码修复改变受测输入时重新冻结和构建，旧输入的失败证据保留，不冒充同版本复验。报告绑定实际受测包/程序摘要、产品及验收 Git 输入、HAPI pin、Bun、平台、原生版本及模型选择；不扫描历史目录。其保障是冻结源码级模型验收，公开 CI 重建的二进制另由安装和集成验证，不声称字节相同。当前 CI 不消费本地模型报告、不托管模型凭据，发行 Agent 在推 tag 前负责核对。

## 实测边界

真实模型组合和失败处置见[原生主链验收](project/archive/2026-10-03-test-backbone-slimming/acceptance.md)，长路径与退出修复见[HAPI 专项验收](project/archive/2026-10-10-hapi-session-and-shutdown/acceptance.md)，四平台公共安装/完整卸载和匿名安装见[1.1.4 发行验收](project/archive/2026-10-12-npm-uninstall-release/acceptance.md)。证据只属于对应候选，后续安装或文档验收不增加模型覆盖。

四平台托管安装不代替用户 Mac 实机、Mac/arm64 模型、物理跨机/WAN 或生产 TLS 实测；同机多 Runner 不等于物理远端。规范 `X.Y.Z-beta.N` 的发布/不晋级与官网 Beta 跳过只有[本地夹具证据](project/archive/2026-10-02-npm-beta-publishing/acceptance.md)，稳定版本上传 beta 再晋级不等于已经实际发布该类预发行版本。

[发布提速验收](project/archive/2026-10-13-release-throughput/acceptance.md)和[验收优化记录](project/archive/2026-10-13-release-validation-efficiency/execution.md)保留专项开发证据。各次正式发布的实际结果、耗时和失败恢复从 [GitHub Actions](https://github.com/iTgo-lyq/runweft/actions/workflows/npm-publish.yml) 查询，见[发布证据与排查](#发布证据与排查)。

## npm 发布与恢复

公开发布按用户授权执行。更新根版本与包内说明、完成验收并提交后，推送匹配的 `vX.Y.Z` 或 `vX.Y.Z-beta.N` tag 触发 `npm-publish.yml`。npm 先上传 beta，经所需公共集成和四平台安装及完整卸载 gate 后，稳定版本晋级 latest；官网从稳定 tag 起并行更新，最终等待两端验收成功。稳定版本的 beta 是等待完整验收的公开候选；预发行保持 beta，不部署官网。

集成、安装或晋级失败只重跑失败 job，保留原 beta 包与候选。公共候选读取在共享十分钟预算内恢复传播 404、限流和明确网络中断，仍核对原 SHA-512；鉴权、地址、manifest/hash 错误和确定性验收失败直接停止。工作流修复后，从最新 main 手动恢复原 tag 和原 run：

```sh
gh workflow run npm-publish.yml --repo iTgo-lyq/runweft --ref main \
  -f 'release-tag=<原版本tag>' -f 'source-run-id=<原run编号>'
```

手动参数全部留空只预演。恢复必须取得原候选描述、上传及成功的上传前检查证据，并核对来源、摘要和 packageInputs；包内说明、package.json 等输入变化后，不能从当前 main 恢复旧候选，应为下一版本重新冻结构建。部分公开、日志不可取得或上传结果未知时停止，不盲目重发。beta 是公开渠道，已公开版本不能覆盖。

调整验收脚本后，可以只读验证已公开的原候选：`gh workflow run npm-publish.yml --ref <验收分支> -f verify-run-id=<原发布run编号>`。包输入必须仍与原候选完全相同，并有原 run 的成功上传前证据；该模式实际执行全部公共分片、四平台安装/完整卸载及稳定版网页安装，跳过构建、上传、晋级和官网部署。不能同时填写 release-tag 或 source-run-id。所有手动参数均为空时仍是本地候选预演。

缺少标签权限时，逐包检查 npm 的 `/package/<包名>/access` Trusted publishing：仓库 `iTgo-lyq/runweft`、文件 `npm-publish.yml`、environment 留空，同时允许 `npm publish` 与 `Allow npm dist-tag`。权限修复后只重跑 promote。

稳定正式发行的官网与 npm 并行启动，从不可变 tag 读取版本后 dispatch 最新 main，绑定预期版本、发布 run/attempt 和显式 parallel 模式；此模式允许官网短暂显示尚不可安装的版本。官网仍须通过唯一 URL、正式域名十文件和三页桌面/手机浏览器验证，npm 的公共验收和晋级门禁保持完整；最终 summary 要求两端成功。预发行、空参数预检及 verify-run-id 不部署官网。普通官网 push/手动入口保留 npm 就绪前置，源码版本不符或 main 已推进时拒绝旧运行。

官网短暂旧摘要在每地址三分钟预算内重读，最终仍须完全匹配。官网失败只恢复官网，不重发 npm；触发或上传结果未知时先查 Actions/Pages，不盲目重发，也不用旧生产提交回退网站。已保存上传回执且静态文件未变时，使用 `gh workflow run website-pages.yml --ref main -f verify-run-id=<原官网run-id>` 只复验原部署。若 npm 最终失败，官网可能领先直到定向恢复完成，整体不能报告成功。

## 发布证据与排查

发布证据由 CI 自动保存在 [npm publishing 工作流](https://github.com/iTgo-lyq/runweft/actions/workflows/npm-publish.yml)的日志和 Actions Summary。按 tag 找到运行，先查看各 job 结果和 `summary` 汇总，再沿关联 run/job 链接排查官网或专项验收。发布后无需 Agent 编写版本报告，也无需额外提交；仓库不再维护 `docs/releases/`，既有报告可从 Git 历史查询。

`summary` 汇总所有 attempt 和关联官网 run 的候选、验收、重试及 job 排队/运行时长，继承成功 job 不重复计时。Summary 显示运行列表与证据数量，`summary` job 日志中的 `RUNWEFT_RELEASE_SUMMARY` 是结构化摘要，逐条 `RUNWEFT_RELEASE_EVIDENCE` 包含候选描述、脱敏验收、公共读取重试和晋级结果。时间字段或日志缺失明确标记，汇总时自身未结束的时间仍为未知；日志暂不可取时仅恢复 summary，不重发 npm，也不把 runner 运行时长推断为计费额度。

可通过 CLI 定位运行并读取原始 job 日志；`gh run view --log` 未显示内容时使用 REST 接口：

```sh
gh run list --repo iTgo-lyq/runweft --workflow npm-publish.yml
gh run view <run-id> --repo iTgo-lyq/runweft
gh api 'repos/iTgo-lyq/runweft/actions/runs/<run-id>/jobs?per_page=100' \
  --jq '.jobs[] | select(.name == "summary") | {id, html_url}'
gh api repos/iTgo-lyq/runweft/actions/jobs/<job-id>/logs
```

仓库 Actions 保留期在 2026-10-14 核对为 **90 天**，以 Settings → Actions → General 的实际配置为准。GitHub 会按[留存策略](https://github.blog/changelog/2026-10-01-actions-retention-now-covers-checks-runs-and-statuses/)清理过期运行、日志等数据；这些记录用于保留期内排查，不保证永久可用。需要跨保留期的专项分析时，在对应 Change 中按需记录结论与必要证据，不将每次发布的完整记录复制入库。
