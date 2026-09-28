# 执行关联、关闭与恢复

## 可重查请求

启动必须带调用方先保存的 UUID requestId。HAPI 在 namespace 内持久去重；同 ID 同参数返回原回执，参数冲突拒绝。回执与预分配会话原子保留后只调用一次 Runner，删除会话和重启不移除去重记录。

丢启动响应时查询原 requestId；没有原响应、查不到或不可达都不能证明未启动。调用层返回 unknown，不自动换 ID 重试。显式同 ID 同参数重调仍受 HAPI 去重保护。

输入必须带稳定 localId。丢回复保留 unknown，调用方可查原消费状态和消息；单次空查询不排除在途请求。HAPI 不重发已标记 invoked/dispatching/indeterminate 的重复输入；Claude 将输入交给原生进程后发生模糊失败也不自动重新入队。

## 定向控制

interrupt 同时提交 inputLocalId 与 executionId，HAPI 执行侧检查实际目标；返回 requested、not_running 或 target_mismatch 及受影响输入。requested 不是终态，需读取后续原生/控制事实；不匹配不回退到无条件 abort。排队输入使用现有消息取消入口。

stop 调用原有 archive，并确认 inactive 且 archived；丢响应后只读核对，无法确认返回 unknown。关闭一个共享 Codex root 不终止其他 root；最后一个会话关闭后进程退出。原生 session 与 HAPI 记录保留。

resume 沿原有入口返回实际 HAPI session、新旧原生身份，等待该执行就绪。只有 Runner 确认原生历史缺失才返回 missing；离线、认证、权限、IO 或模糊失败均不等于缺失。调用层不自动创建新执行，也不实现历史重建。

Claude 缺失检查读取当前 cwd 对应原生 transcript；Codex 用既有 native app-server 查询指定 thread，仅精确的原生缺失响应可判缺失。预检查不发送 prompt，查询进程随后关闭；明确拒绝时保留原归档状态。
