# 资源范围、存储与接口

机器与 runtime 是当前中心 namespace 内的全局资源，Agent 定义是独立消费方。不同工作目录使用同一登记，项目文件不能重新登记全局资源；不同 Hub 或 namespace 的引用不按名称共享、迁移或自动替换。

ResourceClient 在 local 模式只允许选择当前连接 settings 中的本机 machineId，缺少身份时提示 start。Hub 客户端可以选择当前 namespace 的其他机器。中心 ResourceService 只检查 namespace 与资源事实，不读取自身 local/hub 配置限制机器；保留 local 配置的公开 Hub 也能解析其他 Runner。

中心业务库位于 `<home>/server/runweft/state.sqlite`，使用 SQLite WAL、busy_timeout 和事务化 schema version。机器登记与 runtime 登记分表保存；HAPI 保留原生机器信息、心跳、会话和执行事实。资源登记表只保存登记、稳定引用、名称和最后原生探测，不保存模型凭据或消息历史；同库的[委派表](../../delegation/lifecycle/spec.md)另保存业务输入、报告与关联。Hub 客户端没有第二份权威资源库，paths 标明数据归属；备份须在中心停止服务后保留业务库及尚存 WAL 文件。

自有 API 验证 HAPI JWT，所有登记读写按 namespace 限定；访问私有 HAPI 时转交调用者同一个 Bearer，不改用中心默认身份。认证后才打开资源数据库，请求完成后关闭连接。变更不自动重放，错误保留 code/message/hint；登记的唯一约束保证重复操作沿用原 ID。

前缀 `/api/runweft/resources`，响应包含当前 namespace：

| 路径 | 方法 |
| --- | --- |
| `/machines` | GET 完整库存；POST `{machineId,name?}` 登记 |
| `/machines/:id` | GET 查询；PATCH `{name}` 重命名；DELETE 取消登记并返回 affectedRuntimeIds |
| `/machines/:id/discover` | GET 查询原生工具详情 |
| `/runtimes` | GET 登记项，`?all=true` 含取消项；POST `{machineId,flavor,name?}` 登记或恢复 |
| `/runtimes/:id` | GET 查询及探测；PATCH `{name}` 重命名；DELETE 取消登记 |
| `/runtimes/:id/check` | GET 返回当次检查 |
| `/runtimes/:id/resolve` | GET 返回稳定目标及当前观察，前提不成立时失败 |

机器默认列表过滤及本机目标限制由客户端应用；服务端库存保持 namespace 完整。eligibility 表示资源选用条件，不是模型已验证可运行；runtime 始终返回 modelAuthentication/execution 为 not_checked。
