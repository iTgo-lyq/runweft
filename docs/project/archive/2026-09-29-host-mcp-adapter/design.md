# 宿主接入与子执行的 MCP 禁用

> 更新：2026-09-29
> 来源：[Requirement](requirement.md)、[Research](research.md)。保留前期讨论；正式实现方案在 Technical 中落实。

## 最新边界

用户已明确：HAPI 调度的 Runweft subagent 移除全部 Runweft MCP 工具；原生内置 subagent 的创建、递归和工具继承由原生客户端处理。此前为所有原生子会话做动态工具列表分流的候选方案不再适用。

主宿主继续通过全局安装的 Runweft MCP 获得业务工具，以真实调用元数据或公开 hook 绑定身份。Codex 首次 tools/list 缺少身份不阻断静态工具发现；每次业务调用仍必须有有效身份。Claude 的启动环境与 hook 配合处理会话切换、同目录多会话；不以 cwd 或模型自报推断身份。

受控子执行在原生启动前应用仅针对 Runweft 的工具禁用，续接时重新应用；其他 MCP、模型设置、工程 skill 与内置 agent 工具正常继承。结果由 HAPI 原生输出、消息与执行事实收回，子端不需要 Runweft MCP 汇报工具。

## 复用 HAPI

复用现有启动、原生配置、会话读取与续接入口；新增管理参数只承载必要的逐执行工具禁用，保留到 HAPI 原有会话元数据。Codex 的参数在各 root 的 thread 配置应用，不能放进共享 engine 的全局环境；Claude 使用原生工具过滤参数，复用现有 launcher。

Runweft 的委派入口仍拒绝受控子执行通过 CLI 再派生，结合已有 HAPI_SESSION_ID/调用上下文核对。这个限制不扩展到原生内置 subagent，不新增用户进程间的权限隔离。

## 安装与结果传递

显式 CLI 提供全局安装、更新、检查和卸载，只维护 Runweft 自身配置项，不固定安装时 cwd。开发验收使用专用配置目录。

业务响应、等待及取消沿 MCP 传递；取消等待不取消子执行。主动注入或唤醒只声明实际支持的路径。主宿主退出后的恢复不属于本项目目标。
