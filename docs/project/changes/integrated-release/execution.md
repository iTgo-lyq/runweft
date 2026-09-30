# 完整发行执行概况

## Plan 评审

唯一一次 iclaude 只读评审在当前工作区完成，session `f9107373-19ce-4d6e-ac1f-a9956a75b81d`，2026-09-30 13:22（Asia/Shanghai）开始，exit 0、result success、is_error=false。使用专用 Claude 配置副本、Read/Glob/Grep，无新增 reviewer、模型执行实验或用户配置修改。原件 `.dev-smoke/reviews/integrated-release/review.md`。

| 意见 | 主 agent 判断 |
| --- | --- |
| 保存旧版包，防止新目录混入旧 tarball；升级须从旧程序数据开始 | 采纳。保留 C11 最终 0.1.0 产物与索引，新增版本从独立暂存打包；旧数据验证升级，新数据补充兼容回退。 |
| 包内说明在 T1 定稿，T4 修改会改变包 hash | 采纳。开发说明不进入用户入口；确需修改包内内容时重做打包/安装，程序 hash 相同的模型证据可复用。 |
| 当前最终候选缺少 MCP 卸载/恢复明确断言 | 采纳。增加已安装 CLI、预置其他 MCP 的专用配置验收，保持无模型和用户配置不变。此前 C3 验证仍有效，但不冒充最终候选证据。 |
| CI install jobs 也缺 smoke 的 SDK 依赖 | 采纳，源码确认 smoke-install 直接 import MCP SDK。build/install 两处依赖顺序一起修正；未 push/触发 CI 时不声明当前工作流通过。 |
| Linux arm64 运行证据不能由格式检查替代 | 采纳。寻找可自动执行的本地仿真，分别记录编译、仿真和原生结果。 |
| 限制清单及许可证决策 | 采纳事实记录：固定 HAPI 的一个环境性测试失败、Mac/物理远端/CI/Nginx 实测范围如实披露。保留包内 HAPI 原始许可证和匹配源码，不代选 Runweft 开源许可证；这影响未来公开发布安排，不新增本地产物交付确认门禁。 |
| 简化矩阵并提供校验文件 | 采纳明确脚本分工与二进制 hash；20 组核心协作加独立附件/控制验证，输出 SHA256SUMS。Mac 给单一平台包安装入口，说明未签名/公证事实。 |

四个任务保持独立；C11 已验收归档。用户明确接手 Mac 实机验证，Playwright 环境已通过真实运行，原阻塞解除。

## T1 四平台发行包与可复现安装

- 结果：0.1.0 程序、完整四平台包及索引先保存在 `.dev-smoke/release-baseline-0.1.0/`，包含收集时 revision 和程序/索引 hash。1.0.0 打包使用独立暂存，成功后替换旧目录；索引绑定源码 revision/dirty、固定 HAPI、程序 SHA-256 和 tarball SHA-512，另有 `SHA256SUMS`。源码工程继续 private，生成包允许发布但未上传。
- 文档：用户说明与开发验收分开；主包和平台包均携带使用说明，Mac 使用校验后直接解包、保留相邻程序并建立统一命令入口。未签名/公证、Mac 用户实测、物理远端和 Nginx 示例的范围保持明确。
- 干净源码：`.dev-smoke/c12-clean-vq11aa8w/validation.log` 中 root/HAPI frozen install、typecheck 和 173 项根测试通过。当前工作区 types/173 项根测试/配套 build 通过；日志为 `.dev-smoke/c12-t1-{types-final,tests,build}.log`。固定 HAPI 源码保持干净，不重复声称其已知环境性测试全绿。
- 安装：新增 `test:packages` 检查四平台格式/架构、程序与包 hash、完整许可及源码版本，并在原生平台从 tarball 解包后通过符号链接运行真实 local/Hub 服务。npm smoke 使用专用原生目录与真实 Codex 编辑器，验证两次 install、两次 uninstall、stdio 握手及恢复到逐字节相同原配置；其他 MCP、注释、模型设置、权限与 hooks 保留，不调用模型。
- 失败处理：`.dev-smoke/c12-pack-failure/evidence.json` 明确注入 npm pack exit 42，确认已有交付索引不变、暂存清理。第一次注入被本机 Bun 版本管理器重写 PATH 绕过，按实际进程的 Bun 原生路径修正后才得到有效失败证据。首次包验证脚本自身的符号链接与主包解包目录重名已修正；不把这两次实验记录为通过。
- Linux arm64：`.dev-smoke/release-arm64/evidence.json` 使用 QEMU 7.2.22 执行 Runweft/HAPI 版本、配置初始化/检查/路径和 Agent 创建/列表，均通过。没有原生 arm64、仿真服务进程树或模型执行证据；没有安装系统包、注册 binfmt 或启动 Docker。
- CI：build job 在 types/tests 前安装 HAPI 依赖；install jobs 安装 smoke 使用的根 SDK；新增包校验与 SHA256SUMS 归档。未 push 或触发 CI，不声明这些修改已在 GitHub 执行。
- 最终 T1 产物验证：`.dev-smoke/release-packages-34ZPVm/evidence.json`、`.dev-smoke/install-KbTOKB/evidence.json` 和 `.dev-smoke/release-arm64/case-x4hsbvk7/evidence.json` 全部 success；服务证据 `.dev-smoke/install-KbTOKB/services/service-Ly0ir7/evidence.json`。早期通过的同类记录保留，最终两种 Linux 程序 hash 与当前四平台索引一致。Mac 只完成格式/架构/包检查，未作实机运行断言。
- Commit：`integrated-release T1: build four-platform release and verify installation`

## T2 正式候选的完整协作组合

- 候选：来自 T1 提交 `ebd69e8c424ae25aec1e33379ec01f4c87b8992a` 的干净源码，固定于 `.dev-smoke/c12-final-candidate.json`。正式安装 `.dev-smoke/install-fsi0Hn/evidence.json` 通过，实际安装程序 SHA-256 为 Runweft `e681e8f801c81c31de0788b8901609d2a6b1576d4715cb6485b5348033bc4de3`、HAPI `e8cd31cd6d36e56a9b99143d7e7a752f65b6f4c30b5b72d03862651236d52b17`。四平台程序与 T1 最终验证一致，复用格式、独立服务及 arm64 仿真证据；本次 tarball/index 的 SHA256SUMS 重新通过核对。
- 结果：核心 20 组、附件 8 组及 MCP 控制 2 组全部通过；每组开始/结束绑定上述程序 hash，使用专用配置与认证副本。汇总 `.dev-smoke/c12-matrix/completed.json`，各组 cleanupErrors 为空。

| 实际验收 | 证据 |
| --- | --- |
| shared 8/8：local/Hub × 两宿主 × 两 runtime，同 session 续接、原生工具过滤、进程退出和两种宿主真实连接中断 | `.dev-smoke/collaboration-uJirbo/evidence.json` |
| 本地 worktree 8/8：工程指令/skill/其他 MCP、固定基线、封存、显式 cherry-pick、现场留存和连接中断 | `.dev-smoke/worktree-mcp-ok0yFo/evidence.json` |
| 远端 worktree 4/4：启动前准备，两轮输入/输出、递归子模块与 Git/LFS、MCP fetch、执行端离线后再取回和显式 merge | `.dev-smoke/remote-mcp-bLWnpq/evidence.json` |
| 附件 8/8：实际 MCP 上传、输入、输出、补交/补收、下载及第二轮；Hub 两个交叉组合使用 worktree | `.dev-smoke/artifact-mcp-IJ8Mx6/evidence.json` |
| Codex：MCP steer 追加与定向 interrupt，4 个业务轮次 | `.dev-smoke/collaboration-es37sR/evidence.json` |
| Claude：明确 steer_unsupported，定向 interrupt；未伪称支持追加 | `.dev-smoke/collaboration-DNLp57/evidence.json` |
| 无模型远端回收：重启中心/发起端，四任务两轮查询/下载/取回，目标离线，原生 session 清单不增加 | `.dev-smoke/remote-package-L4LYn9/evidence.json` |
| 无模型附件回收：重启服务后，8 组两轮的报告、原生 ID、清单及输出 hash 不变，worktree 保留 | `.dev-smoke/artifact-package-nKiP8c/evidence.json` |
| Playwright：同一安装候选、真实任务历史，登录/恢复、筛选分页、失败恢复、375/1200 布局、HAPI 详情；pageErrors/cleanupErrors 为空，截图已目视检查 | `.dev-smoke/dashboard-ntKUUm/evidence.json` |

- 环境修正：首轮四个矩阵均在任何 MCP 调用/任务派生前失败；原生 JSONL 明确返回当前账户不支持继承的 `gpt-6.1-sol`。无任务轮次、cleanupErrors 为空，失败原件 `.dev-smoke/c12-matrix-initial-unavailable-model/`。按原生模型目录和 C10 实测，仅在测试副本显式选择 `gpt-6-astra` / xhigh 后重开；两个脚本新增可选测试参数与实际模型记录，不修改用户配置或冻结产品，不重放未知任务。
- 范围：远端是同机独立 Hub/两个 Runner；Mac 实机、物理跨机和当前 GitHub CI 未执行。看板故障/分页的合成条目与真实已完成任务分开记录。
- 检查：新增测试参数的实际两宿主调用通过；`bun run typecheck`、`git diff --check` 通过。本任务未修改产品代码，无需重建或重复已通过的根测试。
- Commit：`integrated-release T2: verify complete native collaboration on installed release`
