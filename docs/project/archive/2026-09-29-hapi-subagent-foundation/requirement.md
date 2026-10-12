# HAPI 内置能力验证与调用封装

> 更新：2026-09-29
> 确认依据：MCP 宿主只支持 Codex/Claude Code；执行侧复用 HAPI 内置适配，不主动改造 runtime。三个项目边界继续有效，私有 runtime 扩展不作为本轮交付前置。
> 实施授权：沿用用户逐 Change 自主落实与自动验收授权；本 Change 的 Technical/Plan 经一次 iclaude 评审后执行。

## Review 导读

- **目标：** Runweft 能通过 HAPI 稳定关联一次执行、投递输入、读取原生结果并控制恢复。
- **范围：** 验证已有 HAPI 执行事实，封装上层调用和兼容性诊断；不承担 Codex/Claude Code runtime 重写或主动改造，也不承载委派与远端 Git 全部实现。
- **现状：** 配套编译版本已通过两种 runtime 的执行、控制与续接验收，启动和输入丢回执不会自动重复执行；逐项证据见 [Execution](execution.md#t4-配套构建与整体验收)。宿主 MCP 和业务委派仍由后续 Change 实现。
- **项目入口：** 完整能力分工、依赖图和待讨论模块见[跨 Change 架构](../../architecture.md)。

## Change 依赖

| 关系 | Change / 资源 | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [统一 CLI](../2026-09-29-unified-cli-and-deployment/requirement.md) | 基础安装、HAPI 连接与诊断可用；不依赖完整业务发行 |
| 外部基础 | 固定版本的 HAPI 构建 | 默认直接使用内置适配；先验证已有能力，不能把关联仓库视为链路已验证 |
| 下游 | [宿主适配](../2026-09-29-host-mcp-adapter/requirement.md)、[委派生命周期](../2026-09-29-delegation-lifecycle/requirement.md)、[本地工作区](../2026-09-29-local-workspace-execution/requirement.md) | 消费执行身份、真实状态和控制入口；各自验收不并入本 Change |

## 独立验收与交付边界

在自动准备的专用 cwd 中，直接通过已有入口验证两种内置 runtime 的启动、输入、原生结果、停止与续接；不要求父子调度、动态 Git 准备或附件先实现。HAPI 接口使用执行关联和已有启动上下文，不要求理解 Runweft 的 delegation 数据结构。

本 Change 验证并调用 HAPI 已有的配置继承、启动上下文和单执行关闭能力，不重新实现这些行为；宿主角色解释和父子业务关联归下游。单独验收不等于已经完成用户侧委派体验。

## 已确认的架构决策

### 三个独立项目

| 项目 | 职责 | 依赖方向 |
| --- | --- | --- |
| Runweft | MCP 适配、agent 配置、委派调度、父子关系和结果交付 | 调用通用或私有 HAPI 的兼容接口 |
| 通用 HAPI fork | 为 Runweft 暴露必要执行能力，复用并补齐 Hub、Runner、会话、审批、结果和控制能力 | 跟进 HAPI 上游，供 Runweft 与私有 fork 使用 |
| 私有 HAPI fork | 接入内部 runtime、认证和远端环境 | 基于通用 fork 迭代，不要求 Runweft 识别内部厂商实现 |

通用 HAPI fork 已创建于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过根目录 `hapi/` submodule 固定其版本；私有 HAPI fork 尚未创建，名称和地址待建立时登记。

### 复用 HAPI 执行基础

默认直接复用 HAPI 现有 Codex/Claude Code 适配和管理接口。本 Change 的正常交付是能力映射、Runweft 调用封装、错误处理与真实验证，不预先安排 launcher、原生协议、session、审批、恢复或共享 runtime 改造。

仅当既定产品行为被可复现缺口阻断时，先排查版本、配置和调用方式，再判断是否需要最小管理入口增补。暴露已有能力与修改 runtime 内部行为必须区分，不能从“需要可靠轮次”直接推导出“必须改造 HAPI runtime”，也不能搬回旧补丁。

2026-09-29 用户再次明确：Runweft 尽量只做 HAPI 上层流程封装并提供 MCP。每项方案先写出现有 HAPI 入口、能否直接满足及实际缺口；默认不是另建执行、会话索引、消息/状态、恢复、审批、文件或 UI 系统。HAPI 已实现就引用或薄封装，不把本 Change 理解成重写可靠执行引擎。

旧工程只参考用户交互、历史证据和失效场景；内部方案须依据当前 HAPI 重新推导，不能完全照搬旧 daemon、状态机、认证锁、持久事件库或补丁组合。

Runweft 不另建通用 runtime 协议、执行框架或与 HAPI 竞争的执行状态机。执行会话、轮次、审批、原生结果、中断和恢复由 HAPI 管理；Runweft 维护委派关系、调度策略及 MCP 调用与 HAPI 执行的关联。

新增 HAPI 入口仍需明确身份、错误和兼容语义。已有接口被接受、连接断开或界面显示文本，不能单独证明任务完成。

### 宿主支持与执行目标分开

Runweft MCP 接入侧明确只支持 Codex 和 Claude Code。执行侧以 HAPI 已有能力为来源，本轮以内置 Codex/Claude Code 为验证基线；两种宿主不意味着需要各写一份执行适配。runtime 注册只建立机器、工具环境与引用，不负责实现工具协议。

### 独立 runtime 扩展的后续边界

Claude Code 和 Codex 已由 HAPI 内置，不在本轮重新接入。今后内部 runtime 的独立接入按 HAPI 原有源码组织在对应 fork 完成，不作为当前 Runweft 完整版本的交付依赖。

不提供 npm runtime 插件、绝对路径动态插件加载、插件市场或 Runweft 插件 SDK。Runweft 自身的 npm 分发与 runtime 扩展机制是不同问题。

社区插件提案保留为跟踪材料，不引入其实现，不将其合并作为项目依赖。公开资料未说明作者关闭 PR 的具体原因，不替作者推断。

### 旧方案封存

旧实现保留在独立存档仓库。新项目不继承旧七工具契约、managed-v1 补丁组合、固定 Claude profile、平台认证锁或功能完成状态；引用历史代码前按当前需求重新核对。

## 行为变化

### ADDED

#### `execution/lifecycle`：可关联的原生执行

Codex 和 Claude Code 作为内置执行目标，由 HAPI 管理机器路由、进程、原生会话、轮次、审批、中断与恢复。Runweft 读取这些事实，不从输出文本或空闲时长猜测终态。

程序可以区分进程已启动、runtime 可接收输入、某次输入已接受和该轮结束；原生结果关联到具体输入。状态无法确认时显式保留未知，不能重发 prompt 或创建第二个执行来掩盖不确定性。

#### `execution/recovery`：可查询的启动与控制

启动和输入请求具有可查询的稳定关联。超时后先核对原操作；恢复导致 HAPI 身份改变时返回新旧关联。中断绑定目标轮次，不能误中随后启动的轮次。

子任务本轮结束后通过 HAPI 关闭该 subagent 执行进程，不为等待 follow-up 保持 agent 空跑；保留 HAPI/原生 session 记录。下一轮优先原生续接，session 确认不存在时才按[委派方案](../2026-09-29-delegation-lifecycle/design.md)组合已有历史开始新 session。读取、关闭和续接优先沿 HAPI 已有入口，不直连原生 CLI 再造执行器。共享进程不能因一个任务结束而误杀其他会话。

主宿主关闭后的恢复不属于目标。执行权限遵循 HAPI 与原生客户端已有默认，不额外建立权限隔离，也不自动改为跳过审批。

#### `execution/compatibility`：兼容能力声明

按实际 runtime 与版本声明启动、输入、结果、中断、恢复能力；不支持时明确返回。私有 runtime 在 HAPI 源码内接入，Runweft 不因内部厂商增加执行分支。具体能力映射在调查后确定，不新增通用 runtime SDK。

## 验收标准

- 两种内置 runtime 分别提供输入关联、原生终态和结果的真实验证；仅凭 REST 成功不能通过。
- 启动或输入回执丢失时可核对原执行；未知结果不会自动导致重复 agent 或重复输入。
- 审批、中断和恢复反映 HAPI 真实事实；中断不误中下一轮，恢复可追踪身份变化。
- 能力不具备或认证无效时给出明确结果，不静默切换 runtime。
- 不改造用户现有模型配置；真实验证使用已授权的专用环境。
- 本轮结束后子执行进程已关闭，原生会话可供后续优先续接；其他 HAPI 执行不受影响。
- 默认使用未主动改造的 HAPI 内置适配；调用封装与测试不重复实现会话、状态、恢复等能力。
- 若确有阻断缺口，有复现证据、现有入口排查结果与最小影响说明，不能凭假设增加 runtime 改造任务。

本 Change 验收执行契约；两类宿主的体验、Mac 安装、工作区准备与代码取回分别由其所属 Change 验收。

## 调查与后续讨论

轮次边界、输入关联、停止与恢复的调查及真实证据见 [Research](research.md)。私有 runtime 的环境属于独立后续接入，不阻塞本轮内置能力复用。

## 协作资源

- [HAPI REST 契约](https://hapi.run/docs/api/client-contract/rest)（读取 2026-09-28）：已有消息、审批、中断与恢复入口，尚不能据此证明全部可靠轮次语义。
- [旧 Runweft 快照](https://github.com/iTgo-lyq/runweft-archive/tree/0cbfa01f522488b2ede60e47adc1117698b54748)（读取 2026-09-28）：仅用于调查，不继承旧功能完成状态与认证结论。
- [HAPI 插件提案 #653](https://github.com/tiann/hapi/issues/653)与[实现 PR #695](https://github.com/tiann/hapi/pull/695)（读取 2026-09-28）：不采用其插件方案或作为交付依赖，证据保留在 Research。
