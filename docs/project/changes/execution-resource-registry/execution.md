# 全局机器与 Runtime 注册执行概况

## Plan 评审与主 agent 复核

- 当前工作区 iclaude 会话 `f54ca0d9-fc39-4c22-9ebe-9e8ee206833f`，2026-09-29 12:41–12:48（Asia/Shanghai），退出 0、result success。本 Change 的一次 Plan 评审已完成；无额度错误、不需要替代 subagent，不重复评审。
- 原始材料位于本机 `.dev-smoke/reviews/execution-resource-registry/`，以下为独立复核后的采纳结果。

| 意见 | 主 agent 处置 |
| --- | --- |
| Hub 服务端也是 local 配置，不应按它拒绝远端目标 | 采纳；客户端 local 限制本机，中心公共解析按 namespace。未采纳“loopback 天然只有一个 Runner”的推断，同机多个身份也需要正确处理 |
| Codex 旧 preflight override 不等于 shared launcher 实际命令 | 已独立核对源码，采纳。原 available/reason 保留 preflight 事实，新增详情查询真实命令。登记/新目标解析同时核对二者，增加有效旧 override 但真实 CLI 缺失的用例；不改 launcher |
| 环境变更需重启 Runner | 采纳，在缺失/无效诊断和使用说明提示沿启动时环境探测，修改后 restart |
| 版本查询异步、有时限，不强制旧 Runner 升级 | 采纳，异步并行 execFile，上限 3 秒；使用可选能力，只有请求详情时核对，不加入 REQUIRED_MACHINE_CAPABILITIES |
| 列表避免历史堆积且应显示派生资格 | 采纳，默认已登记与当前本机，--all 查完整历史；runtime 显示不可用于新委派的具体原因 |
| machine register 不隐式启动中心 | 采纳，首次提示 start，登记和启停分开；已知离线身份可以登记但保持不可执行状态 |
| 项目 agent 的中心 runtime ID 不可跨用户直接复用 | 作为下游事实写入 Agent Change，要求显式重绑定，不在本 Change 引入项目级资源注册或自动按名称改派 |

四项任务和依赖保持不变。Requirement/Technical 已按既有自主授权收敛，Plan 可进入执行；以上调整不引入新的执行框架、权限或外部资源。
