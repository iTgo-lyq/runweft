# 机器与 Runtime 归属技术方案

> 状态：已确认
> 来源：[需求](requirement.md)、[Research](research.md)
> 更新：2026-09-30。主 agent 按既有授权制定工程细节；Plan 实施前完成 iclaude 评审。

## 交付边界

在已验收独立授权网关上提供机器/Runtime 领域服务、HTTP 与 Hub 管理 CLI。复用原 HAPI 机器事实与工具探测；新增内容仅是中心所有者、登记状态、空间关联、共享和治理。默认 serve/Runner 与旧资源的迁移属于阶段 5，Web 管理页面属于阶段 6；本阶段以独立组合实例交付可验证完整领域。

机器、runtime、Agent 继续是独立对象。machineId 由 Hub 分配后交给原生 Runner；runtime 是该机器上的 codex/claude，Hub 内 machineId × flavor 唯一且稳定，默认私有，不是任意命令 profile。机器和 runtime 不按仓库或项目重复创建。

## 注册与凭据

已认证用户提交 enrollment requestId 与客户端生成的随机机器凭据；Hub 事务创建机器归属、登记及凭据摘要，分配新的 machineId。禁止在普通 enrollment 指定旧 machineId/owner；重放同一 owner/requestId 必须凭据摘要一致，只有仍为当前有效机器凭据时返回原 machineId，不重复创建；已替换/撤销返回 409 `machine_credential_replaced` 和原 machineId，不能被 CLI 解读为旧凭据可用。跨主体的 token 摘要冲突明确返回 409，不泄露已有对象。所有者也可以查询原 requestId 的非秘密结果。

CLI 使用规范化 Hub origin 与既有 connectionName，将 requestId/随机 token 先原子创建到 `connections/<name>/machine.json`（0600）；同目录并发接入共享这一记录，禁止覆盖另一个身份的记录，再发送 enrollment；正文与日志不输出 token。响应丢失用原请求和已保存凭据确认。显式替换保存 active/pending 两份状态，服务端使用 expectedCredentialId 条件替换并撤销该机器所有旧机器凭据；确认后才把 pending 转正，失败或丢响应可查询/交换新 token 核实；相同 token 重放可确认，已撤销的旧 token 不能恢复。替换会使原有机器连接失效，CLI 明确报告需按新凭据重新启动 Runner。自动配置 Runner 的默认启动路径在阶段 5 接通，本阶段只输出机器 ID、凭据文件位置与原生接入所需的非秘密事实。

资源注销只取消可选状态，保留 ID、配置和原生历史；显式凭据撤销另外处理原生连接。资源权限变更立即阻止新的目标解析。已接受任务的停止/收尾属于委派层，它须在后续接线时持续复核本服务授权；本阶段不另建任务取消队列。

## 空间与权限

机器所有者可关联自己有成员资格的空间，关联本身不开放任意机器操作或 runtime。Runtime 分享只能指向其机器已关联的空间，所有者必须仍为成员。使用目标时要求调用者选定空间且仍是成员，机器已关联该空间；所有者可使用其私有 runtime，其他成员须有 runtime 的空间分享。

| 动作 | 所有者 | 获分享的空间成员 | 空间管理员，非资源所有者 |
| --- | --- | --- | --- |
| enrollment、机器凭据、名称/登记/关联、完整工具发现 | 可以 | 不可以 | 不可以 |
| runtime 注册、名称/登记、共享修改 | 仅机器所有者 | 不可以 | 不可以 |
| runtime 使用与实时 check | 仍须机器关联当前空间、所有者为成员且未被本空间禁用 | 可以，仍受当前空间禁用约束 | 不因管理角色豁免；有分享才可用 |
| 机器/runtime 概要 | 本人全局资源 | 当前空间获分享的资源及其机器概要 | 当前空间已关联机器及其 runtime 治理概要 |
| 禁用/解除禁用 | 同时是该空间管理员时 | 不可以 | 仅本空间，不能改变所有者或其他空间 |

治理禁用可针对本空间的机器或单 runtime；其他空间不受影响。机器的空间关联撤回时，同事务撤回该机器在该空间所有 runtime 分享；关联恢复、runtime 重新分享或登记不清除已有禁用。所有者被移出空间时，在成员移除事务中撤回其机器关联和 runtime 分享；重新加入不会自动恢复旧分享。

私有 runtime 不向普通成员出现。共享使用者的响应只包含 ID、展示名、所有者、类型、版本/版本状态、是否发现工具、在线与可用原因；不返回主机目录、executable 绝对路径、Runner state 或其他私有 runtime。管理员私有概要不触发实际工具探测，也不返回这些详情。原生 `/api/machines` 控制面仍由已有网关仅向机器所有者开放。

## 存储与接口

同一 state.sqlite 增量保存新领域表，与旧 namespace 表并存，旧数据不自动认领。主要关系：机器登记及 enrollment request 关联；机器 × space 的有效关联；runtime 的 owner/machine/flavor/name/registered/最近探测；runtime × space 的分享；space × 对象的治理禁用与操作者/时间。授权对象直接使用既有 AccessStore 机器归属。凭据继续由 AccessStore 保存摘要，不增加凭据副本。

独立网关的用户业务入口沿 `/api/runweft/resources`，接受短期用户 JWT；当前空间来自已验证 JWT，不接受 query/body 冒充调用者或 owner。关联/分享/治理请求中的 spaceId 是待操作对象，仍需验证该空间权限。接口返回 `capabilities.hubResources=1`，不会将旧网关误认为可用的新身份中心。

| 资源 | 路径及动作 |
| --- | --- |
| Enrollment | POST `/machines/enroll`；GET `/machines/enrollments/:requestId` |
| 机器 | GET `/machines`、`/machines/:id`；PATCH 名称；POST `/machines/:id/register` 恢复登记；DELETE 取消登记 |
| 机器凭据 | PUT `/machines/:id/credential` 显式替换；DELETE 撤销；GET 仅凭据 ID/状态，无 token/摘要 |
| 空间关联 | PUT/DELETE `/machines/:id/spaces/:spaceId`，仅机器所有者 |
| 发现 | GET `/machines/:id/discover`，仅机器所有者；沿 HAPI 两种工具实际探测 |
| Runtime | GET 列表/详情/check；POST 注册；PATCH 名称；DELETE 取消；GET `/runtimes/:id/resolve` 返回固定执行目标 |
| 分享 | PUT/DELETE `/runtimes/:id/spaces/:spaceId`，仅所有者 |
| 治理 | PUT/DELETE `/spaces/:spaceId/blocks/:machine-or-runtime/:id`，仅空间 owner/admin |

组合函数复用 createAccessGateway，业务回调扩展传递现有 RequestLease，取消/撤销沿 signal 中断原生探测，保持已知 ResourceError/HubError 的 status/code/hint。机器列表以 Hub 登记为主合并原生事实，未首次连接也可见；首次连接前改名明确报错。取消登记不用 AccessStore.retire，不顺带撤销原生凭据。

请求严格字段和 16 KiB 控制体；不允许角色/归属通过更新字段改写。列表和详情返回允许的操作，服务端仍逐次检查。可见但不可用的目标给出清楚 reason；不存在/不可见统一 404，已知角色越权 403。每个异步原生探测/名称更新前后重查主体和对象；本地写事务重查成员、登记和权限，不用请求开始时的快照提交。

新的公开目标解析只返回 runtimeId/machineId/flavor、version/versionStatus/checkedAt/toolFound 及 owner/space 权限事实；不复用含完整 inspection 的旧 ExecutionTarget。所有者完整探测另作为 owner-only 字段，共享与治理 DTO 按白名单构造，不带其他空间关联/分享、主机名回退、路径或原生错误文本。不能给共享用户原生机器控制凭据。领域服务导出同步、仅查数据库的 usable(userId, spaceId, runtimeId)，Agent 交集、解析前后和委派提交使用同一判定。配置或权限变化不改已有快照；新一轮/未启动执行必须重新解析。私有/共享列表每台机器最多探测一次，单机失败可见而不隐藏其他资源；历史探测明确不是当前可用证据。

## 原生入口的组合授权

只保护资源 resolve 不足以执行空间禁用。组合新资源服务时，原生机器 spawn、会话 resume/reopen/fork/clear 以及实际 outgoing spawn RPC 使用同一同步领域权限钩子；RPC 使用已绑定会话的 owner/space 与 machine/flavor，机器 peer resume 不按机器所有者替代任务发起人。共享 target 的完整工具探测不进入 Runner 凭据。空间内启动必须有当前有效登记、关联/分享且未禁用；空间外原生所有者自用会话不伪装为团队任务。阶段 5 为业务任务固定 runtimeId，并在接受/派发/续接的同事务内复核，领域层不复制委派状态机。

## CLI 与兼容

命令、输出与接入恢复细节见 [CLI 契约](cli-contract.md)。

新增 `runweft hub machine ...` / `runweft hub runtime ...` 管理入口及 typed HubResourceClient；这是同一 CLI 的 Hub 域，不要求用户使用第二个程序。显式 Hub URL 与身份文件/受支持环境变量建立连接，空间可显式选择；不隐式启动本地服务或回退旧认证。机器接入记录放统一数据根按 Hub 分区，权限 0600，不写仓库或系统临时目录。不自动修改当前用户的原生配置。

身份输入使用独立 RUNWEFT_IDENTITY_TOKEN 或身份文件，不复用旧 RUNWEFT_HUB_TOKEN；可读取现有 Web 下载备份，必须核对文件内 Hub origin 与目标一致。data paths 显示机器记录的位置。身份文件和浏览器到 CLI 的长期接入体验在阶段 5/6 收口；本阶段管理命令可在专用配置完整执行。原有 root resource 命令保持现有行为，默认路由与最终命令收敛在阶段 5 迁移，不临时让新身份通过旧入口。

本机 machine.json 的短时读改写复用既有 client.sqlite 写事务互斥，不在 SQLite 保存凭据副本，也不另建锁文件或临时数据库。网络请求位于事务之外，进程退出会自动释放锁；并发首次接入读取同一已保存请求，响应丢失保留 active/pending。显式 `rotate-credential --replace-pending` 才放弃已失效的 pending 请求，普通重跑继续确认原请求。

## 验证与就绪性

无新增用户决策或外部凭据前置。真实 SQLite 的跨连接/并发/重启与两空间、多角色覆盖所有权、关联、分享、禁用、注销和成员移除；撤销发生于异步探测期间也应拒绝提交。真实 HAPI + 未改造 Runner 证明 enrollment、原生登记、工具发现和共享目标解析，不要求模型登录。真实 CLI 使用独立 home/身份文件，验证重复接入、丢响应恢复、凭据不出现在输出或其他 Hub 的文件中。归档前 typecheck、test、build、结构校验全部完成。
