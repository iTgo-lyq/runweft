# 空间与成员

Hub 空间是成员授权边界，不是 Git 仓库、磁盘工作区或 HAPI namespace。一个身份可加入多个空间。新身份的初始空间与其他协作空间使用相同成员模型，可改名、邀请和退出，不存在额外的 personal 类型限制。

## 角色

| 角色 | 权限 |
| --- | --- |
| owner | 改名、邀请 member/admin、修改成员角色（含授予 owner）、移除成员和管理邀请 |
| admin | 改名、邀请和移除普通 member、管理 member 邀请；不能创建 admin/owner 或移除其他管理员 |
| member | 查看本空间和成员，主动退出 |

每个空间必须保留至少一个 owner，退出或降权以数据库立即事务判断；多个进程同时退出也不能移除最后 owner。空间外请求返回 404，空间内越权返回 403。嵌套成员/邀请查询同时限定 spaceId，不接受仅凭对象 ID 操作其他空间。

## 邀请

邀请使用独立的 `rw_inv_` token，服务端只存摘要，生成时返回明文。有效期 24 小时，只能由一个身份消费，不授予 owner。owner/admin 可列出待使用邀请的 ID、角色、创建人和过期时间，列表不返回 token/摘要；member 不能列出或管理邀请。

兑换事务重新校验创建人的当前管理权，再条件更新消费状态与成员关系。同一消费人重试且仍是成员时返回既有成员关系；其他人重放、过期/撤销、消费人已经退出或被移除时返回 410。已从其他途径加入的人收到 409，不消耗邀请。邀请创建人被降权或移除时撤销其待使用邀请，恢复角色不恢复旧邀请。

## 接口与持久化

前缀 `/api/runweft/hub`，凭 [身份 token](../../identity/tokens/spec.md) 操作：

| 路径 | 方法 |
| --- | --- |
| `/spaces` | GET 本人空间；POST `{name}` 创建并成为 owner |
| `/spaces/:id` | GET 本空间和当前角色；PATCH `{name}` |
| `/spaces/:id/permissions` | GET 当前改名/邀请/成员角色/移除/退出能力，包含最后 owner 限制 |
| `/spaces/:id/members` | GET 成员 ID、名称、角色与加入时间 |
| `/spaces/:id/members/:userId` | PATCH `{role}`；DELETE 移除或自己退出 |
| `/spaces/:id/invitations` | GET 待使用邀请；POST `{role}` |
| `/spaces/:id/invitations/:id` | DELETE 撤销 |
| `/invitations/accept` | POST `{token}` 接受邀请 |

Web `/hub` 提供上述管理动作，按钮使用服务端 permissions，空间切换仅改变当前选中项；服务端始终复核权限。状态在同一业务库的 hub_spaces/hub_memberships/hub_invitations 表中持久保存。升级不会自动将旧 namespace、机器或历史任务归给新身份。

成员移除还在同一事务撤销该空间的任务凭据、取消派生与文件输出许可，并撤回该成员拥有的机器关联及 runtime 分享；同时删除其 checkout、个人 Agent 选择和对其显式授权，并将其 owned Agent 的分享撤为 private；内容版本、登记与治理事实保留。重新加入不恢复旧许可、个人配置关联或 owned Agent 分享。集中资源治理见 [Hub 资源归属](../../resources/ownership/spec.md)。独立网关的请求与长连接如何失权见[执行通道授权](../../execution/access/spec.md)。
