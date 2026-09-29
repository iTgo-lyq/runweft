# 全局机器登记

机器身份、元数据、在线状态和心跳由 HAPI 提供。Runweft 直接使用 machineId，单独保存 namespace 内是否允许选用的登记状态，不创建第二套身份或心跳。机器登记不创建 runtime 或 agent。

`runweft machine register [id] [--name <name>]` 登记当前连接的本机或显式指定的已有机器。未连接时提示 start，不自动启动服务；已知离线机器可以登记但不可选。可选名称及 `machine rename <id> <name>` 沿 HAPI 名称更新，保留 ID；名称可重复，最长 64 个字符，不用于路由。

`machine list` 显示已登记机器及当前连接的本机，`--all` 包含未登记和离线历史；`machine show [id]` 默认本机。输出区分登记、Runner 在线、平台及选用条件；可选机器仍需指定已登记 runtime，机器在线不证明模型可运行。

`machine unregister <id>` 只取消机器登记并列出受影响的 runtime ID，不删除 HAPI 身份、不停止原生任务、不取消这些 runtime 各自的登记或修改 agent 定义。恢复机器登记后可重新检查并选用其 runtime。HAPI 原有活跃超时负责离线收敛，Runweft 不增加心跳。

完整库存使用 HAPI `GET /api/machines?includeOffline=true`；默认 HAPI 列表仍只返回在线机器。旧 Hub 缺少 machineInventory:1 时明确拒绝不完整库存。作用域与存储见[资源范围](../scope/spec.md)，执行工具见 [Runtime](../runtimes/spec.md)。
