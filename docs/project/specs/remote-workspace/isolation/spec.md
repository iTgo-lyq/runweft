# 独立环境与基线留存

同一来源在目标共用 Git/子模块/LFS cache，各 environment 使用独立 branch、checkout 和树外输入。公共 prepare 在已导入来源上工作，后续轮次从上一封存成果继续，不重置改动；原生 session 与工作区生命周期分别保留。诊断环境不被业务任务接管。工作树用于分离写入，不额外改变执行权限。

诊断记录、worktree、中心 recovery pin 和目标缓存默认保留。release 先沿 HAPI 停止证明检查并以 unchangedHead 要求初始 SHA、干净工作树，才移除自有环境；不会通过自动 checkpoint 把诊断中的新增代码变成可删除内容。活跃/未知执行、未封存/新成果或未知 Git 操作保留并报告原因，ignored 文件需要显式 discardIgnored。

finalize/remove 身份持久保存；未知沿原回执对账，明确失败修复后显式重试。环境移除后才解除 consumer，失败时保留恢复引用并区分已移除目录与剩余清理错误。接收新 consumer 与最后释放共用 snapshot 串行边界。

同 import 还有 consumer 时不释放导入；同 snapshot 还有 consumer 时不解除中心 pin，另一快照共享的 LFS 引用不受影响。最后释放依次清理目标下载/import、剩余源候选和每个文件的 pin。解除 pin 不直接删除中心字节，仍沿[文件留存](../../artifacts/retention/spec.md)规则。已完全释放的快照再次使用建立新代次，旧准备继续返回 released。

HAPI cache 回收要求所属环境均已移除、无未决操作、所有成果仍等于初始基线。其他 imports、外部 worktree、未知 ref 或未回收代码保留缓存并显示原因。只有已移除且无变化环境的 base/round refs 可随最终 cache 一起回收。实际删除先原子移到本 import 的自有目录，恢复只续删该目录，不删除原路径后来新建的 cache。回执和历史记录继续保留。
