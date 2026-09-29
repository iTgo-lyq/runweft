# 代码恢复留存

轮次完成关闭原生执行，保留 worktree 和 session 历史供 next 续接。每轮清单独立持有初始基线与成果文件去重集合的 recovery pin；task consumer 保护输入快照和目标 import，二者独立。发布成果在目标 checkout/cache 消失后仍可从中心取回。

CLI `task result release <id>` 默认预览，省略 round 选择已有结束或收尾轮次；`--apply` 保存逐项副本/引用释放进度。未交付候选须 `--discard-pending` 明确放弃。活跃原生、未封存或未知操作不能绕过；不提供 MCP 清理工具。

释放先核对并回收受控机器副本，再解除本轮 recovery pin。部分进度、丢回执或服务重启沿原记录继续，不重新 pin 或运行模型。其他轮次/任务/基线/LFS 引用继续保护文件；解除引用不删中心字节，后续使用 artifact prune/remove。

清单、报告、Git facts 和主库已取回引用保留；codeRetention 保存 releasing/released/discarded 与错误，read/wait 展示有界摘要，释放后的结果不再宣称可取回。新 fetch/retry 拒绝；尚无机器写入的 waiting 取回随 tombstone 明确失败。

捕获确定失败但原生已停止、Git 已 sealed、相关操作均确定停止时，可显式 discard-pending 保存墓碑，继续正常附件收尾后放行排队下一轮；不跳过下一轮 prepare 或改写 resultHead。未知不能以放弃代替对账。

远端 task workspace remove 要求轮次/文件/代码动作确定，代码已交付且候选回收完成，或已显式释放。HAPI 仅按确切 round/head 删除该环境自有成果 refs；本机默认保留 refs。移除后沿基线服务释放 task consumer，错误和 pending 状态单独可见，其他消费者/外部引用保护缓存。中心恢复 pin 不依赖这个缓存，详见[独立环境](../../remote-workspace/isolation/spec.md)。
