# 持久文件

HAPI 是文件字节与对象元数据的唯一权威，Runweft 维护委派关联、版本清单和 CLI/MCP。文件操作不依赖活跃 agent；两种部署模式均使用显式连接的 Hub，执行机离线后仍可下载已发布对象。授权按 Hub owner/space 映射到独立 HAPI 文件 namespace，文件 ID 或摘要不替代认证。

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

全部 Runweft 工具继续按[受控执行规则](../host-mcp/spec.md#受控执行的工具禁用)禁用。

## 启动前文件输入

spawn 和 next 接受最多 100 个 inputs[{artifactId,name?}]，名称缺省取对象文件名。CLI 使用可重复 --input <id> 或 --input name=<id>；MCP 使用相同结构。中心确认对象 available 后冻结名称、大小和摘要，并将本轮约定纳入请求指纹；重复逻辑名拒绝。每轮独立声明，未提供时没有新输入，steer 不接受附件。

接受意图先写 Runweft SQLite，再建立稳定 input pin 并接受任务。明确拒绝时回收新 pin，结果不明时保留意图；中心启动前只对账自己已记载的意图，已接受保留、确认未接受释放。未知来源或恢复引用不会凭年龄移除。

preparing 经 HAPI Runner materialize 下载到当前连接数据根，逐项验证 hash/长度。操作先保存身份和回执，再后台执行；未知结果查询原操作，不换身份重放模型。准备失败不启动原生进程，prompt 不承担补做下载或目录初始化的职责。

shared 使用当前 preparedFiles 门禁；worktree 把已验证文件交给 Git prepare，校验复制后树外路径并使用 preparedWorkspace。Runtime 从准备完成的 cwd 启动，继续加载原生工程配置和默认权限；Claude 当前输入目录沿已有 --add-dir 通道提供，不扩大到整个 home。

轮次上下文包含实际输入路径。next 优先复用原生 session，传本轮准备引用；无新输入时显式清除上一轮 shared preparedFiles。输入错误不等同于原生历史缺失，不触发重建或重发任务。

worktree 成功复制后回收 materialize 中间副本，最终树外输入随环境留存。shared 在执行确认停止或明确未启动后回收下载副本；回收失败可见并由协调器继续原操作，中心 input pin 保持。read/show 的 input_files 展示准备、实际路径、download_retention 和清理错误。

## 输出文件交付

spawn/next 可声明 outputs[{name,relativePath}]，最多 100 项且逻辑名唯一；CLI 使用可重复 --output path 或 --output name=path。路径是工作区内明确的普通文件，拒绝绝对路径、点目录、目录和逃逸 symlink，不递归扫描。每轮独立声明；worktree 中未忽略的输出也会随原有 Git 收尾进入成果。

原生执行确认停止、worktree Git 封存后才 capture。Runner 从同一打开文件流式复制到受控 spool，记录大小、SHA-256 和捕获时间，并检查采集期间变化；不承诺共享目录对其他写入者的文件系统快照隔离。逐项捕获错误不隐藏其他成功候选。

deliver 只上传固定候选，使用预先保存的 upload request ID 和 output pin。中心核对可用对象及引用后，事务发布不可变清单版本，再释放成功 spool；未交付候选保留。源文件后改、工作区删除、Runner 重启不改变旧候选或已发布对象。

### 状态与恢复

read_agent/task show 分别返回原生、Git 和 artifacts 事实。文件状态为 none/pending/delivered/incomplete；部分失败保留原轮次的执行结论和已交付文件，附 artifacts attention。传输进行或结果未知时保持收尾并阻止下一轮，确认部分失败后可结束本轮并接受下一轮。

`task artifacts retry` / retry_artifacts 只重传该轮失败候选，不重读工作区、不重启模型。缺失文件没有候选时明确返回 artifact_no_retry_candidate，不能把它当作已重传。

`task artifacts collect` / collect_artifacts 在本任务所有轮次和文件操作静止后显式补收 files[{name,relativePath}]，记录新的捕获时间并发布新版本；已删除或未准备成功的 worktree 不能从主目录代收。补交不修改旧清单和对象。

两类操作使用稳定 requestId；原生调用重传幂等。响应不明时从 list_agents 的 accepted_requests 查询原 request_id/artifact_operation_id，再 read_agent 查看 pending；保留原参数重试。CLI `task artifacts show --round` 可查全部或指定 --version 清单。

发布与留存变化通过 artifacts_revision 通知，completed_revision 不变；已结束轮次的待处理文件操作仍进入协调器恢复扫描。成果 hash/下载以中心对象为准，执行机离线不影响已发布文件读取。留存状态与清单内容分开。

## 文件留存、限制与清理

中心字节保存在 HAPI_HOME/artifacts，业务关联/清单保存在 Runweft state.sqlite；Runner 输入、持久操作回执和未交付 spool 保存在当前连接 HAPI_HOME/artifact-transfers。输入与候选不散落于系统临时目录，备份须覆盖中心数据库、字节、业务库及尚未交付的机器数据。

server.artifacts 默认 maxFileMiB=512、namespaceQuotaGiB=10、unreferencedDays=7、pendingHours=24。限制作用于所托管 HAPI；Hub 客户端读取服务实际限制，不能用本地配置覆盖它。预约与未删除对象共同占额，只有字节确实删除才释放配额；artifact limits 按预约、发布、删除中及去重引用对象展示用量，该数字不是文件系统物理占用。

对象有任意 pin 时，普通删除和过期清理拒绝；purpose 为 input/output/recovery 或未知来源均受保护。`artifact refs` 查看留存原因。单对象 remove 不要求达到过期年龄，但仍检查引用及活跃上传；删除中断可沿原对象继续，墓碑可通过 ID/requestId 查询。

`artifact prune` 默认预览，--apply 才删除未引用、过期对象。available 按 publishedAt、reserved 按 createdAt 计龄，释放 pin 不重置年龄；清理前核对已落盘未发布内容并重新检查年龄、引用、状态和活跃上传。稳定 ID 游标翻页，每批 limit 1–200，逐项返回删除或错误。

### 轮次释放

`task artifacts release <id>` 默认预览，--round 可选指定轮次，--apply 才执行。要求本任务所有轮次和文件操作已静止；只释放本轮拥有的 input/output 引用及已确认的机器副本，外部或 recovery pin 保留。未确认的操作先查询，不能按超时推断可删。

已捕获但未交付的候选须显式 --discard-pending --apply 才放弃。中心先持久化释放意图，再回收机器副本并 unpin；丢响应或重启继续同一意图，不重新执行模型。状态为 retained/releasing/released/discarded，首次或变化的错误及完成通知通过 artifacts_revision 可见。

释放不删除报告、Git ref 或 worktree，不改历史清单的失败事实；下载以对象实时状态为准，已释放不保证字节继续存在。释放期间拒绝本任务新轮次和文件操作；释放后的旧轮次不能 retry/collect，新成果通过 next 建立新约定。工作区输入复制与 checkout 共同留存，附件释放不删除其环境。
