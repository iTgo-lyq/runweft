# Web 与本机身份交接

hub connect begin 为所选 Hub 创建十分钟的确认请求，输出无秘密的 /hub#connect=<请求 UUID>、机器名称和核对码。浏览器必须具备当前身份，明确选择空间并确认；核对 origin、请求与机器，不自动批准。交接仅允许 HTTPS 或真正的 loopback 安全上下文。

客户端生成 RSA-2048 密钥，WebCrypto 用 RSA-OAEP SHA-256 加密身份 token。Hub 只持久公钥、密文、轮询秘密摘要、身份/空间及期限，不保存明文用户 token。读取、确认和消费重新核对 token 与成员资格；取消、过期、身份轮换或成员撤销使请求失效。

complete 解密后先验证身份和成员资格，再原子保存 0600 identity.json，并确认消费。该操作把 origin 保存为 config.yaml 的 hub.url，保留部署 mode；不将 token 写入 YAML 或模型输出。私钥和轮询秘密暂存同连接目录的 0600 connect.json，完成后移除。确认响应丢失可用已保存身份重试，不能覆盖后来变更的身份；并发写入采用短事务，不为网络请求持锁。

cancel 只取消待确认请求，保留已有身份。connect status 是本机摘要，auth status 才验证远端当前授权。hub paths/root paths 分别显示显式目标和当前连接位置。地址不自动跨 origin 复用 token；机器记录归属另一身份时拒绝覆盖。

CLI/MCP 默认使用保存的身份和空间，也可显式使用身份备份或 RUNWEFT_IDENTITY_TOKEN；指定另一个身份不会继承旧身份的已选空间。业务连接必须具有 hub.url、身份及空间，不回退 HAPI root 或本地 Agent 文件。身份备份由用户自行保管，丢失不由服务端找回。
