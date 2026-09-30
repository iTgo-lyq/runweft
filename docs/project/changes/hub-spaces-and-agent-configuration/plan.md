# Hub 完整版本最终集成计划

> 来源：[Requirement](requirement.md)
> 技术方案：[Technical](technical.md)
> 状态：执行中
> 执行模式：同工作区串行，逐任务独立提交；正式方案/计划一次 iclaude 评审。

## 交付目标

基于已验收前六阶段交付完整 1.1.0：同一已安装 Runweft/HAPI 程序验证 Hub 身份、配置、后台、两宿主/两 runtime、本地/同机远端与维护，提供真实四平台、Skill、源码和静态下载。Mac 实机/物理远端边界不伪造。

### T1 当前安装与维护验收入口

- 状态：已完成
- 交付：轻量服务 smoke 与 registry 安装改用 Hub 独立身份/机器；删除旧 YAML/root 续验分支；MCP 专用配置保留、升级式重装、缺包诊断、数据根和显式 reset；阶段六程序以专用新数据验证升级，不复用旧 root 历史。
- 依赖：前六阶段归档。
- 验收：平台/registry 程序不靠开发 HAPI override 或产品 PATH 中的 Bun；服务/信号/重启可用，身份/root 不混同，安装不动用户全局配置。
- 验证：当前包聚焦安装/服务/MCP smoke、typecheck；本任务候选仅用于修正入口，最终冻结后重跑。

### T2 已安装程序的真实协作组合

- 状态：待开始
- 交付：消费者与连接 Playwright 改为默认编译 Hub 服务；两 runtime 停止、重启读取不重放；MCP 四组 shared 加本地/同机远端 worktree 共十二组，沿用现有真实原生脚本。
- 依赖：T1。
- 验收：执行服务不由源码 gateway 代替；明确身份、仓库与资源，真实报告/模式/进程退出；续接和确切缺失重建，附件/bundle取回不合入、不重发 unknown。
- 验证：typecheck、相关根测试、消费者与原生组合聚焦运行，记录程序路径/hash；最终全量在 T4 完成。

### T3 冻结同版四平台发行候选

- 状态：待开始
- 交付：1.1.0、当前包内说明/Skill与开发入口、CI清单、完整交付装配入口；干净源码统一构建四平台和校验索引。
- 依赖：T2。
- 验收：四平台实际构建，HAPI pin/架构/许可/源码及 Skill 一致；不能把旧1.0.0包重命名为新版本。
- 验证：typecheck、根 `./test`、build；提交包内容后构建 `package --all --reuse-hapi`，校验候选与后续非产品改动的边界。

### T4 同候选自动验收

- 状态：待开始
- 交付：最终平台/registry安装、两宿主专用 MCP、真实十二组 MCP 与消费者、Web接入/后台、Linux arm64 QEMU和官网验收；需求逐项映射与真实失败/返修证据。
- 依赖：T3 冻结候选。
- 验收：同一已安装程序及相邻 HAPI hash覆盖全部本地目标；重跑不得冒充此前未知执行成功，所有自建服务清理有结果。
- 验证：`test:packages`、`test:install`、`test:hub-native-mcp`、`test:hub-consumers`、`test:hub-connect`、`test:hub-console`、QEMU当前包命令、官网 Playwright；基础检查结果绑定同源码。

### T5 完整交付与关闭验收

- 状态：待开始
- 交付：本地完整发行目录/归档、源码与固定HAPI、静态网站、校验和、包内使用路径和不含秘密的验证说明；最终 Acceptance 与需求完成映射。
- 依赖：T4。
- 验收：从交付物可定位实际程序/Skill/下载和证据，所有本地功能已实现/验收；外部缺口明确，不要求公开发布或更新在线服务。
- 验证：交付索引/hash/解包、文档链接、Change校验、Git/HAPI干净；随后同步当前Specs并独立归档父Change。

## 候选变更规则

产品代码、包内文档或Skill在冻结后变化即重新构建并复验受影响链路；仅验收脚本及项目记录变化不改变候选程序。任务提交分别记录，不为记录当前hash追加bookkeeping提交。执行事实与失败边界保存 Execution/Acceptance。
