# 原生执行事实

Runweft 的内部 ExecutionClient 通过 HAPI 启动 Codex/Claude，使用现有机器、会话、消息和审批能力；没有独立模型执行器或原生会话库。该调用层不包含宿主 MCP 或业务委派。

启动成功回执只确认原调用结果；waitUntilReady 要求会话 active 且具备 execution 版本 1。查询使用 HAPI 历史分页，按调用方 localId 返回消费状态、原生观察、输出和当前审批，归档后仍可读取历史。

轮次可提供历史起点游标，只查询其后的关联输入/输出。HAPI 回填历史导致 epoch 变化时，沿原有分页按固定 localId 重新核对，不能把回填误认作执行失败或重新投递；同次读取 epoch 再次改变时明确返回可重查错误。

执行观察分别记录 submitted、accepted、completed、failed、interrupted、unknown，保留 runtime、executionId、输入 localIds、来源和可用原生身份/结果。REST 接受、invokedAt、thinking=false 或 ready 不单独证明完成。

Codex 通过原生 user item 与 turn ID 关联输入，以 turn/completed 的 status/error 记录结果；同轮合并输入共享事实，子线程结果不属于根输入。Claude 通过 stdin 批次 UUID 与原生 command/user UUID 回显建立关联；未知 subtype 或缺少关联保留 unknown，自主/侧链结果不结束该批输入。已知 subtype 且 is_error=true 是失败，即使 subtype 为 success。

审批沿 HAPI 原有 approve/deny 路由和原生请求 ID，不修改默认权限。Claude 当前工具拒绝流程关闭原生进程，确认清理后记为 interrupted/control；未确认关闭仍为 unknown。

真实执行继承原有模型配置和认证；专用项目的说明与 skill 由原生客户端加载。调用层不集中管理 skill/MCP，不写用户全局配置。
