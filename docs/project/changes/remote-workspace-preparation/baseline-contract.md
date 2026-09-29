# 固定 Git 基线契约

> 来源：[Technical](technical.md)；状态：设计，待实现验证。

## 身份与消费者

snapshot 复用键为 namespace、sourceRepositoryId、baseCommit；sourceRepositoryId 沿公共 resolve，由源 machineId/commonDir/对象格式确定，不按 remote URL 合并仓库。清单有独立 manifestId 与内容版本，引用稳定的 export/import 操作。

origin 的仓库身份与目标 cache 的本机身份分别保存。来源绝对路径仅用于源端定位和审计，不能作为目标 checkout/reference 路径。相对 cwd、baseRef、dirty 和 parent/Agent 归属属于消费者；相同 commit 的不同子目录可共用对象。

消费者是 diagnostic 或未来 task/result，生命周期由所属业务管理。C10 不接管诊断 worktree；它引用同一 snapshot 后创建自己的 environment，继续现有委派轮次/上下文。这里不定义新的 round 或 contextRevision。

## 清单

| 内容 | 固定字段与校验 |
| --- | --- |
| 根仓库 | path 为空、format、commit、bundleRef、bundle file key；只含声明 ref，完整可达 Git 对象，无前置对象依赖 |
| 子模块 | 相对根的逻辑 path、父仓库 path、父内 module path/name、gitlink commit、format、独立 bundle file key；从固定树与 `.gitmodules` 对应，父先子后 |
| LFS | 所属仓库、基线文件路径、oid/size、实体 file key；namespace 内同 oid/size 可复用 artifact |
| 文件 | 稳定安全 key/文件名、kind(bundle/lfs)、sha256、size；发布后加 artifactId，不替换摘要 |
| 目标导入 | manifestId、importOperationId、受控根/子模块缓存映射与保留 ref、对象校验结论 |

逻辑路径必须是仓库相对路径，拒绝绝对路径、`..`、symlink 逃逸。文件名由程序生成，不把用户路径当 artifact 名或缓存目录。恢复清单不携带 Git token、原生配置或任意 remote URL；普通业务附件仍归 TaskFiles。

## 源端导出

Runweft 先持久冻结 resolve 返回的真实 source，HAPI export 只接受准确 SHA 和期望源仓库身份；导出开始再核对路径/仓库身份与 commit 存在，不重新解析分支。

在 `exports/<op>/` 建立自有 scratch bare，objects/info/alternates 指向源 commonDir/objects；ref 只写 scratch。使用 `GIT_NO_REPLACE_OBJECTS=1`，源读取/导出命令以空 `GIT_ALLOW_PROTOCOL` 禁用 transport，避免 partial clone 懒取。scratch 不复制源 config、promisor 设置、hooks 或凭据；成功 bundle 不再依赖 alternates。源对象被并发 GC 移走时明确失败，不换基线。

根与子模块分别打包完整可达历史。基线 gitlink 从固定树读取，在源已有模块对象库找对应 commit；不以当前模块 HEAD 代替，不自动初始化/更新源模块。缺对象时给路径与 SHA。拒绝 shallow；partial clone 只有必要对象本来齐全、完整打包成功时可用。

LFS 从固定 commit 枚举指针，按 oid 从源对象库读取并固定候选，校验大小/SHA-256；不读可能已改动的工作树文件。缺工具/实体则失败。只归档基线工作树所需 LFS/子模块，Git 可达历史不意味着历史 LFS 全量归档。

export 成功表示固定候选已形成，不等于目标 ready。目标独立导入负责完整性放行；源端不再额外导入一次相同 full pack。发布成功后立即释放已交付导出文件/capture spool，保留操作与清单回执；未交付候选保留，不长期依赖源 Git ref。

## 导入与公共准备

先检查中心下载摘要/大小，再在自有空 bare 中验证 bundle header/ref/format、实际导入和所选 commit 的闭包。该库不设 alternates/promisor；不能用共享 cache 已有对象掩盖坏 bundle。校验后进入共享 cache，写入和工作区 Git 操作共用仓库锁。成功后立即释放 materialize 副本。

cache 的 HEAD 指向初次基线的内部 `refs/heads/cache-base`，后续不移动；各 manifest 使用不可变 ref。目标 WorkspaceSource 的 machineId/repositoryId/commonDir 都是目标真实值，sourcePath/repositoryRoot/commonDir 指向根 bare cache，baseRef 指向 snapshot ref、dirty=false、relativePath 取当前消费者。

可选 source.snapshot = `{importOperationId, manifestId}` 由 import 回执产生；WorkspaceManager 校验自有记录与 source 字段匹配，不能只凭目录前缀信任 cache。没有该字段的本机 source 继续原有路径。

公共 prepare 按 manifest 逐层用本地模块 cache 初始化精确 gitlink，命令级设置 URL/file protocol/checkout；相对 URL 和重名 module 不回退到源地址。LFS 复制到实际对象目录后执行 checkout，核对实体 oid/size；cache 来源绝不调用 lfs pull。启动时沿现有 HEAD/clean/inputs，再核对 gitlink/manifest 与 LFS downloaded/checkout，拒绝 pointer-only。准备后不额外增加一次全量 LFS hash 扫描。

## 留存与 C10 接口

RemoteBaselines 输出 snapshotId、origin、targetSource；C10 在 task 接受/首轮准备使用它，然后继续 TaskFiles/TaskWorkspaces。模型上下文和 inputs 的固定版本沿现有轮次事实，snapshot 不保存任务 prompt。

snapshot 的 recovery pin 引用全部 Git/LFS 文件，最后一个 consumer 释放后才解除。复用前检查 available；已回收对象需要新的传输代次，不能复活原 artifact ID 或改写旧回执。目标同 manifest 缓存有效时跳过下载；释放后的缓存需要重新 import。

C10 消费公共封存结果并登记 result consumer，负责新增代码/LFS/子模块成果的验证和回收。C9 不能把非初始成果当可丢弃诊断数据。缓存清理必须考虑公共保留 refs 与全部消费者；普通附件 TTL/释放不能解除 baseline recovery pin。
