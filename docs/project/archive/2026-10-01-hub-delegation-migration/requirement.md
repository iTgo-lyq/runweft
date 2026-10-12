# 委派接入与配置切换

> 前置：[HAPI 授权](../../archive/2026-09-30-hub-hapi-access/requirement.md)、[资源归属](../../archive/2026-09-30-hub-resource-ownership/requirement.md)、[中心 Agent](../../archive/2026-10-01-hub-repository-agents/requirement.md)
> 更新：2026-10-01

## 目标与行为

主 Agent 的 CLI/MCP 使用明确 Hub、身份和空间完成委派；中心配置贯穿启动、续接、成果取回。保留既有 Codex/Claude 适配与工作区流程。

### ADDED / MODIFIED / REMOVED

- 必须连接 Hub；localhost 自托管也是显式 Hub 连接，无身份/成员资格时拒绝委派，不静默回退 local YAML。
- 两宿主身份与用户身份分别校验，Task/Round 固定发起人、空间、仓库和配置版本；续接重新鉴权，结果不因 Agent 共享而公开。
- CLI 从 Web 程序化取得用户接入凭据并存于统一数据根；不要求用户敲命令或将秘密放入模型对话。
- 项目尚未上线；破坏性更新直接清理旧试验历史并重新配置，不建设旧 YAML/历史迁移框架。提供范围清楚的显式清理入口，同时删除仅为历史兼容和假设扩展存在的过度封装。
- 原生 wait/read/停止/resume、主宿主关闭不恢复、子执行禁用 Runweft MCP、独立 worktree 留存和代码 bundle 回收规则保持。

## 验收

两宿主 × 两 runtime 完成 Hub 连接、本地共享/独立及同机远端链路；失效凭据/成员撤销阻止新轮次，任务与成果按当前授权读取。专用数据根清理后可重新接入并委派，外部仓库/worktree 和用户原生配置不受影响；真实物理远端条件缺口单独记录。
