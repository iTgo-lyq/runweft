# Claude 历史目录与 Runner 退出实施计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 状态：执行中
> 执行模式：逐任务提交

## 交付目标

真实Claude长路径续接不丢失原生会话；Runner撤权/断连后完成有界本地清理。两仓库提交及同候选验证可追溯。

## 任务

### T1 Claude历史目录适配

- 状态：已完成
- 交付：HAPI共用路径规则与边界/恢复回归；记录原生算法来源。
- 依赖：无
- 验收：固定长路径预期、200/201、Unicode和不同完整路径正确，短路径及IO语义不退化。
- 验证：相关Vitest、CLI typecheck，专用环境实际Claude目录证据。

### T2 Runner优雅退出

- 状态：已完成
- 交付：HAPI有界通知、停止接收、固定清理、异常/超时语义、控制等待和生命周期说明。
- 依赖：T1
- 验收：无远端ACK亦能清理；失败仍释放后续资源；重复请求幂等；独立session保留。
- 验证：通知/清理/控制回归、相关manager测试及CLI typecheck。

### T3 更新引用与自动验收

- 状态：进行中
- 交付：Runweft固定已提交HAPI，smoke严格要求清理成功；同候选验收及脱敏记录。
- 依赖：T2
- 验收：正常/断连/撤权退出0并可重启；实际长cwd两轮同Claude nativeID；基础检查通过。
- 验证：bun run typecheck、bun run test、bun run build、access集成、专用原生及Runner验收。

## 整体验证

- Plan形成后在当前工作区iclaude评审一次，主agent判断采纳；仅额度耗尽可替换新subagent。
- 各任务分别在相关仓库提交，验收后同步Specs并归档；不推送/发布，本机证据不冒充物理远端实测。
