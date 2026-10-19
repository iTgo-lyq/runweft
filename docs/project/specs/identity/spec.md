# Hub 账号与身份

Hub 以用户名和密码注册、登录，账户与稳定身份 UUID 一对一关联。显示名称可修改，用户名固定；权限和资源归属继续依赖身份及空间成员关系。注册在一个事务内建立账号、身份、初始空间与当前入口的独立凭据，不自动认领其他身份或历史数据。普通用户无需复制、下载或保管 token。

## 账号与凭据生命周期

用户名去除首尾空格并统一大小写，允许 3–32 位 ASCII 字母、数字、点、下划线和短横线，首位为字母或数字。密码为 15–128 个 Unicode 码点，允许空格与粘贴，不 trim、不截断、不强制字符组合。密码使用异步 Argon2id（19 MiB、2 次迭代）保存哈希，登录失败统一提示；哈希前限制请求速率和并发，哈希在数据库事务外运行，提交前重查账户状态。

每次浏览器登录和每个 CLI 环境各有一条可独立撤销的 UserCredential，服务端只保存随机秘密的 SHA-256 摘要。浏览器凭据为 rw_web_ 前缀，最长 12 小时、闲置 2 小时失效，写入当前标签的 sessionStorage，刷新保留；退出撤销当前凭据，关闭标签后用密码重新登录。CLI 凭据为 rw_cli_ 前缀，有效期 90 天，保存在本机 0600 连接文件中。秘密不进入 URL、模型输出或普通日志，不提供身份 token 备份或环境变量登录。

本人可查看并撤销各登录环境；修改密码和全端退出需当前密码，并撤销全部用户凭据。这些操作保留身份、空间、资源和已接受任务；机器及任务凭据保持独立。原生短 JWT 引用具体用户凭据及空间，每次请求重查其有效性，不能用于账户管理或授权另一 CLI。

## 接口与恢复

前缀 /api/runweft/hub；公开注册、登录和密码恢复仅允许 HTTPS 或真正的 loopback HTTP，严格 JSON、不开放跨域。账户接口使用原始 browser 或 CLI 凭据，拒绝派生短 JWT。

| 路径 | 方法与行为 |
| --- | --- |
| /accounts | POST 用户名与密码注册，返回身份、初始空间和 browser 凭据 |
| /sessions | POST 用户名与密码登录，返回新的独立 browser 凭据 |
| /identity | GET 本人；PATCH 修改显示名称 |
| /account | GET 本人账号与身份 |
| /sessions/logout | POST 撤销当前用户凭据 |
| /credentials、/credentials/:id | GET 本人登录环境；DELETE 单项撤销，均不返回秘密或摘要 |
| /credentials/revoke-all | POST 验证当前密码并撤销全部用户凭据 |
| /account/password | POST 当前密码与新密码，成功后全部用户环境重新登录 |
| /account/password-reset | POST 用户名、一次性重置码和新密码 |

忘记密码由部署者在服务器执行 account reset-password <username> --output <新文件>，向明确的 0600 文件写入有效期 15 分钟的一次性重置码；不创建缺失数据库、不把秘密输出到终端。用户通过 Web 或 account recover 的人工隐藏输入消费；成功后撤销全部用户凭据并重新登录。没有邮件、邮箱验证或用户长期保管的恢复 token。

人工 CLI 支持 auth register/login --interactive、auth logout，以及 account show/rename/password/recover、account credentials list/revoke、account logout-all。密码及恢复码仅从人工终端隐藏读取，不接收秘密 argv/env；无 TTY 明确报错并给出 Web 路径。auth login 默认走浏览器授权，Agent 不代开伪终端收集密码。

## 确认即激活的本机连接

hub connect begin 先在 0600 connect.json 保存客户端生成的 CLI 随机秘密、原 requestId、Hub 和旧连接指纹，再向 Hub 登记摘要。输出无秘密的 /hub#connect=<请求 UUID>、设备名和核对码，请求有效期十分钟。浏览器注册或登录后选择空间并明确确认；已有本标签登录时只确认，不自动批准。

确认事务核对有效 browser 凭据、请求、期限与成员关系，直接激活唯一 CLI 凭据并绑定身份/默认空间。CLI 自始持有最终秘密，不需要 RSA、密文、消费状态或第二次 ACK。相同身份和空间重复确认只返回原状态，不创建第二条凭据、不恢复已撤销凭据或改绑。

complete 使用同一待连接秘密查询，confirmed 后验证身份、空间资格与已有机器归属，原子保存 schema 2 identity.json 和 Hub 配置，保留部署 mode，完成后删除本地待连接记录。保存失败继续使用原记录恢复；并发连接变更或机器归属冲突拒绝覆盖，网络请求不持本地写锁。人工密码分支复用同一激活事务，不另建 browser 会话；单空间自动选择，多空间且无有效默认时人工选择一次。

cancel 撤销本次待连接或已激活但未保存的 CLI 授权，不撤销原有连接；已激活凭据在确认期限后不会仅因未 complete 失效，仍遵循自身期限、成员关系和撤销状态。auth status 校验远端身份/空间，connect status 显示本地摘要。连接按 origin 分区，不跨 Hub 复用凭据；未选 Hub 提示明确地址，不自动创建身份。

/hub 页面及静态资源内嵌程序，CSP/no-store，未知 /hub/* 返回 404；健康能力 hubAccounts=1 标记当前账户协议。页面统一账号、空间与资源管理，401 或刷新失败不创建替代身份。原生页面只获得当前空间的独立标签短 JWT，见[执行授权](../execution/access/spec.md)。
