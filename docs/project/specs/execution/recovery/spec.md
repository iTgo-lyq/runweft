# 执行关联、关闭与恢复

## 可重查请求

启动必须带调用方先保存的 UUID requestId。HAPI 在 namespace 内持久去重；同 ID 同参数返回原回执，参数冲突拒绝。回执与预分配会话原子保留后只调用一次 Runner，删除会话和重启不移除去重记录。

丢启动响应时查询原 requestId；没有原响应、查不到或不可达都不能证明未启动。调用层返回 unknown，不自动换 ID 重试。显式同 ID 同参数重调仍受 HAPI 去重保护。

输入必须带稳定 localId。丢回复保留 unknown，调用方可查原消费状态和消息；单次空查询不排除在途请求。HAPI 不重发已标记 invoked/dispatching/indeterminate 的重复输入；Claude 将输入交给原生进程后发生模糊失败也不自动重新入队。

## 定向控制

interrupt 同时提交 inputLocalId 与 executionId，HAPI 执行侧检查实际目标；返回 requested、not_running 或 target_mismatch 及受影响输入。requested 不是终态，需读取后续原生/控制事实；不匹配不回退到无条件 abort。排队输入使用现有消息取消入口。

stop 调用原有 archive，并确认 inactive 且 archived；丢响应后只读核对，无法确认返回 unknown。关闭一个共享 Codex root 不终止其他 root；最后一个会话关闭后进程退出。原生 session 与 HAPI 记录保留。

resume 沿原有入口返回实际 HAPI session、新旧原生身份，等待该执行就绪。只有 Runner 确认原生历史缺失才返回 missing；离线、认证、权限、IO 或模糊失败均不等于缺失。调用层不自动创建新执行，也不实现历史重建。

上层业务委派消费这一明确缺失结果，按[轮次规则](../../delegation/rounds/spec.md)选择续接或构造业务历史；不改变原生执行调用层的上述职责。

Claude 缺失检查读取当前 cwd 对应原生 transcript；Codex 用既有 native app-server 查询指定 thread，仅精确的原生缺失响应可判缺失。预检查不发送 prompt，查询进程随后关闭；明确拒绝时保留原归档状态。

Claude目录统一按绝对cwd替换非ASCII字母数字为连接符；编码长度超过200时取前200码元，加连接符及完整原始cwd的UTF-16/int32 31倍累积hash绝对值的36进制表示。历史检查、扫描及launcher共用HAPI getProjectPath，尊重CLAUDE_CONFIG_DIR；不会将实际存在的长cwd历史误判missing。专用真实Claude长cwd两轮保持同native session并保留记忆，无历史重建；验证范围见[本轮验收](../../../archive/2026-10-10-hapi-session-and-shutdown/acceptance.md)。

已关联受控工作区的 resume 必须携带同环境的当前有效 preparedWorkspace，实际启动前再校验；包括 HAPI 通用恢复入口，省略参数不能绕过上一轮封存与新轮准备。受控会话 clear 拒绝另开无准备会话，应通过 Runweft 结束并续轮。普通 HAPI 会话与原生内置子代理不新增这项约束，缺失目录/旧准备不作为原生历史缺失处理。

shared preparedFiles 在 HAPI resume 省略时继承，显式 null 清除。Runweft 每轮传当前准备引用，无新输入时明确清除旧绑定；失效输入不作为 native_session_missing。输入副本清理和输出重传使用机器文件回执，不重放原生输入。
