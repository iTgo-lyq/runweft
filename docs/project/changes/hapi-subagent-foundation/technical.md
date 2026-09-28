# HAPI 执行事实与调用封装

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-09-29
> 确认依据：按用户自主落实授权确定；与 Plan 一同接受本 Change 的一次 iclaude 评审，主 agent 记录独立采纳结论后执行。

## 依据与边界

[Research](research.md#当前基线与真实探测) 已验证两种内置 runtime 的启动、回复、archive 退出和原生 resume。原有启动器、模型认证、权限、会话保存、archive/resume 与审批界面继续复用。

源码和实际消息共同证明三个阻断：公开 spawn 缺少可重查的调用方关联；原生终态在现有投影中丢失；abort 缺少执行侧的预期轮次检查。Claude 另存在出队早于原生消费、异常后自动恢复已交给 SDK 的输入的路径，不能把它解释为原生接受或安全重试。

仅对上述缺口在独立 HAPI fork 增补管理回执、事实投影和定向控制。Runweft 负责类型化调用及错误呈现，不复制会话库、不建立执行器或通用 runtime SDK。HAPI submodule 指向独立提交，继续由现有构建脚本生成配套程序。

## 启动与重查

既有机器 spawn 增加可选 UUID `requestId`，客户端必须在发送前保存该 ID。Runweft 的调用封装要求调用者传入，持久业务关联由后续委派 Change 负责。

HAPI 在同一 namespace 内记录一条小型启动回执：requestId、machineId、参数摘要、预分配 sessionId、创建时间与可选原响应。写入回执及原生预分配行后再调已有 Runner spawn；不新增重试队列或监督进程。以 `(namespace, requestId)` 为唯一键；同 ID 同参数只读取原回执，不再次启动，并发调用返回 pending 与原 sessionId；参数冲突明确拒绝。回执独立于会话删除保留，避免删除会话后重放旧请求启动第二个进程。

新增机器下的回执查询入口；鉴权沿现有 namespace 和机器访问校验。尚无原响应表示启动结果未确认，不表示失败。收到原成功响应后仍通过原生 session 状态区分进程启动、接收输入与轮次完成。超时由 Runweft 查询原 requestId；回执不可达或不存在仍返回未知，不换 ID 再试。调用方可显式以同 ID、同参数再次调用，唯一键保证不会重复派发；单次“未找到”不能证明在途请求未到达。卡住的回执先沿原 sessionId 调用 archive，并确认停止及拒绝迟到接管，才可由业务层决定新建请求。

无 requestId 的现有 HAPI 调用保持原入口行为；有 requestId 的不确定错误保留 sessionId 和回执。明确 childStarted=false 时仍允许 HAPI 原有 stub 清理，但回执保留原拒绝结果。

## 输入与原生事实

继续使用现有 `/messages`、localId、queued-state 和消息分页。Runweft 不将 REST 200、invokedAt、thinking=false 或 ready 单独映射为成功。

HAPI 在已有持久消息通道增加一个小型执行观察事件，带版本、executionId、inputLocalIds、runtime、原生 session/turn ID、阶段及原生结果字段；使用稳定消息 ID 去重，走 lossless 通道。阶段只反映真实观察：submitted、accepted、completed、failed、interrupted、unknown。当前执行摘要可放入已有 agentState，历史仍保留在原有消息库，不新建轮次数据库。

| Runtime | 输入与结果关联 |
| --- | --- |
| Codex | 使用已有 clientUserMessageId、conversationHistoryTurns 和原生 turnId。原生 user item 证明接受；turn/completed 保留 status/error 及关联输入。历史重投影使用同一稳定 ID，不能把原生子线程事件归到根输入 |
| Claude Code | 在已有 nextMessage 的批次交付处保留 localIds 和该次 observation ID；出队只记 submitted。根 assistant 或原生 result 证明该批输入得到处理；保留 SDK result 的 subtype/is_error/result/errors，并在下个批次前固定关联。未知 subtype 仍未知，不按文本猜测 |

Claude 的现有异常分支在输入可能已交给原生进程、但没有原生结果时记录 unknown，停止自动重新入队该批输入；等待调用方明确处理。仅有明确的进程未创建/输入未写入证据时才允许恢复未投递批次；没有 init 或 assistant 输出不是未消费证明。可确认的启动或认证失败保留原错误，不以超时或静默推断。该修改必须有“已产出回复片段后进程异常”的复现及次数断言，不能只测正常完成。原生后台任务/侧链输出不作为主输入完成证据。Claude 自主根轮次与新输入交错时需要原生输入回显/轮次关联证据；不能把 push 后第一个 result 直接归给新输入，无法对应则保留未知。

Runweft 查询返回 HAPI session、指定 localId 的消费/原生事实、当前审批请求和结果引用；不同证据不互相替代。结果读取沿原有消息，包含失败信息并保留原生标识。失联而没有终态时保留未知，不能凭时间宣布完成。输入响应丢失先查 queued-state 与持久消息；不因一次空查询就重投。对已持久标记 invoked/indeterminate 的重复 localId，Hub 不再次交给 CLI；未确认消费仍由现有 HAPI 队列对账。

## 定向中断、关闭与续接

增加与旧 abort 分开的定向中断入口/RPC，携带 inputLocalId 及已知 executionId。Codex 在同一执行处理点核对该 localId 对应当前 native turn，再把明确 turnId 交给原生 interrupt；Claude 在同一处理点核对当前批次并立即捕获/中断其 controller。目标已结束、不匹配或能力未声明时返回明确结果，不调用无条件 abort。

中断请求被接受只表示已请求；最终 interrupted 必须来自原生完成通知，或 Claude 对应执行已结束且其 abort 已完成的控制事实。处理新轮次前清理旧目标，测试迟到请求不影响下一轮。排队目标使用现有 cancel-queued；Codex steer 合并的输入返回同轮所有受影响 localIds。Claude 中断结束该会话原生进程及其后台任务，受控中断与崩溃分别记录。已有审批查询与允许/拒绝入口直接复用，不改默认权限。

本轮停止继续调用 archive，并核对 inactive/archived；遇 still_alive/unknown 不当作成功。共享 Codex runtime 的兄弟会话通过独立会话控制验证，不以整进程 kill 代替。续接继续调用 resume，返回新旧 HAPI/原生身份；认证失败、机器离线和暂时不可达不解释为 session 不存在。历史重建由后续委派 Change 实现，本 Change 只提供已确认缺失的错误依据。T3 先复现缺失路径；Claude 在 Runner 续接前复用原生 transcript 检查，保留权限/IO 错误；Codex 只映射原生结构化 not-found。补齐 `native_session_missing` 的机器到 Hub 透传，不把通用 resume_failed 或身份变化当作缺失。

## 兼容和配置

HAPI Hub 和会话分别声明执行契约版本 1；Runweft 调用前核对能力，缺少时提示更新配套 Hub/Runner。新增字段不要求其他 runtime 自动具备本能力；本轮只声明和验证内置 Codex/Claude Code。

现有 HAPI 环境与原生配置继承路径保持不变，按 runtime 向宿主适配提供身份事实：Claude wrapper 导出 `HAPI_SESSION_ID`；Codex 共享 engine 清除全局该变量，仅在 thread shell 和 HAPI MCP bridge 中注入。原生 sessionId 与 resume 返回的最新 HAPI sessionId 都需记录，不能承诺全局 Runweft MCP 已能取得它。首次 MCP 工具发现、原生子会话识别和角色工具分流由下一 Change 验证；不预先增加通用 env/MCP 注入参数。

无活跃会话的机器 Git/文件通道和会话外对象传输继续做前置调查，具体增补仍归工作区/附件 Change，不并入本 Change 实现。

## Runweft 承载

在现有 HapiClient 上增加聚焦的执行调用模块：start/lookup、send/query、interrupt、stop、resume 及审批读写。HAPI REST 错误保留可判断的 code 和关联 ID；传输未知不自动重发。认证、连接选择及数据根沿已验收基础。

本 Change 提供内部调用能力与自动验证入口，不新增第二套用户任务 CLI。后续委派的 CLI/MCP 共用此模块；HAPI 原有操作仍由 `runweft hapi …` 承载。业务 delegation/round 表、agent/runtime 注册和最终结果接纳不在此模块创建。

## 验证与回退

- HAPI 聚焦测试覆盖回执去重/参数冲突/丢失响应、原生事实映射、Claude 模糊异常不重发、定向中断竞态、共享 runtime 单会话关闭。共享协议变更按 HAPI 约定执行类型检查、测试及相关 fixture 检查。
- 专用 HAPI home/cwd 下两种真实 runtime 各完成启动、localId 输入、原生终态、archive、原生 resume；通过现有认证环境执行，不复制或改写模型凭据。审批与中断使用可控的专用任务，不对用户代码执行操作。
- 传输故障通过仅作用于测试服务的代理注入；核对真实服务只有一次创建/输入，不以测试替身替代正常执行证据。
- 配套编译程序完成同一调用验证；Runweft 类型检查和原有服务测试不能因新增封装退化。macOS 模型组合归最终集成，真实远端缺口单列。
- HAPI 数据变更仅增加启动回执；备份沿既有部署规则。异常时保留已产生事实和关联，不清库修复。回退应用版本不自动删除原生会话或回执。

尚无必须向用户索取的外部契约。各错误分支、观察事件的具体字段与消息分页实现可在上述约束内完成，不扩展成通用事件框架。
