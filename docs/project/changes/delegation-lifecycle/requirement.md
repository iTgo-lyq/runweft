# 本地共享目录的完整委派协作

> 状态：进行中
> 规模：大型
> 更新：2026-09-29
> 确认依据：只允许一层委派；任务结束关闭子执行进程，后续优先续接 session，缺失时构造历史；不要求主宿主关闭后恢复；HAPI 能力优先复用。细节按用户逐 Change 自主推进授权收敛，Plan 经一次 iclaude 评审后执行。

## Review 导读

主 agent 能派生子任务、继续工作、查看和等待结果、追加任务及中断指定执行。Runweft 保存必要父子关联，原生状态与历史沿 HAPI 读取；不要求主宿主关闭后恢复。

本 Change 定义本地与远端共用的协作语义，并交付 CLI/MCP 在本地共享 cwd 中的完整用户流程。[宿主适配](../../archive/2026-09-29-host-mcp-adapter/requirement.md)只提供身份与传递机制，[Agent 定义](../../archive/2026-09-29-agent-definition/requirement.md)提供解析结果；独立工作区与远端通过后续 Change 接入。前期讨论见 [Design](design.md)，正式接口与推进规则见 [Technical](technical.md)。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [HAPI 执行契约](../../archive/2026-09-29-hapi-subagent-foundation/requirement.md) | 执行、输入、终态和控制可可靠关联；不能用模拟终态作为最终验收 |
| 前置 | [统一 CLI 与部署](../../archive/2026-09-29-unified-cli-and-deployment/requirement.md) | 主体、工作区绑定入口及 HAPI 目标配置可供协作服务使用 |
| 前置 | [宿主适配](../../archive/2026-09-29-host-mcp-adapter/requirement.md) | 可信身份、角色、MCP 工具承载与结果传递已有证据；调度不再反向定义宿主身份 |
| 前置 | [Agent 定义](../../archive/2026-09-29-agent-definition/requirement.md) | 职责、指令与 HAPI 目标可解析；发现工具由本 Change 注册 |
| 前置 | [全局资源注册](../../archive/2026-09-29-execution-resource-registry/requirement.md) | runtime 引用解析到机器；启动前重新核对目标，不混淆业务 agent 和执行资源 |
| 下游 | [本地独立工作区](../local-workspace-execution/requirement.md) | 消费协作工具和准备/收尾条件，增加独立模式 |
| 下游集成 | [远端代码回收](../remote-result-delivery/requirement.md) | 消费 delegation/round 关联，向调度方报告成果封存和交付；不是本 Change 的反向前置 |

## 独立验收与交付边界

本地共享 cwd 的真实 CLI/MCP 协作可独立验收，无需 Git 仓库、附件中心或远端环境。任务可以编辑本地共享文件；本 Change 不程序化提交这些文件，也不要求文本报告任务制造代码成果。

本 Change 拥有协作命令、MCP 业务工具、delegation/round/result 数据与查询、启动前准备条件和轮次收尾条件。执行事实只从 HAPI 读取；具体 Git 和上传动作由后续提供方实现。未接入的工作区或交付模式明确不可用，不通过默认共享目录掩盖缺失。远端代码委派须等准备与结果能力同时就绪。

## 行为变化

### ADDED

#### `delegation/interface`：CLI 与 MCP 共用协作能力

提供 agent 发现、派生、查看/等待、协作消息、续接、中断与报告读取。派生返回稳定任务身份及接受状态；等待返回状态和新结果，超时不当作任务失败。概览提供可直接决策的顶层状态、需关注原因和完成报告，保留详细事实供查看。工具名及参数尽量对齐原生 Codex 行为，在正式方案中固定；不沿用旧内部七工具协议作为约束。

#### `local-workspace/shared`：主工作区原地协作

所选 runtime 必须位于发起机，在主 agent 绑定的同一 cwd 启动本地子执行，允许非 Git 目录。共享改动和并发写入由主 agent 调度；Runweft 不自动 stash、reset、提交或隔离文件，不因任务结束清理用户工作目录。配置加载与执行复用 HAPI，结果由主 agent 接纳。

#### `delegation/lifecycle`：持久父子协作

维护主工作区、父任务、delegation、轮次与 HAPI 身份的关联。MCP 使用原生父会话身份，CLI 是明确标记来源的当前 namespace 操作者入口，不接受任意 session 参数冒充原生父身份。两种入口共用角色约束与业务能力。主 agent 可发起、查询、等待、续接和中断；会话恢复导致执行身份改变时保留关联历史。父连接断开不隐式取消子任务。

#### `delegation/rounds`：输入归属和串行续接

同一 delegation 默认串行处理轮次，新任务与运行中 steer 分开表达。本轮追加当前仅 Codex 沿已验证 HAPI 队列/steer 入口开放，反馈实际原生交付；原生 turn 已结束时可作为同一业务 round 的后续输入，不冒充同 turn 注入。Claude 只允许明确下一轮排队，steer 报不支持；未知输入接受状态不能盲目重发；主 agent 可显式取消本轮并关闭固定执行，确认停止后才完成业务取消，保留原生未知事实。只允许一层 Runweft 委派，HAPI 受控 subagent 禁用全部 Runweft MCP 工具，CLI 委派入口也拒绝其再派生；原生内置 subagent 的使用和递归保持原样。

已接受任务由中心负责观察和收尾，不依赖宿主工具连接存活。每轮结束即通过 HAPI 关闭本子执行进程，保留工作区和 session 依据。主 agent 继续委派时优先恢复原 session；明确缺失时使用已有任务、消息、结果及工作区事实构造上下文，开始新 session 并保留关联。读取失败或网络不明不等于 session 不存在。

#### `delegation/results`：执行、交付与验收分离

执行结论来自 HAPI；报告和成果按轮次关联；接受代码由主 agent 或用户决定。普通报告可独立返回，不强制制造 Git 提交。委派拥有环境准备与本轮收尾条件的消费规则，以及统一查询表达；具体 Git 动作、附件发布和交付重试由对应 Change 提供，不能另建任务状态。未知准备/收尾不能放行下一次写入；共享模式按自身条件运行，不假造 Git 快照。

合入、冲突、push/PR 由主 agent 按任务处理，本项目不新增评审合并或冲突解决模块。

#### `delegation/context`：程序事实与任务提示分工

程序提供准确的环境事实、输入映射和操作边界，prompt 描述目标、测试与成果要求。模板不代替原生终态或上传回执。缺少格式化报告时保留原生结果及缺失标记。

## 验收标准

- [ ] Agent 定义的非空 model 与 reasoningEffort 在 Codex / Claude 两种 flavor 下通过真实启动验证；定义 Change 的参数映射检查不代替实际模型支持证据。

- [ ] 两种宿主与两种 runtime 的本地共享协作实际通过；CLI/MCP 派生、等待、追加和中断均能关联正确父任务、轮次与原生执行。
- [ ] 同一 cwd 的非 Git 任务也可运行，不程序化提交或清理主工作区，共享写入由主 agent 安排。
- [ ] 活跃宿主的一次工具连接中断不会重复执行已接受任务；不以主宿主重启恢复作为验收条件。
- [ ] 活跃轮次的 steer 与下一轮排队可区分；中断不会命中后续轮次。
- [ ] 同一 delegation 续接绑定原环境；准备/收尾条件未知或失败时不放行受影响轮次，真实 Git 收尾由后续工作区 Change 验收。
- [ ] 查询契约分开表达执行和交付状态，后续交付失败不触发重新执行；实际上传重试由交付提供方验收。
- [ ] 纯报告任务能完成协作，不依赖代码 bundle 或 PR。
- [ ] 受控子执行没有 Runweft MCP 工具，在 shell 中调用 Runweft CLI 派生入口也被拒绝；报告通过 HAPI 原生输出收回，内置 subagent 能力不受 Runweft 限制。
- [ ] 本轮结束关闭子进程；下一轮优先原生 resume，确认缺失才构造历史，且不重放旧工具副作用。

## 后续技术核对

宿主身份与可用通知入口见[宿主调查](../../archive/2026-09-29-host-mcp-adapter/research.md)。沿 HAPI 核对结果读取、停止执行和原生 resume 的顺序；并发上限先沿 HAPI/原生已有默认，不新增资源调度系统。旧工程交互可作参考，不能默认搬入它的内部事件库与重试引擎。
