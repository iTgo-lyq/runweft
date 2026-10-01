# 发行验收范围

当前1.1.0的完整源码、可安装产物、程序hash、需求逐项结果和原始证据见[Hub完整验收](../../../archive/2026-10-01-hub-spaces-and-agent-configuration/acceptance.md)。程序候选来自干净源码 `657550f20d44d1a65a48b232ef13f3ca5160e8cd`；各领域行为以对应Specs为准，本页只限定本批组合证据。

## 已验证组合

Linux x64 从实际 npm 安装后的同一 Runweft/HAPI 候选，使用专用原生配置与认证副本完成：

| 范围 | 证据覆盖 |
| --- | --- |
| 安装与维护 | npm安装/重装/卸载留存、平台包独立服务与相邻HAPI、两宿主重复MCP安装/卸载/备份恢复、默认Hub/独立Runner、凭据撤销轮换、信号关闭及有界reset |
| 十二组原生MCP | Codex/Claude真实宿主 × Codex/Claude runtime × shared/本机worktree/同机远端；spawn/wait/read、父身份、报告、目标/模式、子CLI递归拒绝与进程退出 |
| 长等待 | 四组shared实际MCP wait 65000ms，测得65010/65039/65195/65176ms后timed_out，不缩短或模拟 |
| 十组消费者 | 两个CLI-managed Runner，共享两轮、确切原生missing重建、本机worktree、跨所有者远端Claude启动前输入/私有附件/bundle取回与显式清理 |
| 停止与恢复 | 两runtime精确轮次中断、拒绝旧轮次控制、原session记忆续接；已安装Hub重启后报告/轮次/原生ID不变，不重跑模型 |
| Web接入/后台 | Playwright五组加密交接、十二组资源/成员/Agent/仓库/个人选择/任务，直接API与计数隔离、390px布局、HAPI短JWT多标签/消息/审批/文件/header-SSE/终端拒绝 |
| 升级 | 专用新建Hub/schema18数据由阶段六1.0.0升级至1.1.0；运行版本差异可诊断，停服升级后身份/机器/Agent/仓库/附件/worktree保留，不承诺旧root迁移或回退 |
| 官网与交付 | 十一组真实Skill/平台下载、hash、子路径、320–1440px/键盘/无JS、DOM命令安装及坏hash阻止；完整归档37项校验、解包程序再次服务验证、离线Git源码还原与frozen依赖/typecheck |

类型检查、build、256项根测试（5244断言、41文件）及四平台构建通过。未知执行不重发、准备失败不启动、权限竞态、只重试交付和更高schema拒绝采用故障fixture；后台部分历史/session RPC及terminal/fork协议也是明确夹具，不冒充真实OS PTY或模型。Codex支持当前追加输入，Claude返回 `steer_unsupported`，不将runtime描述为能力完全相同。

Skill与阶段六已验收版本逐文件相同，复用独立Agent判断场景；新候选安装、加密接入与真实首任务重新执行。代码/程序hash不同不可沿用旧1.0.0认证组合的证据。

## 公共 npm 与可信发布

公共五包 1.1.0 已完成真实上传、公开元数据/下载完整性和匿名 Linux x64 安装验证；公开候选来源为 bfa2df88531a2f997038817c901d89ca9cab491e，四平台程序/Skill 与原离线候选相同，见[npm 发布验收](../../../archive/2026-10-01-npm-publication/acceptance.md)。

[可信发布 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36864700225)验证新的干净候选 fe6017e531f06c0c01980d362b8b5b32bc6fde71：类型检查、264 项根测试、四平台构建/包校验，以及 Linux x64/arm64、macOS x64/arm64 托管 runner 的真实安装、默认服务与信号检查通过。绑定前的授权失败后只重跑失败 job，attempt 2 复用原候选；五包 OIDC 交换均 HTTP 201，预演 success=true、published=false。脱敏绑定和回执见[可信发布验收](../../../archive/2026-10-01-npm-trusted-publishing/acceptance.md)。

main 合码提交 `0c3e3a1bd7a70a24be9e13ad4b022dc7f4504d60` 通过[独立 CLI CI](https://github.com/iTgo-lyq/runweft/actions/runs/36912561656)：类型检查、四平台构建/包校验及各平台真实安装、默认服务、信号退出与清理通过。根测试共 265 项、43 文件、5280 断言，263 项通过、2 项跳过、0 失败；托管 runner 未提供原生 Codex CLI，两项 MCP 配置测试按既有条件跳过。

同一提交的 [npm 工作流](https://github.com/iTgo-lyq/runweft/actions/runs/36912562431)另行构建干净候选并通过四平台检查；五包 OIDC 交换均 HTTP 201，预演 success=true、published=false，版本保持 1.1.0。普通 main 推送没有上传新包；官网生产验收见[产品官网](../../website/product/spec.md)。

这批 CI 没有运行模型、网页组合或公开新版本；新候选不继承旧候选的模型/实机验收。稳定标签门禁、冲突与部分发布恢复通过聚焦模拟验证，真实新版本上传尚未执行。

## 尚未取得的证据

- 原公共 1.1.0 候选的 macOS 两架构完成构建、格式/架构及包内容校验；最终模型/用户实机验证尚未执行。新 CI 候选另有托管 macOS 安装/服务证据。
- 原公共 1.1.0 候选的 Linux arm64 经 QEMU7.2.22 验证两程序版本、初始化、配置、路径、缺Hub错误、reset预览/应用与重新初始化；新 CI 候选另有原生 arm64 安装/服务证据，两者均未验证 arm64 模型组合。
- 物理跨机器及实际网络组合按用户授权延期；同机多 Runner 不替代物理远端验收。
- 生产 Nginx/TLS 部署未运行，HAPI 全套测试未执行，不能宣称上游全部通过。

用户全局配置保持不变；本机原生模型可用性与测试副本的实际选择记在验收记录中，不把某账户可用的模型设为产品默认。上述证据边界不减少已经实现的功能或省略对应平台产物。
