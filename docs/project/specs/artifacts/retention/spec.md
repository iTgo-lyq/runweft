# 文件留存、限制与清理

中心字节保存在 HAPI_HOME/artifacts，业务关联/清单保存在 Runweft state.sqlite；Runner 输入、持久操作回执和未交付 spool 保存在当前连接 HAPI_HOME/artifact-transfers。输入与候选不散落于系统临时目录，备份须覆盖中心数据库、字节、业务库及尚未交付的机器数据。

server.artifacts 默认 maxFileMiB=512、namespaceQuotaGiB=10、unreferencedDays=7、pendingHours=24。限制作用于所托管 HAPI；Hub 客户端读取服务实际限制，不能用本地配置覆盖它。预约与未删除对象共同占额，只有字节确实删除才释放配额；artifact limits 按预约、发布、删除中及去重引用对象展示用量，该数字不是文件系统物理占用。

对象有任意 pin 时，普通删除和过期清理拒绝；purpose 为 input/output/recovery 或未知来源均受保护。`artifact refs` 查看留存原因。单对象 remove 不要求达到过期年龄，但仍检查引用及活跃上传；删除中断可沿原对象继续，墓碑可通过 ID/requestId 查询。

`artifact prune` 默认预览，--apply 才删除未引用、过期对象。available 按 publishedAt、reserved 按 createdAt 计龄，释放 pin 不重置年龄；清理前核对已落盘未发布内容并重新检查年龄、引用、状态和活跃上传。稳定 ID 游标翻页，每批 limit 1–200，逐项返回删除或错误。

## 轮次释放

`task artifacts release <id>` 默认预览，--round 可选指定轮次，--apply 才执行。要求本任务所有轮次和文件操作已静止；只释放本轮拥有的 input/output 引用及已确认的机器副本，外部或 recovery pin 保留。未确认的操作先查询，不能按超时推断可删。

已捕获但未交付的候选须显式 --discard-pending --apply 才放弃。中心先持久化释放意图，再回收机器副本并 unpin；丢响应或重启继续同一意图，不重新执行模型。状态为 retained/releasing/released/discarded，首次或变化的错误及完成通知通过 artifacts_revision 可见。

释放不删除报告、Git ref 或 worktree，不改历史清单的失败事实；下载以对象实时状态为准，已释放不保证字节继续存在。释放期间拒绝本任务新轮次和文件操作；释放后的旧轮次不能 retry/collect，新成果通过 next 建立新约定。工作区输入复制与 checkout 共同留存，附件释放不删除其环境。
