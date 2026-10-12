# 仓库与中心 Agent 技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md)
> 更新：2026-09-30。主 agent 按既有授权制定工程细节，Plan 实施前完成 iclaude 评审。

## 交付边界

在 createResourceGateway 上组合仓库目录、checkout 关联、中心 Agent 与个人选择的领域服务、HTTP 和同一 Runweft Hub CLI。默认 MCP/委派切换、旧 YAML 导入、Web 页面属于后续 Change；本阶段提供可独立组合、验证的权威解析。保持默认旧入口可运行，不修改 HAPI 源码。

详细契约拆为 [仓库与 checkout](repository-contract.md)、[Agent 与选择](agent-contract.md)。增量表与 AccessStore 共享同一连接，成员移除级联纳入 HubStore 的同一事务；不跨 SQLite 连接嵌套写事务。

## 模块与唯一职责

| 模块 | 负责 | 复用 |
| --- | --- | --- |
| Repository store / Git observation | 空间内稳定 ID、明确别名、当前用户 checkout 元数据与匹配 | 本机 Git 命令；不改变 HAPI 的 native repositoryId |
| Agent store | 定义版本、owner/共享、治理和个人选择 | 身份/成员与同一 state.sqlite |
| Agent resolver | 确定选择来源、仓库范围、权限交集和固定快照 | ResourceService.resolve、HubResourceStore.usable |
| Hub HTTP/client/CLI | 严格输入、短 JWT、结构化管理与诊断 | 既有连接/凭据读取、RequestLease、一个 hub 命令域 |

HAPI 缺少的是上述业务目录与选择，不缺执行、会话或工具探测。本阶段不启动模型，不检查模型凭据，不增加 skill/MCP 版本或任意 launcher 参数；最终 launchOptions 仍沿原有两个适配，固定移除 runweft MCP。

## API 和版本

新增 `/api/runweft/repositories`、`/api/runweft/checkouts`、`/api/runweft/agents`、`/api/runweft/agent-selections`，以及 `/api/runweft/agent-resolution`。均要求用户短 JWT 和明确选定空间。健康能力新增 hubRepositories:1、hubAgents:1；通用 Hub 客户端抽取为独立连接基类，资源客户端保留原契约。

组合网关以显式 capability 参数累加领域能力，不丢失已交付资源/身份能力；尚未接入的 Agent 接口不提前声明可用。T2 的定义管理独立声明 hubAgentDefinitions:1；T3 完成解析后再声明 hubAgents:1，客户端分别检查对应能力。“全局 Agent”仅表示所选空间内跨仓库，不提供未选空间或跨全部空间的配置。

创建 Repository/Agent 使用 owner 作用域的 UUID requestId 与规范内容摘要，响应丢失可查询同一请求，重放不产生第二个对象或覆盖之后的编辑。CLI 创建显式接收 `--request-id`；Web 后续按一次操作保存一个 requestId。更新定义用 expectedVersion 条件写，冲突 409，不静默覆盖。对象 owner/space/稳定 ID 不接受修改字段。

业务控制体最多 64 KiB；名称、描述、instructions 分别有明确长度限制，严格拒绝未知原生参数或归属字段。路径只出现在本人 checkout DTO；远程 URL 在写入、输出或请求日志之前规范化/脱敏。404 合并不可见与不存在，已知越权 403；配置/选择变化 409，并给出可行动原因，不回退同名对象。

## 授权和快照边界

每个 API、CLI 解析使用同一领域判定，URL/Repository ID 本身不是授权。查询历史 Agent 版本只对当前 owner 开放；调用者的任务快照由阶段 5 单独按任务权限保留，不因 Agent 后来分享而曝光。

解析在原生探测前后重查 Agent 当前成员/调用权、定义版本、治理、Repository 以及所选 runtime；同一 RequestLease 传播撤销。业务协调器之后必须在任务接受/派发/续接时使用同步判定再次检查，不能直接信任客户端提交的快照。阶段 5 持久固定 Agent ID/版本/仓库/选择和 runtime，复用当前授权钩子；本阶段不提前复制 Task/Round 状态机。

## 验证

真实 Git 临时仓库和跨 clone/worktree，两个空间、同名不同 owner Agent、成员退出/重入、权限交集、离线/异步撤销与条件写竞争。编译 CLI 配合独立 Hub/Runner 验证中心解析和不可变快照，不触碰用户配置。全面 typecheck/test/build 与已有资源授权回归；默认使用路径的切换和模型执行在后续领域验收。
