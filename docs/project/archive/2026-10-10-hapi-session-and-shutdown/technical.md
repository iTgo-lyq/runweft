# Claude 历史目录与 Runner 退出技术方案


## 依据

HAPI基线3ac8b08b，CLI0.30.7。getProjectPath仅替换非ASCII字母数字；nativeResume、sessionScanner、claudeCheckSession及两种launcher共用此函数。历史长cwd已误报缺失。当前本机Claude2.1.283实际程序采用：绝对cwd替换后长度<=200保持；超过则取编码前200字符，加连接符及完整原始cwd的有符号32位31倍累积哈希绝对值的36进制表示。哈希按UTF-16 charCodeAt计算，不哈希截断或替换后的字符串。实际原生目录另行验证，不复制transcript或建立猜测目录。

Runner退出先await无限重试的updateRunnerState，再清理本地；requestShutdown一秒强退。控制客户端HTTP停止后只等两秒；Runweft托管子进程十秒强杀。三个已有后台manager均支持abort/settled。

## 实现

- 在HAPI公共getProjectPath对齐上述规则，保持resolve和配置根语义。新增固定预期值和真实历史查找回归，所有现有消费者自动受益，不添加旧格式兼容。
- Runner停止请求同步置stopping并幂等；退出专用通知使用现有versioned状态协议一次发送、500ms ACK超时，断连直接跳过，保留正常运行期间重试。
- 本地固定清理步骤复用现有API/manager：停止心跳和接收新RPC/启动，关闭机器连接；同时取消三个manager并等待收尾；关闭控制接口；仅清除本PID状态；释放本实例锁。一个步骤失败仍尝试后续步骤，日志指出阶段。
- 退出总期限8秒、controlClient等待10秒，Runweft现有托管10秒期限保留。正常本地清理成功退出0，异常/清理失败/超时退出1。取消兜底timer；局部启动失败也回收已获得资源。不改原有成功handoff和独立会话存活规则。
- HAPI代码、相关回归及HAPI生命周期文档在其Git仓库提交；Runweft仅更新gitlink/package pin、删除旧smoke退出1例外、添加本轮专用验收入口和验收文档。

## 验证

替换、长度和截断按UTF-16码元；31倍hash每步截断int32，含代理对跨200边界的固定向量。补充运行期状态/metadata重试取消，迟到ACK不得更新本地版本；启动阶段登记已有清理资源，每个关键await后检查停止。三个manager为RepositoryManager、WorkspaceManager、ArtifactTransferManager，同时abort，不管理独立agent生命周期。spawn进入停止前若尚未创建进程则拒绝，已创建的独立进程保留。撤权后沿当前断连行为，直到本地停止；无有效凭据启动失败退出1，新凭据重启保持machineId。

CLI聚焦及全量Vitest与typecheck、相关manager测试；同候选Runweft完整基础检查、access集成、真实Runner断连/撤权/连接无ACK停止和重启、长路径Claude两轮原生续接。父进程核对退出码/无信号、清理日志、状态/锁与控制端口，记录二进制hash。专用原生配置由已有modelHomes复制、验后核对原文件及认证副本是否变化并移除副本。默认真实模型使用已有授权，不将秘密、prompt或源码写入归档。物理远端及Mac/arm64实测不由同机证据替代。
