# 身份 token 与空间技术方案

> 更新：2026-09-30
> 来源：[需求](requirement.md)。主 agent 按已有授权决定工程细节；实现前执行 iclaude Plan 评审。

## 实现路径与依据

现有 `src/api.ts` 验证 HAPI JWT，资源只获得 namespace；`src/proxy.ts` 透传剩余 HTTP/Socket。HAPI 没有当前产品所需的独立身份、membership 和资源所有者，因此在 Runweft 上层新增身份/空间模块，不改变原生执行。直接复用 `src/state.ts` 的 SQLite、事务和受控数据目录，Web 复用现有静态资源嵌入方式，不引入服务框架。

API 位于 `/api/runweft/hub/`，在旧 JWT 路由前分流；Web 位于 `/hub`，本阶段不替换原 `/runweft` 或 HAPI UI。只有创建身份无须凭据，其他 API 用 `Authorization: Bearer <identity-token>`；token 不接收于 query/cookie。所有新接口独立校验身份，旧 HAPI JWT 不能伪造 userId。旧资源继续既有信任域，新 token 在旧路由验证失败；完整执行边界由下个 Change 承担。

## 存储与 API

schema v7 增量创建 `hub_users`（ID、名称、凭据摘要、创建时间）、`hub_spaces`（ID、名称、创建时间）、`hub_memberships`（space/user/role）和 `hub_invitations`（ID、space、摘要、创建人、角色、有效期、消费人/消费时间/撤销状态）。摘要唯一，membership 主键为 space/user 并索引 user，角色有 CHECK 约束。HubStore 由 serve 创建并在关闭时释放，请求不反复执行迁移。不复制 HAPI session/message 数据；全在 `<home>/server/runweft/state.sqlite`，无新临时权威库。

token 使用 32 字节密码学随机值与 `rw_id_` 前缀，SHA-256 摘要查找；创建响应返回明文。userId 是稳定 UUID，与秘密分离。创建身份和个人空间同事务提交；轮换比较当前摘要，避免两个并发请求同时成功。

轮换由客户端用系统随机源生成同格式的新 token，先保存并提供备份，再用旧凭据提交替换。响应丢失时用已保存的新 token 查询本人核实，不盲目重发或创建替代身份；服务端替换未成功时旧 token 仍可用。创建身份的响应丢失可能留下尚未使用的孤立身份，明确报告结果未知，由用户决定是否重新创建；不自动再发创建请求。

| 路径（相对 API 前缀） | 方法与行为 |
| --- | --- |
| `/identities` | POST `{name}`，返回 identity/token/personalSpace |
| `/identity` | GET 本人；PATCH `{name}` 只改显示名称 |
| `/identity/rotate` | POST `{token}`，替换为客户端已保存的新凭据；返回同 identity，旧 token 立即无效 |
| `/spaces` | GET 本人成员空间；POST `{name}` 创建且成为 owner |
| `/spaces/:id` | GET 空间与本人成员角色；PATCH `{name}` 仅 owner/admin |
| `/spaces/:id/members` | GET 本空间成员的 ID/显示名称/角色 |
| `/spaces/:id/members/:userId` | PATCH `{role}` / DELETE，按角色及最后 owner 规则执行 |
| `/spaces/:id/invitations` | GET 脱敏列表；POST `{role}` 生成 24 小时单次邀请 |
| `/spaces/:id/invitations/:id` | DELETE 撤销邀请 |
| `/invitations/accept` | POST `{token}`，事务化加入并消费，已有成员不改变角色 |

输入使用严格 Zod schema 和 16 KiB body 限制，错误返回 code/message/hint，不回显秘密。空间外请求统一 404；空间内越权 403；最后 owner 或重放冲突使用可操作错误。所有成员更新/邀请兑换以立即事务完成；邀请兑换还核对创建人的现有管理权，成员被降权/移除时撤销其未使用邀请，重新加入也不恢复旧邀请。

admin 只能邀请/移除 member，owner 可以邀请 member/admin、通过成员修改授予 owner；邀请不能授予 owner。邀请只向 owner/admin 展示，撤销同样校验该邀请角色是否可由当前角色管理。成员可主动退出，最后 owner 不能退出或降权。个人空间只是初始创建的普通空间，可邀请协作，不另建成员模型。

兑换邀请条件更新并记录 consumedBy：同一用户重放且仍是成员时返回现有关系，其他用户重放 410；已从其他途径加入者返回 409，不消费邀请。已移除的消费人不能凭旧邀请重新加入。所有嵌套 ID 查询同时限定 spaceId。

## Web 与凭据

浏览器以 sessionStorage 保留当前 token，刷新可复用、关闭后靠用户保存的副本重新接入。显式创建/轮换后展示复制和下载入口，普通状态仅显示身份 ID；退出清除本地会话，不撤销其他设备。token 不进入 URL、DOM 属性、日志或第三方请求。邀请可复制为文本，接受时粘贴至专门输入框，不用带秘密的 URL。

页面使用本地静态资源、CSP、无第三方脚本，所有用户文本通过 textContent 输出。API 的写操作要求 JSON，不接受 cookie/query 身份，也不返回跨域 CORS 头；不以代理后的 Host 猜测公网 Origin。只返回固定的未知错误文案，底层异常不回显请求。用户可管理空间、邀请、成员；产品中的机器/runtime/Agent 管理在后续 Web Change 接入。未匹配的 `/hub/*` 返回 404，不落入 HAPI SPA。

页面延续既有看板：背景 `#f3f6fa`、内容白 `#ffffff`、文字 `#213148`、次要文字 `#53657e`、操作蓝 `#245ac7`、分隔 `#d8e1ed`。标题使用现有 Avenir Next/PingFang，正文系统字体，身份 ID 使用等宽字体。进入前左右并列“创建身份/已有 token”，进入后左侧持续显示当前身份与空间列表，右侧显示空间成员和管理动作；窄屏改为上下排列。身份卡显示名称及可复制的 ID，秘密仅在备份操作中展开。此入口是管理界面，不采用宣传页大图或与产品无关的装饰。

## 迁移、回退与验证

新增表不自动认领旧 namespace、资源或任务。既有版本拒绝更高 schema 是当前约定，回退需停止专用服务并恢复升级前备份，不承诺旧程序可读取 v7。此阶段在专用环境验收，不自动更新用户已部署服务。

验证真实 HTTP + SQLite，覆盖重启、独立连接最后 owner、邀请重放、token 轮换和凭据隔离；Playwright 对编译产物覆盖完整用户路径。真实配套 HAPI 验证新 token 不能通过 `/api/auth`、原生 API、`/cli`、Socket.IO 和旧 Runweft API；root/HAPI JWT 反向不能访问新身份 API。扫描 DB/WAL/日志确认无明文秘密。基础检查 `bun run typecheck`、`bun run test`、`bun run build`。无外部登录/邮件依赖；无需人工提供访问凭据。
