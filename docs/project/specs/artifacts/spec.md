# 持久文件

HAPI 是文件字节与对象元数据的唯一权威，Runweft 维护委派关联、版本清单和 CLI/MCP。文件操作不依赖活跃 agent；local 使用托管 HAPI，Hub 模式使用所连中心，执行机离线后仍可下载已发布对象。认证沿 HAPI namespace，文件 ID 或摘要不替代认证。

对象包含 UUID、上传 requestId、名称、大小、SHA-256、状态和时间。状态为 reserved、available、deleting、deleted；完成长度/摘要校验和持久发布才可下载，上传中不开放字节。相同 requestId 固定内容声明，重复上传查回原对象，参数冲突拒绝；已发布字节不可覆盖，删除保留墓碑且不能复活旧请求。

## CLI 与 MCP

`artifact upload/show/lookup/list/download/limits/refs/remove/prune` 操作中心对象。上传先输出 request ID，响应不明按原 ID 查询并保留原文件重试。只上传明确的普通文件，不隐式打包或扫描目录；逻辑文件名允许中文/空格，限制 240 个 UTF-8 字节，拒绝路径分隔符、控制字符及点目录。

下载以相邻临时文件流式写入并核验长度/摘要，成功后原子保存。目标已存在默认拒绝，显式 --overwrite 才替换；失败与取消不留下冒称成功的目标。传输使用 60 秒无进展超时及取消信号，不限制持续传输的总时长。

| MCP 工具 | 参数与结果 |
| --- | --- |
| upload_artifact | path、可选 name/request_id；返回 request_id 与 artifact 元数据 |
| read_artifact | id/request_id 必选其一；查询元数据，不返回字节 |
| download_artifact | id、目标文件 path、可选 overwrite；返回实际保存路径和元数据 |

MCP 上传源和下载目标限定原生宿主 cwd，包括 realpath 与新目标已有祖先的解析；目录外操作由操作者显式使用 CLI。工具不把二进制放进模型上下文。省略 request_id 时使用稳定的 native call 身份；新调用不是旧请求重试。宿主自己的 MCP 超时仍有效，需跨越该时限的传输可用 CLI。工具发现不访问中心、不创建数据。

任务输入见[启动前输入](inputs/spec.md)，成果和恢复见[输出交付](delivery/spec.md)，限制与删除见[留存](retention/spec.md)。全部 Runweft 工具继续按[受控执行规则](../host-mcp/spec.md#受控执行的工具禁用)禁用。
