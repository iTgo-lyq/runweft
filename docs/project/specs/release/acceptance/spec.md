# 验收选择与当前证据

第二轮测试瘦身已完成[本地自动验收](../../../archive/2026-10-03-test-backbone-slimming/acceptance.md)，具体删留保障与首次失败见归档。该次产品源码、权限和HAPI未改；旧的完整矩阵结果保留在[第一轮验收](../../../archive/2026-10-02-module-slimming-audit/acceptance.md)，不冒充本轮已执行组合。

## 验证入口

| 层级 | 当前入口与范围 |
| --- | --- |
| 核心 | `bun run test`显式运行`./test`；类型检查独立；不运行模型或HAPI全套测试 |
| Node | `node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs`；发布/CI选择/官网保护，避免Bun和Node重复执行同一文件 |
| 无模型集成 | `test:integration access\|storage\|web\|service-package [CLI]`；真实HAPI/Runner、Playwright、文件/Git及候选安装，每脚本独立现场 |
| 原生 | `test:native <已安装CLI> preflight\|all\|N1..N6\|C-codex\|C-claude\|R-codex\|R-claude [前次证据]`；六主链与两runtime各自的控制/缺失重建 |
| 扩展 | `test:native <CLI> expanded`；身份/native映射、HAPI/原生版本或workspace行为改变时扩到相关四配对，最多十二组合；HAPI执行层另保留`test:execution`专项 |

模型前实际检查安装launcher/core与HAPI身份、浏览器、两轮当前fixture的读写/消费者契约、三个消费者的失败证据出口、local/hub空原生配置接线。一个主链case只有生产、消费、清理全部成功才可复用；未知结果不重发。入口按候选、脚本/helper、原生配置及模型选择指纹拒绝不同输入的自动复用，不提供旧evidence格式兼容或自动整组重试。已完成阶段的人工工程判断与定向续验必须单列证据，不能改写失败ledger。

## 测试瘦身候选验收

干净四平台候选为1.1.1、源码 `6a7e559fc878989c91280213e6cdd54c27fcc110`，HAPI `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。Linux x64通过专用npm registry安装；Runweft core SHA256 `c72c11210578c8db6341d60f8d0f0996c0c42fb3b1a1f66fb129229abfb38be0`，HAPI SHA256 `bdf706d7966ae4818b09029991a2bb03e70b10b0555763fc41430afd977b4fec`。后续验收/CI/项目记录调整没有改变packageInputs，未重复构建。

核心最终248项通过、33项Node检查通过；typecheck、actionlint、四平台包核验、Linux安装/服务、access/storage/web及arm64 QEMU基础检查通过。核心247项曾在三个新现场连续通过，新增出口回归另在多个新现场通过，最终完整248项只跑一次；不声称三次完整248项或显著根测试提速。

| 原生链 | 已实测组合及独立保障 |
| --- | --- |
| N1 | local/shared，Codex→Codex，两轮、65秒wait、真实历史页面及重启无重放 |
| N2 | hub/shared，Claude→Claude，两轮、65秒wait、另一runtime真实历史页面；生产与修正后的消费分阶段通过 |
| N3 | hub/worktree，Codex→Claude，工程指令/Skill/MCP、固定base、实际hook失败后retry_finish |
| N4 | local/worktree，Claude→Codex，两轮输入输出、原生继承、无变更不创建提交 |
| N5/N6 | hub/remote，两个交叉配对，两Runner、二进制输入输出、Git/模块/LFS、实际MCP下载/取回、离线恢复与显式合入；N5外层证据路径错误保留失败记录，生产/消费事实均通过 |
| 两runtime专项 | 实际审批允许/拒绝、精确interrupt、Codex steer/Claude不支持、真实missing重建；原生JSONL证明一次新输入带原记忆，原始历史hash不变 |

六主链最终104次MCP工具调用，连同失效N1和失败N2共119次；这不是模型请求/token计数。首次完整gate为7/10通过，四次意外失败出口均有定位和定向修正，没有掩盖首次失败；细节与可计时时间见验收。成功现场确认停机后删除，源原生配置摘要保持不变。同机多Runner不等于物理远端。

## CI与公开交付边界

普通push/PR执行一次核心准备及按diff选择的Linux集成；路径未知保守全选。正式tag或main显式release-tag构建完整四平台候选，完整根/Node/Linux gate不按diff跳过；同job先上传beta，公共npm四平台实际安装和完整卸载全部成功才晋级latest。发布/核心/官网证据保存在日志/summary及仓库摘要，不依赖Actions artifact。实际main及1.1.4流程已通过，见[本次验收](../../../archive/2026-10-12-npm-uninstall-release/acceptance.md)。

1.1.4公共候选源码为 `3f873788b11926d2e51c9ccf9f3f661dc239ab6a`，HAPI为 `8f774b9413fd483bc163cc06425d7646f10a7c92`。四平台托管runner均通过精确公共npm安装、摘要/配对程序、MCP目录、默认服务/信号、重装/npm卸载保留及各8组完整卸载；五包latest/beta=1.1.4。完整卸载包含两个真实Hub、同home双连接Runner、当前和恢复记录中的登记控制测试进程、MCP/Skill/数据/全部备份删除、失败重试及其他软件配置/模型凭据/源项目保留；独立平台包也实际自删除。Linux x64匿名五包下载、实际网页DOM安装、主/平台六Skill文件/README核对，以及生产官网十文件摘要/MIME和三页Playwright通过。当前Linux Runweft SHA256 `e9b01c1c70d1fda1b0dbd565e233c383ba3a07abf864c7870dd35f703214727d`，HAPI SHA256 `269d3f183b7bdcb17839bd688769d3c6a88e56a1d2f605c6f791b83bbb7dc16e`。

历史模型协作范围仍属于各自候选；本轮不追加模型调用，不以托管安装替代Mac/arm64模型、用户物理机器或跨机/WAN实测。旧候选记录见[npm首次发布](../../../archive/2026-10-01-npm-publication/acceptance.md)、[1.1.1发布记录](../../../archive/2026-10-02-npm-patch-release/acceptance.md)和[Beta配置验收](../../../archive/2026-10-02-npm-beta-publishing/acceptance.md)。X.Y.Z-beta.N尚未真实发布，其版本/不晋级门禁为本地夹具证据；稳定1.1.4的beta上传及晋级为真实执行。

测试瘦身候选未执行expanded十二组合、HAPI全仓测试、Mac实机安装/模型、arm64原生服务/模型、物理跨机/WAN或生产TLS；QEMU仅验证基本命令。当时Claude长cwd历史缺口仅用专用短路径避开，现已由下述HAPI修复。


## 2026-10-10 HAPI修复候选

当前源码固定HAPI `8f774b9413fd483bc163cc06425d7646f10a7c92`；Claude长cwd历史定位和Runner有界退出已完成[本地自动验收](../../../archive/2026-10-10-hapi-session-and-shutdown/acceptance.md)。Linux x64同候选构建、248项核心、33项Node、typecheck、access四脚本及真实Claude两轮续接通过；HAPI CLI全量3049项、Runner串行集成及独立session保留验证通过。

新增专项入口`bun scripts/smoke-hapi-session-and-shutdown.ts [CLI]`验证实际Runner退出码/状态/锁/控制端口、Hub无ACK/停服、启动失败/重启及真实Claude长cwd续接；它调用模型，仅在已有授权和专用认证环境运行。access的机器轮换验证严格要求旧Runner退出0并清理，不再接受旧退出1例外。

当前公共1.1.4包含固定HAPI修复；该专项的模型与退出证据见归档，公开候选的四平台安装与完整卸载范围以上述1.1.4记录为准。历史1.1.1及离线交付保留原字节。
