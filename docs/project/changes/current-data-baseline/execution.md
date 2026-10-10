# 执行与验收记录

## T1 基线与边界

已核对源码基线`afdcd81a4e062f56edab533b9874f266b70f655b`、工程1.1.1及Hub19/client1/config1。首次专用现场实际创建、校验并重开数据库和配置通过，临时现场已删除；删除完成后再进行一次独立创建/重开验收。

iclaude在当前工作区完成一次无工具、无会话持久化Plan评审，退出0、is_error=false、196804ms。采纳固定绝对清单、根身份/挂载校验、原生路径引用检查、启动来源检查、删除后基线验收和延后复扫。摘要比较窗口位于评审结束之后，敏感摘要不写入归档。没有采用无依据的完整迁移框架或保护所有HAPI的建议：目标测试Hub的HAPI需随其停止，无关HAPI继续保护；Task实际已有version2，不添加预设版本系统。

用户升级基线确认写入AGENTS：后续结构变更在对应Change明确从该基线起的处理与验证；此次不新增迁移代码。历史仓库remote及Git worktree核对完成；未发现Runweft自启动配置。原生Codex仅有四个历史测试项目信任键，保留原配置；这些引用不构成持续运行或MCP依赖。

保护当前及历史仓库源码/Git、正式dist、已有Runweft安装、原生配置/凭据和位于codex-delegation-lab的独立HAPI服务。清理只删除固定清单内测试现场，不删除共享缓存或`/tmp`中的其他项目/HAPI目录。

- Commit：`current-data-baseline T1: establish first-deployment baseline and cleanup scope`。
