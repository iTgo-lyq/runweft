# 远端工作区诊断准备

Runweft 使用既有 Agent/runtime 绑定，把主 Git 仓库的明确已提交基线传到另一 Runner，并用 HAPI 公共能力建立独立 worktree。诊断不启动模型、不接受任务消息或附件、不提供代码成果取回，正式远端 task/MCP 委派使用同一基线服务自动准备，并经[代码交付](../remote-results/delivery/spec.md)回收；不需要先运行诊断命令。

| 命令 | 行为 |
| --- | --- |
| `workspace prepare --agent <name> --base <ref>` | 从当前真实 cwd 准备，HEAD 可作为显式 base；不要求 Git URL、远端路径、手动 clone 或上传 bundle |
| `workspace preparations [--all]` | 默认列当前目录，all 列当前 namespace 的准备 |
| `workspace inspect <id>` | 查询原记录的固定 SHA、阶段、传输/复用字节、目标目录、错误及保留状态 |
| `workspace release <id> [--discard-ignored]` | 显式释放诊断环境与其基线引用；接受后 inspect 确认最终结果 |

源/目标 Runner 的能力和 Agent 快照在受理前核对；目标与发起机相同则提示使用本机 worktree 委派。沿已有认证 namespace、parent/工作区及子执行委派拒绝规则；Hub 操作者无需本机 Runner 也可查询本 namespace 的记录。

prepare 在副作用前输出 request ID；同 ID/参数返回原记录，冲突拒绝。未知结果和重启沿原操作查询，明确失败后按原固定 SHA 发起新请求，保留历史。详情分别展示中心快照与目标导入阶段，不把目标离线解释成中心恢复对象丢失。诊断的 nativeExecution 表示本诊断没有发起原生执行。

服务运行在现有 Runweft serve 内，业务记录位于 state.sqlite；HAPI 执行 Git 和文件动作，不另建 runtime 或调度框架。对象传输与配额沿[持久文件](../artifacts/spec.md)。具体行为见[固定基线](baseline/spec.md)、[独立环境与留存](isolation/spec.md)、[启动前校验](readiness/spec.md)。
