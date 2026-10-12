# 机器与 Runtime

默认 serve 组合身份/空间、HAPI 授权和集中资源领域，提供 hubResources:1。root 命令与 hub 子命令共用中心身份及资源服务。机器/runtime 是 Hub 全局对象，Agent 是独立消费方。

## 机器与凭据

认证用户提交 UUID requestId、客户端预存的随机 `rw_mc_` 凭据及可选名称。Hub 事务分配 machineId、确定 owner、登记机器并保存凭据摘要；不能提交已有 machineId/owner 认领。相同 owner/requestId 与参数重放保持同一 ID，但原凭据已替换/撤销时返回 `machine_credential_replaced`。独立查询 enrollment 仍可取得原机器的非秘密结果。跨 owner 的 token 摘要冲突不暴露既有对象。

凭据替换使用 expectedCredentialId 条件写入，撤销该机器全部旧机器凭据；不撤销其他任务凭据。当前有效新 token 重放可确认丢失响应，旧/已撤销 token 不能恢复。GET 凭据接口只返回 ID/状态，不返回 token 或摘要。显式撤销关闭原生连接权限；取消机器登记只停止新目标选用，保留机器凭据和原生历史。

机器列表从中心登记合并 HAPI 库存，首次未连接显示 pending，离线保留配置。所有者可登记/取消、改名和关联自己仍为成员的空间；名称更新沿原生 HAPI，首次连接前明确失败。关联本身不授予控制权或创建 runtime。

## Runtime 与空间授权

同一 machineId × codex/claude 对应稳定 runtime UUID，所有者继承机器 owner。重复注册或取消后恢复保留 ID；名称不承担路由，不支持任意 launcher profile。注册要求机器已登记、在线且实际工具存在；探测期间机器/runtime 被取消不能由迟到请求恢复。

| 主体 | 可见与操作 |
| --- | --- |
| 所有者 | 本人全局配置、完整工具详情、改名/登记/空间分享；在空间中使用仍受关联及禁用约束 |
| 获分享的成员 | 当前空间获准 runtime 与对应机器概要、check/resolve；不能修改配置、分享或调用原生机器控制 |
| 非所有者的空间 owner/admin | 已关联资源的治理概要及本空间禁用；私有概要不触发工具探测，不隐含使用或编辑权 |

使用 runtime 必须选择空间，调用者与资源所有者均为当前成员，机器关联该空间、机器/runtime 已登记、机器凭据有效，且非所有者有明确 runtime 分享。机器或 runtime 的空间禁用只影响该空间，重新登记/分享不会清除。撤回机器关联或移除所有者时，同一事务撤回该空间所有 runtime 分享；重新加入不恢复旧关联或分享。

不可见对象与不存在对象均返回 404，已知角色越权返回 403；可见但不可用的资源返回具体 reason。列表/详情显示当前空间机器及 runtime 的禁用状态，不暴露其他空间授权。

## 原生事实与执行解析

库存及两种工具详情复用现有 HAPI 接口；不改造 runtime、launcher、版本探测或心跳。列表每台机器最多查询一次；单机失败在对应项显示，其他机器继续返回。离线或查询失败保留旧观察、标记 inspectionCurrent=false，不证明当前可用。所有响应仍标明模型认证/任务执行未检查。

共享者与管理员概要仅有 ID、名称、owner、类型、版本/版本状态、checkedAt、工具是否发现、在线与可用原因。完整 executable/inspection、Runner 状态、主机名回退、其他空间分享和原生错误文本不进入该 DTO。公开解析目标为 runtimeId/machineId/flavor、ownerId/spaceId/shared 与裁剪版本事实，所有者解析也不取得完整 inspection。

同步 `usable(userId, spaceId, runtimeId)` 是中心配置/委派的资源授权依据。原生机器 spawn、会话 resume/reopen/fork/clear 与实际 outgoing spawn RPC/ack 再查当前权限；机器 peer 按已绑定会话的 owner/space 判断，不能换成机器所有者。无空间的原生所有者个人会话独立于团队委派。业务任务后续轮次须重新核对权限，旧解析快照不构成长期使用授权。

## API 与 CLI

前缀 `/api/runweft/resources` 接受 Runweft 用户短 JWT；选定空间来自 JWT，不接受 query/body 改写 owner。机器/任务 token 不能进入管理接口。业务回调接收现有 RequestLease，异步探测前后及持久事务重查，撤销/断开取消请求。

| 接口 | 方法 |
| --- | --- |
| `/machines/enroll`、`/machines/enrollments/:requestId` | POST 接入；GET 查回执 |
| `/machines`、`/machines/:id`、`/machines/:id/register` | GET 列表/详情；PATCH 名称；DELETE 取消登记；POST 恢复 |
| `/machines/:id/credential` | GET 元数据；PUT 条件替换；DELETE 撤销 |
| `/machines/:id/spaces/:spaceId`、`/machines/:id/discover` | PUT/DELETE 关联；GET 所有者工具发现 |
| `/runtimes`、`/runtimes/:id`、`/runtimes/:id/check`、`/runtimes/:id/resolve` | GET；POST 注册；PATCH 名称；DELETE 取消 |
| `/runtimes/:id/spaces/:spaceId` | PUT/DELETE 分享 |
| `/spaces/:spaceId/blocks/:machine-or-runtime/:id` | PUT/DELETE 本空间治理禁用 |

`runweft hub --url <origin> --identity-file <file> [--space <id>] machine/runtime …` 提供以上管理动作，具体命令见[已验收 CLI 契约](../../archive/2026-09-30-hub-resource-ownership/cli-contract.md)。省略身份文件时只读取 RUNWEFT_IDENTITY_TOKEN，不复用旧 HAPI token；Web 备份核对 origin 和身份 ID。客户端先检查能力再发送凭据，不跟随跨地址重定向、不自动启动服务或回退本地配置。check 不可用时退出 1，错误写 stderr。

## 持久化与验证

机器登记/关联、runtime/分享、空间禁用、凭据与执行授权归属保存在同一中心state.sqlite。只支持[部署](../deployment/spec.md)规定的当前格式，不转换旧namespace配置。原生历史、文件和执行状态继续归HAPI。

CLI 先在 `connections/<connectionName>/machine.json`（0600）保存 Hub/owner/request/token，再提交；轮换保留 active/pending，普通重跑确认原请求，显式 `--replace-pending` 才放弃旧 pending。跨 Hub 分区，换身份拒绝复用。文件读改写借用既有 client.sqlite 短写事务互斥，不复制凭据入库，网络不持锁，进程结束不遗留锁文件。`hub paths` 显示显式 Hub 的记录位置，root paths 显示配置当前连接。
