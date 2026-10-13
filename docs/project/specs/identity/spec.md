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

姓名 1–80 字符，写请求严格 JSON、上限 16 KiB；不支持跨域 CORS。错误返回明确 code/message/hint，未知异常不回显底层消息或输入。无效 token 返回 401，不静默创建身份。存储在 `<home>/server/runweft/state.sqlite` 的 `hub_users` 表。

`/hub` 页面和静态资源内嵌编译程序，设置 CSP/no-store；未知 `/hub/*` 返回 404。健康响应的 `capabilities.hubIdentity=1` 表示此入口可用。

## 执行入口与凭据

默认服务将独立 token 接入身份、空间、配置与委派；[执行授权网关](../execution/access/spec.md) 交换受限 JWT，Runner 使用独立机器凭据。HAPI root/JWT 不能作为公开身份登录，旧 identity 与 /runweft 入口不开放。秘密经 Web 交接 保存到本机，不作为模型工具输出。

## Web 与本机身份交接

hub connect begin 为所选 Hub 创建十分钟的确认请求，输出无秘密的 /hub#connect=<请求 UUID>、机器名称和核对码。浏览器必须具备当前身份，明确选择空间并确认；核对 origin、请求与机器，不自动批准。交接仅允许 HTTPS 或真正的 loopback 安全上下文。

客户端生成 RSA-2048 密钥，WebCrypto 用 RSA-OAEP SHA-256 加密身份 token。Hub 只持久公钥、密文、轮询秘密摘要、身份/空间及期限，不保存明文用户 token。读取、确认和消费重新核对 token 与成员资格；取消、过期、身份轮换或成员撤销使请求失效。

complete 解密后先验证身份和成员资格，再原子保存 0600 identity.json，并确认消费。该操作把 origin 保存为 config.yaml 的 hub.url，保留部署 mode；不将 token 写入 YAML 或模型输出。私钥和轮询秘密暂存同连接目录的 0600 connect.json，完成后移除。确认响应丢失可用已保存身份重试，不能覆盖后来变更的身份；并发写入采用短事务，不为网络请求持锁。

cancel 只取消待确认请求，保留已有身份。connect status 是本机摘要，auth status 才验证远端当前授权。hub paths/root paths 分别显示显式目标和当前连接位置。地址不自动跨 origin 复用 token；机器记录归属另一身份时拒绝覆盖。

CLI/MCP 默认使用保存的身份和空间，也可显式使用身份备份或 RUNWEFT_IDENTITY_TOKEN；指定另一个身份不会继承旧身份的已选空间。业务连接必须具有 hub.url、身份及空间，不回退 HAPI root 或本地 Agent 文件。身份备份由用户自行保管，丢失不由服务端找回。

未选择 Hub 时 begin 报 `hub_connection_required`，提示用 `hub --url … connect begin/complete`，不误报 HTTPS 错误。`/hub` 将身份/空间与资源后台统一呈现，并提供当前 origin 的 Agent 接入说明；刷新、401 或连接错误均不自动领取新身份。原生页面只获得独立标签页短凭据，不继承长期身份，见[执行授权](../execution/access/spec.md)。
