# Codex 与 Claude Code 的宿主身份及 MCP 适配

> 状态：草稿
> 规模：大型
> 更新：2026-09-29
> 确认依据：只接入 Codex 与 Claude Code；交互尽量对齐原生 Codex；不要求宿主关闭后恢复；识别主/子角色并返回不同工具列表，拒绝子会话继续派生。具体映射与兼容验证未完成。

## Review 导读

本 Change 提供可信宿主身份、角色分流、MCP 工具承载和结果传递机制。具体协作工具及派生到结果返回的用户流程归[委派生命周期](../delegation-lifecycle/requirement.md)，避免身份识别反向依赖调度系统。

接入侧仅支持 Codex 和 Claude Code。这是宿主 MCP 适配范围，不是重新开发它们的执行 runtime；执行侧由 HAPI 内置适配负责。

何时调用什么 agent 仍由业务 skill 与主 agent 决定。适配层按角色暴露已注册能力；主会话可获得协作工具，子会话只获得必要的汇报/协作能力。委派入口还须再次拒绝子角色派生。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [统一 CLI](../unified-cli-and-deployment/requirement.md) | MCP 进程入口、配置、真实 cwd 绑定及 HAPI 连接可用 |
| 前置 | [HAPI 执行契约](../hapi-subagent-foundation/requirement.md) | 原生身份、受控启动上下文和已有会话读取能力可用 |
| 下游 | [委派生命周期](../delegation-lifecycle/requirement.md) | 消费宿主身份、角色、工具承载和结果传递能力，注册实际协作操作 |

## 独立验收与交付边界

使用专用环境及不产生真实委派的测试工具，在真实 Codex/Claude Code 主会话、原生子会话和 HAPI 受控子进程中验证身份、工具列表与响应。测试工具不进入正式产品工具列表；不能仅模拟 MCP 请求就宣布宿主适配完成。

受控子角色通过 HAPI 启动上下文绑定，原生子角色按宿主证据识别；不查询尚未实现的委派服务来猜角色。适配层验证角色与能力，业务入口如何处理 delegation 由下游负责。本 Change 不创建父子记录、不调度任务、不收集 Git 成果。

## 行为变化

### ADDED

#### `host-mcp/install`：一键辅助全局安装

提供显式 Runweft CLI 命令，为 Codex、Claude Code 全局安装、更新、检查和卸载 Runweft MCP。无需用户手工拼接配置；只修改 Runweft 自身条目，保留其他 MCP、原生设置与模型凭据。重复安装不重复注册，写入失败不留下半份配置，提供备份与恢复依据。

安装结果可诊断实际客户端配置位置、命令路径、模式与连接情况；安装时不把当前项目目录固定成所有未来会话的 cwd。配置变更仅由用户明确运行安装命令触发，开发验收使用专用配置目录。本 Change 可以用诊断工具验证安装后的真实 MCP 连接，不依赖完整委派功能。

#### `host-mcp/identity`：宿主身份与角色

从宿主元数据、进程启动上下文与 HAPI 已有关联识别会话；模型输入的路径、session ID 或 `is_subagent=false` 不作为身份依据。Runweft 启动的子会话即使对原生 CLI 是独立 root，也仍是 Runweft subagent。

同时区分原生宿主派生的子会话；工具列表按实际连接/会话角色提供，调用入口再次检查禁止递归。身份未能确定时不能默认开放派生工具。共享 MCP 连接下的原生子会话工具可见性需实测，不能只凭普通 MCP 会话 ID 宣称可区分。

#### `host-mcp/interaction`：接近原生 Codex 的交互

将业务工具提供的身份、状态、报告与错误正确传回宿主，支持等待响应及取消的传递；不将宿主取消等待变成执行取消。派生返回值、轮次状态和续接语义由委派 Change 定义，适配层不复制一套任务状态。

基础结果通过 MCP 工具响应进入主上下文；通知、主动注入和宿主唤醒分别核对可用入口。不能把 MCP 日志通知、工具列表更新或旧工程的 waiter 通知宣称为宿主后台唤醒。

#### `host-mcp/scope`：只覆盖在线宿主协作

支持活跃主会话中的协作；不做主宿主退出后的会话恢复、重启重绑定或离线自动唤醒。结果和子会话记录可由 HAPI 保留，用于看板与主会话尚在线时的子任务续接；持久数据不等于承诺恢复宿主。

## 验收标准草案

- [ ] 两种客户端的全局安装、重复安装、更新、卸载和失败恢复均自动验证；不要求用户手工改配置或参与本地验收。
- [ ] 其他 MCP、模型配置与凭据保持有效；全局入口在不同项目 cwd 中不串工作区。
- [ ] Codex 和 Claude Code 的真实会话可取得可信身份，并接收结构化工具结果；不依赖模型自报或已存在的委派记录。
- [ ] Runweft 子会话和可识别的原生子会话不展示派生工具，直接调用也被拒绝；允许必要的自身汇报。
- [ ] 多个会话在同一 cwd 并行时不串身份；Claude `/clear`、显式 resume 与启动身份差异被处理。
- [ ] 等待取消、超时和宿主断开正确传递给业务调用方，不擅自重放工具请求；主动注入仅对实测支持的宿主路径声明。
- [ ] 首次工具发现即可使用正确角色；原生子会话共用连接时的工具可见性有真实证据，不能仅用调用拒绝替代。
- [ ] 无需恢复已关闭的主宿主，且不修改用户现有全局配置来完成本轮设计调查。

## 协作资源

- [Claude 环境变量](https://code.claude.com/docs/en/env-vars)、[Hooks](https://code.claude.com/docs/en/hooks)、[MCP](https://code.claude.com/docs/en/mcp)（读取 2026-09-29）：stdio 会话身份、角色事件与工具列表更新有公开入口，但需处理连接和原生子会话边界。
- [Claude 会话 API](https://code.claude.com/docs/en/agent-sdk/sessions)、[Codex App Server](https://learn.chatgpt.com/docs/app-server)（读取 2026-09-29）：提供读取与恢复能力；优先经 HAPI 已有实现使用。
- [旧工程 Gateway](https://github.com/iTgo-lyq/runweft-archive/blob/0cbfa01f522488b2ede60e47adc1117698b54748/apps/runweft/src/gateway.ts)（重读 2026-09-29）：只参考交互及历史身份验证证据；不迁移执行架构。差异见 [Research](research.md)。
