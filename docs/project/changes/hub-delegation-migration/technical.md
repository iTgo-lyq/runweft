# Hub 委派接入与配置切换技术方案

> 状态：已确认
> 来源：[Requirement](requirement.md)、[Research](research.md)
> 更新：2026-10-01。工程细节按既有授权制定；实施前由 iclaude 评审 Plan。

## 边界与就绪性

复用 TaskCoordinator/TaskStore、原生 ExecutionClient、文件与 Git helper；给它们接入已验收的 Hub 身份、资源、仓库和 Agent 服务。HAPI 缺少的是这些业务主体到任务的关系，原有 launcher、执行事实、工作区操作、文件存储不变。默认服务最后统一切换到 createConfigurationGateway，旧 root token 不再是公共认证入口。

方案拆为[委派与原生桥接](delegation-contract.md)、[凭据与本机连接](connection-contract.md)、[历史清理与简化](migration-contract.md)。没有待用户决定的产品问题。真实物理远端需要外部机器；本阶段用专用 Hub 与多个真实 Runner 验证同一协议，不把等价测试写成物理远端验证。

## 端到端路径

Agent 使用已保存的显式 Hub 连接；CLI/MCP 核对用户凭据和宿主元数据，观察 cwd 对应的 Git 仓库，向 Hub 提交选择器和任务意图。Hub 校验主机器归属、仓库关联和当前选择，在服务端生成不可变 Agent 快照，再固定任务/轮次与 native 目标。持久协调器依次准备工作区和输入、启动或续接、等待真实执行事实、停止子进程、收集文件与代码。

原生传输分两类：公开用户/Runner 请求继续经过现有 AccessGateway；中心协调器使用不对外暴露的受控 adapter，复用 NativeTransport、dispatch intent、对象和文件许可账本。adapter 对外形状仅匹配已有 HAPI HTTP 消费接口，不定义新的 runtime 协议。数据库中的业务 scope 与原生 namespace 分开：业务范围由可信 ownerId/spaceId 生成，原生机器/session 继续使用 runweft，文件继续使用 owner/space 的 fileNamespace。

部署角色与业务连接分开。自托管服务无需用户身份即可启动领取身份页面，但不会自动把 HAPI root 转成用户，也不会自动登记机器/runtime/Agent。完成 Web 到本机的凭据交接、机器接入后启动 Runner。已有远端 Hub 使用同一连接记录和同一个 Runweft CLI。

## 演进顺序

先独立验证受控原生桥接，再接入 Task/Round；随后交付凭据交接，切换默认服务和两宿主调用，最后提供未上线版本的旧数据清理并删除过度封装。中间提交保留旧测试入口供回归；最终生产入口没有 YAML、namespace token 或无 Hub 的委派退路。

存储按需要递增 state schema，只有具有中心归属的任务进入执行扫描；旧试验历史直接清理，不自动认领，不增加兼容转换层。用户配置、在线 Hub 和 HAPI 子模块不随本地开发改变。

## 验证策略

新接口覆盖两用户/两空间、请求重放、配置更新、共享撤回、token 轮换、成员移除、未确认派发与重启；结果权限独立于 Agent 分享。真实 Runner 验证 workspace/file RPC、两 runtime、native 会话续接及历史重建、代码 bundle 无 push 取回。连接页面使用 Playwright，历史清理使用专用 SQLite/文件样本验证重新接入和路径边界。每项任务通过聚焦验证后独立提交，整体验收执行 typecheck/test/build，再同步 Specs。
