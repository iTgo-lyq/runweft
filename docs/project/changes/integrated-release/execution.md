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
