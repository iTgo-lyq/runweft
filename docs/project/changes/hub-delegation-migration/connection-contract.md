# 显式 Hub 连接与凭据交接

## 数据与配置

新配置区分本机是否托管 Hub 与当前业务使用的 hub.url；两种部署均需显式业务 URL。选定空间和身份保存在 `<home>/connections/<origin-label-hash>/identity.json`，权限 0600，包含 origin、稳定 userId、spaceId 与 token。机器凭据仍在同目录 machine.json，原生 Runner home 在 hapi；身份、机器和 runtime 不合并登记。

配置文件只保存可读的服务/连接选项，不写 token、Agent 定义、项目覆盖。`paths` 列出完整持久位置；CLI 允许显式备份导入和环境变量用于自动化，但不从 HAPI settings/root 获取用户凭据。连接不同 origin 不复用 token。切换空间验证 membership；切换身份不能覆盖另一 owner 的机器记录。

## Web 到 Agent 的程序化交接

`hub connect begin` 由 Agent 创建本机请求，保存 RSA-OAEP SHA-256 私钥和随机 polling secret 到统一数据根，再向明确 Hub 提交公钥、随机 requestId、polling secret 摘要和本机展示名称。输出仅含核对码、过期时间和 `/hub` 的连接确认链接，不含身份 token、私钥或 polling secret。`complete` 可稍后调用并恢复同一请求，不需要持续占用 Agent 工具进程。

Hub 保存有期限的交接记录；浏览器打开确认链接后展示 origin、机器名称和核对码，用户在已有身份/所选空间下明确确认。浏览器用所记录的公钥加密当前 token，提交 ciphertext 和选定空间；服务端以当前身份鉴权、记录 owner/space，不能通过链接自动领取他人身份。浏览器只在 HTTPS 或 localhost 的安全上下文执行交接。

本机凭 polling secret 获取密文，解密后直接请求 Hub 校验 token 对应身份和空间，再原子保存 identity.json。成功后确认消费；在本机已落盘但确认响应丢失时允许重复完成，不覆盖已切换的其他身份。Hub 从不持久明文 token；只有本机文件保存解密结果。交接过期十分钟，确认后不能改换内容，主动取消/成功消费使其不可再次领取。身份 token 轮换或空间撤回使旧交接不能完成。

polling secret 与私钥只在本机；请求 ID/核对码是展示信息，不是领取凭据。所有 API 禁止通过 URL query 传秘密，响应 no-store，错误不得拼接提交的 token/密文。测试覆盖重复提交、假 origin、过期、被篡改密文、跨用户确认与并发本机保存。

确认页说明“只确认自己刚发起的请求”并核对 origin/机器/代码。交接的是该身份已有 token，不是独立设备凭据；撤销单台设备需要轮换身份 token，再给其他设备更新。远端明文 HTTP 不支持此交接，明确提示配置 HTTPS 或经 SSH 隧道连接 localhost，不静默降级传输。

## 服务与 CLI

默认 serve 组合已验证的 ConfigurationGateway 与任务路由；HAPI Hub 继续仅绑定私有端口。Hub 启动与机器接入分离，首次启动不自动给匿名访问者机器权限。完成机器登记后的 start/runner 启动使用 machine.json 中的独立机器 token，并保留 HAPI 原生 Codex/Claude 配置继承。

root Agent/resource 命令转向中心服务，旧 YAML 写入/绑定命令退出生产入口并返回中心配置的替代命令说明。MCP/任务/附件/远端诊断共用已保存 Hub 身份 transport，配置错误即时给出接入路径，不启动临时本地退路。服务状态与 doctor 分别显示托管 Hub、业务连接、身份空间、机器接入和原生工具情况，不再将 root token 名称作为用户接入提示。

未上线版本旧数据按[清理契约](migration-contract.md)处理，不建立 native home 映射或历史转换层；不删除外部 Git worktree。
