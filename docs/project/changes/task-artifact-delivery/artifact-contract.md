# 文件对象、机器传输与任务关联契约

> 属于 [Technical](technical.md) 的正式设计；分阶段实现状态见 [Execution](execution.md)。

## 1. 中心对象

对象元数据：`id`、`namespace`、`requestId`、`filename`、`mimeType`、`size`、`sha256`、`state`、创建/发布/删除时间。ID 使用 UUID，SHA-256 使用 64 位小写 hex，size 非负整数；任意 MIME 可作为描述，服务统一以 attachment 下载，不执行或内联展示内容。

`reserved → available → deleting → deleted` 为对外状态。上传期间仍是 reserved，含最近失败和传输状态可供查询；deleted 为墓碑。内容只在 available 状态读取，返回确定长度/hash。PUT 前验证声明长度不超过 limits，实际流量超额或不符即失败；未校验字节从不成为 available。

同 namespace 的 requestId 唯一且固定声明，重试返回原对象；改变名称/摘要/长度等语义返回 conflict。已 available 的重传只返回已保存信息，不改字节；deleted 不复活。并发 PUT 同对象只接收一个写入，其余返回正在处理；进程退出后显式同对象重试可继续，从零重传。

SQLite 保存对象和 references，字节保存到 `HAPI_HOME/artifacts/<namespaceHash>/<objectId>`；临时文件在同一受控根，不使用文件名拼接键。流式计算摘要并检查实际长度，文件 fsync/rename 后标记 available；遇到文件发布成功但 DB 未更新，读取/重试核对声明再修复状态，不能靠目录存在就宣称成功。没有内容 hash 跨 namespace 去重。

预约阶段计算 namespace 已有未删除对象的保留/预约字节总额，单事务检查配额并创建记录；相同请求不重复占额。删除不减少元数据可查询性，只有字节确实删除后才释放其占额。单对象、待上传预约和 pin/delete 都经同一存储入口，支持失败后查询；删除中不给新 pin，也不让下载继续宣称 available。

## 2. HTTP

同一 handler 分别挂在 HAPI `/api/artifacts`（既有 JWT）与 `/cli/artifacts`（既有 Runner token）下，共享 namespace 检查：

| 操作 | 接口 | 语义 |
| --- | --- | --- |
| limits/list | GET 根及 `/limits` | 分页元数据、服务端真实限制和用量；不返回内部存储路径 |
| reserve | POST 根 | requestId、filename、mimeType、size、sha256，可携带稳定 reference；对象与该 pin 同事务产生 |
| inspect | GET `/:id`；GET `/requests/:requestId` | 查询确定状态，未知不能推断成功 |
| bytes | PUT/GET `/:id/content` | application/octet-stream 流；下载加 attachment 与 nosniff，不接受外部 URL |
| refs | GET/PUT/DELETE `/:id/references/:reference?` | namespace 内稳定字符串引用，可写 purpose/说明；无任务生命周期含义 |
| remove | DELETE `/:id` | pinned 拒绝，重复删除返回同一墓碑 |
| prune | POST `/prune` | 默认预览，apply 才执行；每项再次检查 pin/年龄/状态，返回删除及失败列表；limit 1–200、after/nextCursor 按 ID 稳定翻页 |

控制请求有小型 JSON body 限制，二进制路由有大小和空闲超时限制，无固定总时长；Bun server body ceiling 随 maxFile 提升，不能让原 68 MiB 限制挡住文件。客户端下载以相邻临时文件写入/hash校验后原子落点，网络失败不留下冒称成功的目标。已有目标默认拒绝，覆盖需显式指定。

限速流验证上传/下载仍持续进展时不会因固定总时限截断，空闲超时默认 60 秒。413 与非 JSON 代理响应返回明确操作提示。

服务与 Runner 分别声明 `artifacts: 1`、`artifactTransfers: 1` 能力；输出另声明 `artifactOutputs: 1`，旧输入 Runner 不被误判为支持输出。需要附件时先核对；既有无附件会话不要求新增能力。shared 协议导出 schema/types，Runweft 直接消费，不自行再造另一套 wire 格式。

清理以服务端时间和策略为准：available 按 publishedAt 计龄，reserved 按 createdAt 计龄，释放引用不重置这两个时间；deleting 可恢复清理。先核对落盘后未发布的对象，再判断期限。limits 的 usage 将预约/发布/删除中用量分开，引用用量按对象去重；这些是配额占用，非磁盘物理用量。

## 3. 机器操作

通过现有 `/api/machines/:id/artifacts` → RpcGateway → ApiMachineClient → Runner 注册的有限文件操作：

- `materialize`：operationId、files[{artifactId,name,sha256,size}]。下载到 `HAPI_HOME/artifact-transfers/<operationId>/inputs/`，每项核验后返回 preparedFiles 引用与真实路径。重复逻辑名拒绝，输入不写工作区。
- `capture`：operationId、cwd、files[{name,relativePath}]。解析相对 cwd 路径，拒绝目录/逃逸/非 regular file，逐项流式捕获到独立 spool；返回大小/hash/capturedAt 或明确错误。绝不根据 prompt 扫描其他文件。
- `deliver`：operationId、captureOperationId、指定候选、每项固定 upload requestId/reference。只上传已捕获字节，不重新读取 cwd；完成后返回 Hub 对象 ID 与发布事实。
- `inspect`：查询原 operation；无需活跃 agent/session。
- `release`：显式释放已无业务引用且无进行中操作的本机 inputs/spool，结果不等于删除中心对象；capture 可指定 names 只释放已被中心清单确认的成功候选，未交付项保持。

受理先持久记录请求指纹，后台执行，RPC 快速返回；同 ID 不同参数拒绝。receipt 状态 accepted/running/succeeded/failed/unknown，保存逐项结果。文件 copy/upload 没有模型/Git 副作用，可在核对同一已捕获内容后重试；未明确终态先 inspect。重启将未完成 capture 确认为部分失败，保留每项已持久捕获的结果；未捕获项显式补收，不重新抓源路径充当同一次成功捕获。

materialize/capture/deliver/release 不是一般脚本执行或可配置 workflow；复用 Runner 生命周期、PathPolicy、固定 Hub URL/token 和已有连接。API 不接受 shell 命令、任意环境或外部下载地址。

preparedFiles 为 `{operationId}`，绑定当前 Runner 的 materialize 结果和摘要，仅共享目录的 spawn/resume 保存并核验它；新一轮传当前引用，缺失/失败/已释放引用明确拒绝。resume 省略 preparedFiles 时继承原绑定，显式 null 清除绑定，用于下一轮没有新输入的情况。worktree 公共 prepare 接收落地 path/hash/size，使用既有 preparedWorkspace 门禁和复制后的路径，成功后释放 materialize 副本。两种模式在原 Runner 启动点各用一个门禁。准备文件目录可沿既有 Claude --add-dir 参数传递，T2 先真实验证读取，不新增权限模式或 runtime 循环。

## 4. Runweft 业务记录

附件引用为 `{artifactId,name}`，接受时解析并冻结 size/hash/name；输出约定为 `{name,relativePath}`，每轮独立。二者进入原 requestId 指纹。CLI input 缺省 name 来自对象显示名，不能安全作为单一文件名时要求用户指定；统一限制 UTF-8 字节长度、禁止分隔符、NUL、`.`/`..`，不因中文名称或空格被默认英文正则拒绝。HAPI shared 定义唯一逻辑文件名 schema，materialize 与 WorkspaceRequest.prepare 共用。

Round 增加输入准备记录和文件交付记录，纯文字任务缺省为空。输出清单保存在 Runweft SQLite，key 为 taskId/roundId/version；每项保存 name、relativePath、captureTime、status、artifactId/hash/size 或 error。`delivered` 表示约定项目全部 available，`incomplete` 表示至少一项失败，`none` 表示本轮无输出约定。已发布版本不 UPDATE，补交新增版本并保留历史。

Runweft 在发布清单前核对每个 available 项的 HAPI 元数据与 pin；任意字符串 artifactId 不能直接登记为已交付。输入和结果 pin 采用稳定请求/轮次身份，恢复基线使用独立 purpose，普通轮次 release 不释放 recovery 用途。

部分失败不篡改 native 执行成功/失败及既有终态 status，也不抹去 Git 结果。read_agent/task show 分开呈现 native/git/artifacts，incomplete 附 attention.scope=artifacts。清单与留存变更保存 artifactsRevision，wait 以 max(completedRevision, artifactsRevision) 为本轮通知版本，旧 completedRevision 不改；多个轮次按通知版本升序消费，避免旧轮次的较晚补交跨过尚未读取的完成通知。已结束轮次上待处理的 retry/collect/release 也纳入 pending 扫描。

## 5. 引用释放与一致性

接受意图先在 Runweft SQLite 保存 namespace/requestId/指纹及目标对象，再 pin → TaskStore 接受事务；相同请求使用同一 owner，成功事务同步关联意图。启动前对账已记载意图，已接受则保留，确定未接受且旧协调进程已停止则自动 unpin。运行中已知失败当场释放。恢复不完整数据库时未知引用保守保留并诊断；不扫描删除所有缺少任务 ID 的 pin，不凭年龄推断孤立。

留存是轮次级的独立可变状态 retained/releasing/released/discarded，清单版本只存内容事实；展示时组合当前留存与清单，下载以对象实时状态为准。release 默认预览、--apply 才执行；省略 round 则预览全部已结束轮次。已结束轮次的 release 先记录业务释放意图，逐项 unpin/release 后标记完成；中断可沿原意图重试。未完成输出传输、仍有 queued/running 轮次、未确定 capture 结果均拒绝普通 release。缺失输出没有可传候选时可以释放留存，原 incomplete 错误仍保存。

为避免永久配额占用，提供显式放弃已确认失败传输的选项：`task artifacts release --discard-pending --apply`，只适用于原生与相关机器操作均确认停止。先记录 discarded，再释放候选及其 pin；未知操作必须先查询，不强删。原清单的未交付事实不改，留存状态另标 discarded，不变为 delivered。

已 available 对象的普通 remove/prune 由 HAPI 引用事务保护。Runner spool 在中心发布及清单引用确认前保持，重试候选不会因删除 worktree 丢失；回收候选只清本模块管理根。已释放后的历史清单配合当前留存状态表明字节不再保证可取回，下载对真实对象状态仍返回明确错误。
