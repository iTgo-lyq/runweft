# 发行验收

## 验证入口

| 层级 | 当前入口与范围 |
| --- | --- |
| 核心 | `bun run typecheck`；`bun run test` 显式运行 `./test`，不运行模型或 HAPI 全套测试 |
| Node | `node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs`；发布、CI 选择与官网保护，避免 Bun 和 Node 重复执行同一文件 |
| 无模型集成 | `test:integration access\|storage\|web\|service-package [CLI]`；真实 HAPI/Runner、Playwright、文件/Git 与候选安装，各脚本独立现场 |
| 原生 | `test:native <已安装CLI> preflight\|all\|N1..N6\|C-codex\|C-claude\|R-codex\|R-claude [前次证据]`；六主链与两 runtime 的控制、缺失重建 |
| 扩展 | `test:native <CLI> expanded`；身份/native 映射、HAPI/原生版本或 workspace 行为改变时扩到相关四配对，最多十二组合 |
| HAPI 专项 | `test:execution` 与 `bun scripts/smoke-hapi-session-and-shutdown.ts [CLI]`；执行关联、真实 Claude 长 cwd 续接、Runner 退出码/状态/锁/控制端口、Hub 无 ACK/停服及启动失败/重启 |

原生及 HAPI 专项调用模型，只在已有授权和专用认证环境运行。机器轮换要求旧 Runner 退出 0 并完成清理。

## 原生主链与证据复用

| 主链 | 保障范围 |
| --- | --- |
| N1 | local/shared，Codex→Codex，两轮、65 秒 wait、真实历史页面与重启无重放 |
| N2 | hub/shared，Claude→Claude，两轮、65 秒 wait 与另一 runtime 的真实历史页面 |
| N3 | hub/worktree，Codex→Claude，工程指令/Skill/MCP、固定 base、实际 hook 失败后的 retry_finish |
| N4 | local/worktree，Claude→Codex，两轮输入输出、原生继承、无变更不创建提交 |
| N5/N6 | hub/remote，两个交叉配对、两 Runner、二进制输入输出、Git/模块/LFS、实际 MCP 下载/取回、离线恢复与显式合入 |
| C/R 专项 | 两 runtime 的实际审批允许/拒绝、精确 interrupt、Codex steer/Claude 不支持、真实 missing 重建；新输入保留原记忆，原始历史 hash 不变 |

模型前检查安装 launcher/core 与 HAPI 身份、浏览器、两轮 fixture 的读写/消费者契约、三个消费者的失败证据出口及 local/hub 空原生配置接线。一个主链 case 只有生产、消费、清理全部成功才可复用；未知结果不重发。

入口按候选、脚本/helper、原生配置和模型选择指纹拒绝不同输入的自动复用，不兼容旧 evidence 格式，不自动整组重试。分阶段工程判断与定向续验单列证据，不改写失败 ledger；确认成功现场停机后回收，源原生配置摘要保持不变。

## CI 与公开交付

普通 push/PR 共用一次核心准备，按 diff 选择 Linux 集成，未知路径保守全选。正式 tag 或 main 显式 release-tag 构建完整四平台候选，完整根/Node/Linux gate 不按 diff 跳过；同一构建 job 先上传 beta，四平台公共 npm 实际安装和完整卸载全部成功后，稳定版本才晋级 latest，`X.Y.Z-beta.N` 保持 beta。详细发布与恢复规则见[发行规格](../distribution/spec.md)。

发布、核心 CI 与官网不依赖 Actions artifact；脱敏证据保存在日志/summary 及仓库归档。平台安装核对精确公共包、摘要、配对程序、MCP/Skill、默认服务和信号、重装/npm 卸载保留；完整卸载另验证 Hub/双连接 Runner/登记进程停止、预览与拒绝、删除失败重试、程序/接入/数据/备份删除和其他配置/凭据/源项目保留，独立平台包也实际自删除。

## 已有证据与实测边界

[原生主链验收](../../../archive/2026-10-03-test-backbone-slimming/acceptance.md)保存组合、候选及失败处置；[HAPI 专项验收](../../../archive/2026-10-10-hapi-session-and-shutdown/acceptance.md)保存长路径与退出修复的真实证据，当前发行包含该修复。[1.1.4 公开发行验收](../../../archive/2026-10-12-npm-uninstall-release/acceptance.md)保存四平台托管安装与完整卸载、匿名 Linux x64 DOM 安装/Skill 核对及官网摘要/浏览器证据。候选 hash、测试计数和原始失败过程以各自归档为准。

模型协作证据只属于对应候选，后续安装/卸载验收不自动增加模型覆盖。托管四平台安装不代替用户 Mac 实机、Mac/arm64 模型、物理跨机/WAN 或生产 TLS 实测；同机多 Runner 不等于物理远端，历史 QEMU 只验证基本命令。上述未验证范围继续保留。

`X.Y.Z-beta.N` 发布/不晋级门禁和官网 Beta 跳过仅有[本地夹具证据](../../../archive/2026-10-02-npm-beta-publishing/acceptance.md)，尚未真实发布该类预发行版本；稳定 1.1.4 的 beta 上传与 latest 晋级有真实执行证据。
