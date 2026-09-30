# 旧定义、连接与历史的显式迁移

## 范围和预览

提供两个显式入口：旧 YAML/本机绑定导入当前 Hub，以及部署管理员停服迁移本机托管的历史库。前者通过当前身份 API 创建私有 Agent、个人选择和明确仓库关联；后者处理旧 namespace、机器/runtime、Task/Round、原生 sessions/文件和相关基线回执。两者都先生成预览计划、内容摘要和稳定请求 ID，apply 使用该计划，重复执行复用原映射。绝不自动删除源 YAML、备份、原生目录或用户模型配置。

历史映射至少指定每个待迁移 namespace 的 ownerId/spaceId，以及机器的实际 owner；所有目标身份/空间必须已经存在且成员关系有效。空间/Agent 同名不作为认领证据。未指定的数据保持不可见隔离；不能在新网关下继续扫描或执行旧未归属任务。任务尚未终止、原生进程可能仍在跑、文件操作未完成时预览列出具体阻塞，停妥后重新生成计划，不自动重发或伪造完成。

YAML 导入固定文件内容摘要；全局/项目作用域分别映射空间全局/明确 Repository。路径不是 Repository 身份，没有可靠关联时要求映射中指定已登记 Repository。旧 runtime UUID 只有在显式映射到本人可用中心 runtime 后才导入；无法匹配时作为待处理项，不能默默选同名 runtime。源文件变化使 apply 拒绝，部分 API 成功后凭固定 requestId 查询和继续。

## 停服历史迁移

迁移命令核实本数据根的 Runweft/HAPI/Runner 已停止，并取得数据根排他锁。只处理当前支持的 Runweft 与所绑定 HAPI schema，未知版本明确拒绝。数据库备份/构造副本使用 SQLite backup 或 VACUUM INTO；不把 WAL 主文件的简单复制当作完整快照。先备份 state.sqlite、HAPI 数据库、client.sqlite、配置/连接记录及文件清单，再在持久 staging 目录构造新数据库副本；所有状态位于 `<home>/backups/migrations/<id>`。

- 原生 machine/session ID、消息、metadata 和原生会话 ID 保持；将明确映射的机器/session/spawn 回执归入 runweft 原生 namespace，并建立 Hub 对象归属、native ID claim、机器/runtime 登记。目标机器是全局资源，不因多个空间复制机器。冲突在切换前报出，不覆盖已有对象。
- Task/Round 增补可信归属与历史配置快照，业务表的 namespace 改为 owner/space scope；原始 YAML 来源保留为历史说明，不再用它解析新轮次。保留任务/轮次/环境/操作 ID 与 Git 基线。新的委派必须选择迁入的中心 Agent；未建立可靠 Agent 对应的历史只能读取与清理，不能自动续接。
- 附件建立用户/机器预约和 object binding，切换到 owner/space 的 fileNamespace。HAPI 文件路径实际含 namespace 的 SHA-256，因此在 staging 阶段复制并校验现存字节，保留旧路径副本；仅改数据库 namespace 不算完成迁移。保留 artifact ID、摘要、大小和引用；预约映射避免 requestId 与全局预约主键冲突。
- baseline、consumer、成果引用和 fetch 回执按显式业务 scope 转换；任意 prompt/源码/模型输出内的字符串不批量替换。原生表内的推送订阅/旧账户认证不导入为新权限，旧 token 不映射成用户身份。
- Git worktree、repository cache、原生操作回执目录原地保留。连接记录可显式指向此数据根下已有 native home，`paths` 展示实际目录；本机旧 machineId 必须与迁移后的接入映射一致，不能偷偷登记一个新 ID 代替原任务目标。

历史机器在另一数据根/物理主机时，迁移先保留原 machineId 的 owner 与离线登记；由该 owner 经一次性接入申请为原 ID 签发/轮换 machine.json，再在对端保持原 HAPI home/machineId 启动。此恢复入口只适用于本人拥有的已迁移机器，不能允许任意用户指定或认领 ID；Hub 不保存对端机器明文 token。

## 中断、重放与回退

跨数据库和文件切换不用虚假的单事务保证。持久 journal 记录源摘要、staged 摘要、每个目标替换和整体完成状态；未完成 journal 存在时 serve/runner 拒绝启动并给出 resume/rollback 命令。替换前 checkpoint(TRUNCATE)、关闭所有本命令连接并核对没有待重放的 -wal/-shm；两库分别记账，不能把旧 WAL 应用到新主文件。每次替换前后核对摘要，原子 rename 后崩溃可判断已应用步骤。文件复制先完成，最后切换数据库/连接配置并标记完成。相同计划重放只验证已完成结果；数据已经继续变化后拒绝覆盖式重放。

rollback 只在服务停止且目标仍符合迁移结果摘要时恢复原备份；新业务已写入时拒绝无损回滚声明，保留备份供显式维护。迁移不自动启动服务、不更新在线部署。验收逐个切换点注入中断，验证可继续或回退，数据库完整性、文件摘要和旧 worktree 均可使用。
