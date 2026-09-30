# 仓库与中心 Agent 实施计划

> 状态：待执行
> 来源：[Requirement](requirement.md)
> 技术方案：[Technical](technical.md)
> 执行模式：逐任务提交；主 agent 按既有授权确认，实施前在当前工作区用 iclaude 评审一次。

## 交付目标

Hub 持有明确的 Repository、中心 Agent 版本与本人选择；同一仓库跨 clone/worktree 能找到相同配置身份，不同用户同名定义独立。解析使用同一资源授权，输出固定快照；不提前切换默认 MCP 或引入文件权威。

## 任务

### T1 Repository、checkout 与 Git 观察

- 状态：待开始
- 交付：规范 URL 候选、空间仓库/别名/登记、owner-only checkout 关联和匹配；HTTP 与 Hub CLI，抽取通用 Hub 认证客户端。
- 依赖：已归档资源归属。
- 验收：fork/host/大小写不误合并；跨 clone/worktree 和明确别名匹配；多 remote/漂移明确处理；无 remote 支持显式绑定；自报 URL 不增加权限、私有目录不外泄；创建重放不覆盖后续编辑。
- 验证：真实 Git 临时仓库、两个空间和跨进程重复请求；CLI 观察和 URL 登记产生相同规范键；成员退出删除 checkout；DTO/原始 URL 凭据清除；typecheck 与原客户端回归。

### T2 中心 Agent 版本、共享与治理

- 状态：待开始
- 交付：中心定义及不可变内容版本、条件编辑、scope、private/members/space、owner 操作、管理员摘要/禁用、成员移除事务级联；HTTP 和 CLI 管理。
- 依赖：T1。
- 验收：同名不同 owner 不覆盖；非 owner 管理员不能读取/修改私有内容；共享不授予编辑；旧版本不可变且当前授权保护历史；注销/禁用/退出重入行为清楚。
- 验证：多角色直接 API/CLI、版本冲突/重放/迁移与成员删除竞态；默认旧 Agent 测试保留。

### T3 个人选择、授权交集与固定解析

- 状态：待开始
- 交付：user × space × repository 选择和 runtime override，确定优先级与来源；复用资源解析、原生参数映射及同步提交判定；HTTP/CLI preview/resolve。
- 依赖：T2。
- 验收：无确定项不按名字挑选；失效仓库选择不偷偷回退；Agent/runtime 两权限交集；探测期间改配置/撤销/退出被识别，不能输出混合版本；返回快照不随编辑改变。
- 验证：显式/仓库/空间选择矩阵、跨仓库/用户/类型、异步竞态、并发 PUT 空间默认仅一行；两个宿主无额外 native runtime 改造。

### T4 组合验收与下游接口交付

- 状态：待开始
- 交付：编译 CLI 和组合网关、真实 Git clone/worktree、未改造 Runner 原生工具探测形成中心解析链路；需求矩阵与消费者说明。
- 依赖：T1–T3。
- 验收：两用户同仓库配置独立、共享/治理真实 API 与 CLI 一致、固定版本和目标可供阶段 5 使用；默认服务尚未切换时如实说明。
- 验证：typecheck、全仓 test、build、独立组合 smoke、既有资源授权必要回归、结构与文档校验；按授权自动验收后同步 Specs 归档。

## 风险与范围

中心 Repository UUID 不能替代 HAPI 原生 repositoryId；身份/权限/工具探测不复制实现。定义编辑和长期权限分别复核，版本历史不授予调用权。仓库别名只匹配已获授权元数据，不证明代码可读；实际 cwd/源基线与任务固定归阶段 5 接线。本地验收均使用专用目录，不要求用户参与。
