# Hub 身份 token

Hub 的 `/hub` 页面支持主动创建独立身份或导入已有 token，无需注册、邮箱和外部登录。身份以稳定 UUID 表示，显示名称可修改，权限不依赖名称。创建身份同时建立一个初始空间；领取新 token 不取得其他身份的资源或已有空间成员资格。

## 凭据生命周期

- token 格式为 `rw_id_` 加 32 字节随机值的 base64url 编码；服务器只保存 SHA-256 摘要。创建响应返回明文，普通身份查询不返回 token/摘要。
- 同一 token 在该 Hub 使用同一身份。浏览器保存在本站 sessionStorage；刷新保留身份，退出清除当前浏览器凭据，不删除 Hub 数据或撤销其他客户端。
- 用户通过复制或下载保存副本。没有副本时没有邮箱找回路径；重新创建得到不同身份，不能自动认领旧数据。
- 更换 token 时客户端先生成、保存并提供备份，再用旧 token 提交替换。事务内重新校验旧凭据，一次替换成功后旧 token 立即失效，身份 ID 和成员关系保留。
- 轮换响应丢失后用预存的新 token 查询核实；不能盲目重试或创建替代身份。创建响应丢失明确报告结果未知，不自动重复创建。
- token 不通过 URL/cookie 登录，不进入普通日志、DOM 属性或其他站点请求。显式备份可显示正文；无 Clipboard API 时可选中文本或下载。

## 接口与存储

前缀 `/api/runweft/hub`。仅 `POST /identities {name}` 允许无凭据，返回 201 和 identity/token/personalSpace；其他接口要求 `Authorization: Bearer <identity-token>`。

| 路径 | 方法与行为 |
| --- | --- |
| `/identity` | GET 本人；PATCH `{name}` 修改显示名称 |
| `/identity/rotate` | POST `{token}`，应用已保存的新 token，返回同一 identity |

姓名 1–80 字符，写请求严格 JSON、上限 16 KiB；不支持跨域 CORS。错误返回明确 code/message/hint，未知异常不回显底层消息或输入。无效 token 返回 401，不静默创建身份。存储在 `<home>/server/runweft/state.sqlite` 的 `hub_users` 表，schema v7。

`/hub` 页面和静态资源内嵌编译程序，设置 CSP/no-store；未知 `/hub/*` 返回 404。健康响应的 `capabilities.hubIdentity=1` 表示此入口可用。

## 与当前原生协作入口的区别

这套 token 仅接入身份与 [空间](../../spaces/membership/spec.md) API。旧 `/api/runweft/identity` 仍返回 HAPI 数字 uid/namespace，旧 `/runweft`、原生 HAPI、Runner 与委派沿原有认证。新 token 无法访问这些旧接口；HAPI root/JWT 也不能访问新身份接口。独立 token 不是共享 HAPI root 凭据的替代表示。
