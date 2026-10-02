# 发行验收范围

当前源码瘦身候选的完整验证见[模块瘦身验收](../../../archive/2026-10-02-module-slimming-audit/acceptance.md)。四平台包来自干净提交 `e3553755c321c4e7981185ba5aa9bf3308544605`，包版本1.1.1；本Change没有发布该候选。后续仅修正验收fixture，未改变包输入。原公共1.1.0证据保存在[Hub完整验收](../../../archive/2026-10-01-hub-spaces-and-agent-configuration/acceptance.md)，不代替当前候选验证。

## 当前候选已验证组合

Linux x64使用从本次npm包实际安装的同一Runweft/HAPI，专用原生配置和认证副本。core SHA256为 `09bf189c4a0115b9f1badbf5991cb86d6665b6f42b7b22ca93468dc309e29ba3`；HAPI为 `bdf706d7966ae4818b09029991a2bb03e70b10b0555763fc41430afd977b4fec`，固定revision `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。

| 范围 | 已执行保障 |
| --- | --- |
| 安装与格式 | 四平台包核验；Linux x64专用npm安装/重装/卸载、MCP原配置保留、服务/信号；旧schema18无写拒绝，当前19同候选重启保持身份、配置与任务现场；不再提供data/reset |
| 十二组原生MCP及十组消费者 | 两宿主×两runtime×三模式；父身份、spawn/wait/read、报告、原生历史missing重建、子执行过滤/CLI递归拒绝、精确审批/停止；shared长wait实际等待约65秒 |
| 核心协作 | shared与本机worktree各默认八组合18轮；远端默认四组合八轮及安装消费通过；真实工程指令/Skill/项目MCP、输入输出/Git/LFS、memory resume、固定base/成果、离线fetch恢复与显式合入；另验证明确hook失败后的retry-finish |
| 附件与成果 | 附件MCP八组合16轮及安装消费；Task inputs八轮、outputs八轮→retention；remote Task两runtime四轮→result-retention；72MiB实际文件、bundle/子模块/LFS、固定回执/丢响应/重启、release/discard/外部pin与不重放 |
| Task与工作区生命周期 | 真实双runtime控制、CLI/MCP两轮、原生历史重建；worktree两runtime四轮→重启续接/ignored依赖/无变更不提交/两任务隔离/准备取消/显式移除保留报告与refs/后续send拒绝 |
| Web/身份/资源/实时 | Playwright console17项、身份后台8项、加密接入5项，十二真实完成历史的只读消费；短JWT/到期与401清理、分页/转义/迟到响应/失败保留已有内容；资源10项、配置9项、实时10项及撤权/隔离/重启 |
| 清理与契约 | producer→consumer确认停机/原生PID退出后只回收本次现场，保留原证据；完整CLI契约仅删除授权data树，17MCP工具参数、描述与annotations不变 |

产品源码typecheck、build及255项根测试通过（4811断言、42文件），四平台构建和Node发布测试通过。fixture修正后typecheck及受影响真实场景再次通过；产品包身份不变。部分文件/Git/授权smoke通过当前源码gateway与真实HAPI/Runner执行领域或协议fixture，不冒称全部为编译Task端到端；完整高层Task、MCP、模型和浏览器链使用实际安装候选。Codex追加输入与Claude的 `steer_unsupported` 均保留。

失败试跑、明确模型选择和修正依据见验收记录。远端最终矩阵显式使用gpt-6.1-sol/medium；参数控制另验证gpt-6.1-sol/xhigh与Claude显式model/effort。不将账户可用模型设为产品默认，不改用户模型配置；源配置由每次fixture独立校验开始/结束摘要。

## 公共 npm 与可信发布

公共五包 1.1.0 已完成真实上传、公开元数据/下载完整性和匿名 Linux x64 安装验证；公开候选来源为 bfa2df88531a2f997038817c901d89ca9cab491e，四平台程序/Skill 与原离线候选相同，见[npm 发布验收](../../../archive/2026-10-01-npm-publication/acceptance.md)。

[可信发布 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36864700225)验证新的干净候选 fe6017e531f06c0c01980d362b8b5b32bc6fde71：类型检查、264 项根测试、四平台构建/包校验，以及 Linux x64/arm64、macOS x64/arm64 托管 runner 的真实安装、默认服务与信号检查通过。绑定前的授权失败后只重跑失败 job，attempt 2 复用原候选；五包 OIDC 交换均 HTTP 201，预演 success=true、published=false。脱敏绑定和回执见[可信发布验收](../../../archive/2026-10-01-npm-trusted-publishing/acceptance.md)。

main 合码提交 `0c3e3a1bd7a70a24be9e13ad4b022dc7f4504d60` 通过[独立 CLI CI](https://github.com/iTgo-lyq/runweft/actions/runs/36912561656)：类型检查、四平台构建/包校验及各平台真实安装、默认服务、信号退出与清理通过。根测试共 265 项、43 文件、5280 断言，263 项通过、2 项跳过、0 失败；托管 runner 未提供原生 Codex CLI，两项 MCP 配置测试按既有条件跳过。

同一提交的 [npm 工作流](https://github.com/iTgo-lyq/runweft/actions/runs/36912562431)另行构建干净候选并通过四平台检查；五包 OIDC 交换均 HTTP 201，预演 success=true、published=false，版本保持 1.1.0。普通 main 推送没有上传新包；官网生产验收见[产品官网](../../website/product/spec.md)。

这批 CI 没有运行模型、网页组合或公开新版本；新候选不继承旧候选的模型/实机验收。稳定标签门禁、冲突与部分发布恢复通过聚焦模拟验证，真实新版本上传尚未执行。

## 当前候选尚未取得的证据

- macOS两架构完成构建和包核验，未执行本候选Mac实机安装、服务或模型；历史CI候选的托管Mac安装结果不能移用于本候选。
- Linux arm64使用QEMU验证两程序版本、初始化、配置、路径和无Hub错误；未验证本候选arm64完整服务或模型组合。
- 同机独立Hub/多个Runner的远端组合不替代物理跨机器、WAN或生产Nginx/TLS实测。
- 固定HAPI的过长Claude cwd原生历史定位缺口已经复现；本轮使用专用短路径，不修改HAPI或复制伪造历史。机器撤权后Runner停机可触发HAPI既有一秒兜底exit1，已核确切日志/进程退出与重新连接，未冒称优雅关闭。未执行HAPI全套测试。
- 本Change没有执行远端CI、新包上传或官网部署。

这些证据边界不减少产品能力或省略对应平台产物。
