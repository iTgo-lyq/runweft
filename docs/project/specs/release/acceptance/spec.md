# 验收选择与当前证据

第二轮测试瘦身已完成[本地自动验收](../../../archive/2026-10-03-test-backbone-slimming/acceptance.md)，具体删留保障与首次失败见归档。产品源码、权限和HAPI未改；旧的完整矩阵结果保留在[第一轮验收](../../../archive/2026-10-02-module-slimming-audit/acceptance.md)，不冒充本轮已执行组合。

## 验证入口

| 层级 | 当前入口与范围 |
| --- | --- |
| 核心 | `bun run test`显式运行`./test`；类型检查独立；不运行模型或HAPI全套测试 |
| Node | `node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs`；发布/CI选择/官网保护，避免Bun和Node重复执行同一文件 |
| 无模型集成 | `test:integration access\|storage\|web\|service-package [CLI]`；真实HAPI/Runner、Playwright、文件/Git及候选安装，每脚本独立现场 |
| 原生 | `test:native <已安装CLI> preflight\|all\|N1..N6\|C-codex\|C-claude\|R-codex\|R-claude [前次证据]`；六主链与两runtime各自的控制/缺失重建 |
| 扩展 | `test:native <CLI> expanded`；身份/native映射、HAPI/原生版本或workspace行为改变时扩到相关四配对，最多十二组合；HAPI执行层另保留`test:execution`专项 |

模型前实际检查安装launcher/core与HAPI身份、浏览器、两轮当前fixture的读写/消费者契约、三个消费者的失败证据出口、local/hub空原生配置接线。一个主链case只有生产、消费、清理全部成功才可复用；未知结果不重发。入口按候选、脚本/helper、原生配置及模型选择指纹拒绝不同输入的自动复用，不提供旧evidence格式兼容或自动整组重试。已完成阶段的人工工程判断与定向续验必须单列证据，不能改写失败ledger。

## 本轮实际验证

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

普通push/PR配置为一次核心准备加相关Linux集成，先安装固定Codex以运行真实配置编辑检查；路径未知保守全组。只有tag/手动入口构建完整四平台候选，候选完整gate不按diff跳过，npm在同一run等待平台安装结果。Beta通道、发布回执和官网版本资格保护保留。该配置已通过本地actionlint、真实工具安装及Node选择测试，未触发本轮远端CI。

历史公开交付与不同候选的托管平台结果见[npm首次发布](../../../archive/2026-10-01-npm-publication/acceptance.md)、[可信发布CI](../../../archive/2026-10-01-npm-trusted-publishing/acceptance.md)和[1.1.1发布记录](../../../changes/npm-patch-release/execution.md)。这些结果不迁移成本轮候选的Mac/arm64原生证据；本轮没有发布候选或部署官网。

本轮未执行expanded十二组合、HAPI全套、Mac实机安装/模型、arm64原生服务/模型、物理跨机/WAN或生产TLS。QEMU仅验证当前arm64基本命令。Claude过长cwd历史定位的既有HAPI缺口仍使用专用短路径避开，不修改HAPI或伪造历史。
