# 委派生命周期依据

> 调查：2026-09-29；HAPI 固定 `56ec77f19322619a429304e7a948ba2c46eaca4d`，前置五个 Change 已验收。

## 已验证基础

- [ExecutionClient](../../../../src/execution.ts) 已封装持久 spawn requestId、消息 localId、原生执行观察、按输入/执行定向中断、archive 后停止确认、原生 resume 与精确缺失。真实 Codex/Claude 证据见[执行验收](../2026-09-29-hapi-subagent-foundation/execution.md)。本 Change 不再建立执行器或原生历史索引。
- [宿主身份](../../../../src/mcp/identity.ts) 从 Codex 每次调用 metadata、Claude PreToolUse + toolUseId 获取真实宿主与 cwd；[MCP](../../../../src/mcp/server.ts) 已区分请求取消与连接关闭，当前只注册诊断。工具响应可用，普通 MCP 没有已验证的主 turn 结束后后台唤醒；不承诺自动注入或恢复主宿主。
- [AgentClient](../../../../src/agents/client.ts) 显式接收 cwd，返回序列化快照和 launchOptions；默认不覆盖原生模型/权限，包含 Runweft MCP 禁用。个人绑定按连接/namespace/来源解析；共享执行仍须核对目标机器就是发起机，不能把 Hub 中另一台机器上的同名路径当作共享目录。
- [ResourceStore](../../../../src/resources/store.ts) 是中心 state.sqlite 的 schema v1，资源表通过 PRAGMA user_version 管理。新增委派表应将迁移集中到一个入口并升级 v2，不能让资源构造器拒绝自己新增的版本，也不能把中央任务写入发起机 client.sqlite。
- [服务](../../../../src/services.ts) 已拥有 HAPI Hub 生命周期、中心令牌和 JWT 密钥；[API](../../../../src/api.ts) 校验同一 HAPI JWT namespace。中心收尾不应依赖短命 MCP/CLI 请求；可在既有服务进程内运行小型协调器，不再加用户需安装的 daemon。

## 角色与 CLI 入口

[HAPI session 环境](../../../../hapi/cli/src/agent/hapiSessionEnv.ts) 在 Claude launcher 前导出 HAPI_SESSION_ID；共享 Codex 的 [root 配置](../../../../hapi/cli/src/codex/shared/root.ts) 按根写入 shell_environment_policy.set.HAPI_SESSION_ID。受控子 shell 可据此查询真实 session metadata，Runweft 的父子映射也保存 child HAPI/native 身份；不需要模型自报角色或修改运行时来插入 Runweft 环境。

普通终端没有可验证的 Codex/Claude 调用 metadata，不能给 CLI 增加任意 --session 参数然后称为原生宿主。产品选择：MCP 使用已验证原生身份；CLI 是当前 namespace 下的显式操作入口，以发起机器/cwd 标识操作者来源，输出 source=cli，不假装属于某个原生父会话。两者经过同一中心 child 关联检查，初始输入前登记受控身份；不依赖另一个 HAPI Hub 的 metadata 可见性。CLI 可按任务 ID 操作当前 namespace 的任务，MCP 默认只能操作自身派生任务。这是同一账户下的协作约束，不是进程安全隔离。

## 活跃追加的能力差异

- [HAPI messages 路由](../../../../hapi/hub/src/web/routes/messages.ts) 提供普通消息排队与 `/messages/:messageId/steer`；[SyncEngine](../../../../hapi/hub/src/sync/syncEngine.ts) 只允许支持的 runtime，Codex 支持、Claude 不支持。
- SendMessageRequest 的 `deliveryMode: steer` 在 [MessageService](../../../../hapi/hub/src/sync/messageService.ts) 只保留给 Pi；对 Codex/Claude 会归一为 queue。不能只传这个字段就声称即时 steer。
- Codex [原生队列](../../../../hapi/cli/src/codex/shared/queue.ts) 沿 thread/queue/enqueue + steer，消息可能在请求 steer 前自然被消费。HAPI 返回 steered、invoked 或 failed；invoked 不能被报告成“已注入原 turn”。Runweft 的本轮追加先归属当前业务 round，再通过既有 HAPI 排队/steer；返回原生实际交付，必要时在同一业务 round 的后续原生 turn 执行。没有新建下一业务 round，也不跨进程续接。
- Claude 只开放明确的下一轮排队；活跃追加返回不支持，不暗中改成下一轮。Codex 的真实追加归属及停止时序放在 T2 原生验证。

## 认证、恢复与未知结果

中心后台可使用既有中心令牌按已认证 namespace 创建 HapiClient。HAPI 的[令牌解析](../../../../hapi/hub/src/utils/accessToken.ts) 使用最后一个冒号作为 namespace 分隔；任务库不保存调用方 JWT 或模型凭据。namespace 已由入站 HAPI JWT 验证，不接受任意任务参数覆盖。

启动前保存 requestId，输入前保存 localId 与操作阶段。进程崩溃、丢回复后只查原回执/消息/执行；不能因单次 404、active=false 或空文本新建任务。只在明确未尝试的步骤继续写入；停止重试始终针对原 session，且不得改变原生执行结论。恢复未知时保留实际返回的候选 HAPI ID；只有 native_session_missing 可重建历史。Hub session 行本身被删也不能擅自断言原生历史缺失。

默认权限保留。查询可返回 HAPI 原生审批及跳转；显式审批响应沿已有 requestId/decision，不新增会话级绕过或自动批准。显式模型参数将从验收机原生有效配置选择，在两种工具真实运行中验证，不以字符串解析代替执行。

## 规划期进一步核对

- HAPI auth 路由签发 4 小时 JWT；当前 HapiClient 缓存 token 不按 exp 续期，短命 CLI 不明显，常驻协调器需在发请求前按已有 exp 重新认证。只刷新认证，不对结果不明的业务 POST 自动重放。
- HAPI resume 对 Codex/Claude 使用现有机器匹配规则，可能包含同 host 的后备机器；协调器不能直接把 resume success 当成绑定环境未变。resume 前重新核对固定 runtime/machine 可用，返回后在投递输入前核对实际 metadata.machineId/path/flavor；不符则报告并关闭本次错误目标，不发送任务。固定 HAPI/native 身份实际取返回值，原归档历史不能自行改写。

## T2 真实续接补充

Claude 真实续接在 `.dev-smoke/task-controls-teHsIX` 暴露历史 epoch 变化。HAPI [消息存储](../../../../hapi/hub/src/store/messages.ts) 会在回填消息位置早于当前 head 时增加 epoch，[对应测试](../../../../hapi/hub/src/store/messages.test.ts) 明确证明新 seq 也可能落在旧位置之前；epoch 变化不等于执行失败或历史被删除。固定旧 epoch 会永久阻断后续读取，简单丢掉 epoch 又可能漏掉回填事实。

采用现有 API 的 reset/latest/before 分页：仅在 epoch 变化时重新按固定 input localId 核对历史，本轮所有输入看到同一新 epoch 后再持久更新游标；稳定期继续 after 查询。已确认观察和输出保留，按原生消息 ID 更新，读取过程中再次变更则下次只读重查。无需 HAPI 改造或重新投递。
