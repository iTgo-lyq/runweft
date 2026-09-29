# 远端固定基线

源必须是有 commit 的 Git 工作区，base 明确且无歧义；来源可以是 linked worktree 或已提交子目录。公共 resolve 固定源机器/仓库身份、准确 SHA、相对 cwd 和脏状态。源分支后续移动不改变本次基线，未提交及未跟踪内容不自动同步。完整 bundle 支持无 remote 或尚未 push 的提交。

HAPI `POST /api/machines/:id/repositories` 提供 export/import/inspect/release，分别要求 repositoryExport:1、repositoryImport:1。操作身份、参数与清单持久保存；相同操作返回原结果，未知状态对账，不盲目重发。Git 工作由原 Runner 管理和公共仓库锁串行协调。

export 在自有 scratch bare 中读取源 Git 对象，不修改源 refs、config、index 或工作文件，不初始化源子模块、不懒取缺失对象。清单包含根完整 Git 历史、固定树所引用的递归子模块 Git 对象及该基线需要的 LFS 实体，各文件有 sha256/size。sha1/sha256 可用；shallow、缺 Git/模块/LFS 对象、身份漂移或所需工具缺失明确失败。历史 Git 对象不代表历史 LFS 实体全部归档。

文件经已有 capture/deliver/materialize 通道和确定的最多 100 项批次传输，请求身份在动作前保存。成功发布并取得 recovery pin 后释放源候选；成功导入后释放目标下载副本，操作/清单回执保留。部分发布只释放已持久交付候选，失败清理单独显示，不重跑导出或模型。

目标先在无 alternates/promisor 的独立空 bare 中验证 bundle/ref/对象格式、闭包及清单，再进入来源共享缓存；已有 cache 不掩盖残缺或增量 bundle。模块和 LFS 只从导入资产初始化，不回退源 URL 或 lfs pull。source.snapshot 的 importOperationId/manifestId 关联自有导入回执，目标仓库身份和路径均为目标真实值，不能把源路径当目标路径。

中心 snapshot 按 namespace、sourceRepositoryId、baseCommit 复用，来源身份沿 machineId/commonDir/对象格式，不按 URL 合并仓库。相对 cwd、原 baseRef/dirty 和 parent 归属留在 consumer。同 SHA 复用完整快照；另一 commit 传完整 bundle，相同 namespace/oid/size 的 LFS 只增引用。恢复对象删除后新准备建立新代次，不复活 artifact ID 或改写旧请求。

各目标 import 有独立代次与状态；目标确定导入失败后新请求可复用中心快照创建新 import，原失败回执不改。中心服务不需要 Runner 或 Git，已发布恢复对象在源/目标离线时仍可下载。服务向消费者返回 snapshotId、origin、targetSource；输入附件和模型上下文不存入 snapshot。
