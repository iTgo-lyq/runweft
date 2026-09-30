# Hub 后台与 Agent 接入 Skill

> 状态：已确认
> 规模：大型
> 前置：[资源归属](../../archive/2026-09-30-hub-resource-ownership/requirement.md)、[中心 Agent](../../archive/2026-10-01-hub-repository-agents/requirement.md)、[委派接入](../../archive/2026-10-01-hub-delegation-migration/requirement.md)
> 更新：2026-09-30

## 目标与行为

用户通过 Web 看和维护有权操作的机器、runtime、Agent、仓库、成员与任务；安装启动配置交由 Agent/产品 Skill，提供一个 Runweft 产品入口。

### ADDED / MODIFIED

- 扩展身份/空间页面为完整资源后台，明确所属人、私有/共享、作用仓库、来源版本和不可用原因；角色限制必须来自服务端，私有数据不通过计数泄露。
- 原生会话、审批和文件 UI 沿 HAPI 复用，跳转后保持同一身份授权。
- 产品 Skill 引导主 Agent 安装、连接指定 Hub、凭据接入、分别登记机器/runtime、配置 Agent、诊断升级及首次委派；原生模型配置不擅自修改。
- 官网引导“交给 Agent 完成接入”，保留工程命令参考和真实四平台产物；配置/持久数据位置清楚，报错可操作。

## 验收

Playwright 覆盖桌面/窄屏、空间切换、资源管理、任务详情、直接 API 越权与完整接入路径。专用 Codex/Claude 配置自动验证安装/更新/卸载与首个任务，保留其他 MCP；用户无需亲自操作 CLI。本 Change 不重做原生 runtime UI 和业务自动调度。
