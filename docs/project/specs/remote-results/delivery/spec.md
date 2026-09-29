# 中心代码交付

远端任务收尾依次固定 Git、发布代码、交付声明附件，再形成轮次完成通知。捕获失败保留 finishing 并阻止下一轮；固定候选后上传明确失败可结束原生轮次，显示 needs_attention。执行、Git 封存、中心代码与附件状态分开，代码错误不把 sealed 改写为 unknown 或把原生成功改为失败。

默认使用中心持久文件传输完整 Git bundle、递归模块 bundle 及 LFS，无 Git remote 或未 push 的提交同样可交付。中心不运行 Git 或模型；发布必须核对可信 HAPI 导出/封存 facts、清单和全部 artifact 摘要、大小及恢复引用。主端取回仍独立验证内容。

基线与成果共用回执对账、100 项批次及配额逻辑；同 HEAD 完整快照、同 path/module/format/commit 的模块 bundle 和内容相同的 LFS 可复用。清单保存复用文件的真实 ref/摘要，不把新候选名当作旧文件内容。完整 Git 历史不包含 LFS 实体，因此基线旧 LFS 和成果新 LFS 一起保留。

CLI `task result show/retry`、MCP read_agent/retry_result 查询或修复当前轮次。retry 要求明确 round，持久 request ID 固定原意图；捕获确定失败可修复后重新捕获，候选已经固定则只重传。unknown 查询原机器操作，不重新执行模型、输入或 checkpoint。附件失败沿 retry_artifacts，不用代码重试代替。

read/wait 的 code 返回状态、固定成果、取回摘要、上传/复用/保留字节及具体下一步。初次交付先于 completed_revision，后续补交/取回/留存使用 code_revision 和既有 wait 游标；不提供后台宿主注入。配额不足给出 server.artifacts 配置键和显式释放/清理路径。
