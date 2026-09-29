# 导入工作区的准备与启动

目标导入成功后，公共 prepare 校验自有来源回执、准确基线、目录和输入，再初始化固定 gitlink 与真实 LFS 实体。准备失败或未知没有原生执行；依赖安装留给 agent。准备/成果生命周期继续沿[公共 Git 工作区](../../git-workspace/lifecycle/spec.md)。

spawn/resume 携带当前 preparedWorkspace，在自动创建目录前及实际启动点核对 cwd、HEAD、干净状态、输入证据、模块清单/gitlink 和 LFS checkout 状态。旧引用、缺目录、HEAD/输入/模块漂移、只有 LFS 指针的工作树拒绝启动；不通过重建空目录或模型 prompt 修复准备。准备期间已完整验证资产摘要，启动不另做一次全量 LFS hash 扫描。

原生客户端从最终 cwd 加载该基线内的工程指令、skill 和项目配置，沿执行账户的全局配置、认证与默认权限；不自动复制源机器的全局配置或 ignored 文件。逐执行禁用 Runweft MCP、保留其他 MCP 及原生子代理，见[宿主 MCP](../../host-mcp/spec.md#受控执行的工具禁用)。

公共能力可接收已落地并验证的输入，复制到最终树外路径后回收下载中间副本；后续轮次经过 finalize → prepare → resume 使用新输入，复用可用原生会话。业务上下文仍由既有委派轮次负责，诊断 CLI 不接收附件或构造任务上下文。中心基线服务不替代原生启动回执、停止证明或结果处理。

正式远端委派在 parent.machineId/cwd 固定 origin，依原任务身份取得唯一基线 consumer；目标 source 仅来自该固定快照导入。输入、目录、Git 和上下文准备均在原生启动前完成，后轮继续原 worktree/session；不会重新读取主分支。捕获失败保留收尾并可 retry_result，首次基线确定失败按原固定 SHA 新发任务。
