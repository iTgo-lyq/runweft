# 业务轮次与定向控制

同一 delegation 的 next 持久排队，等待前轮停止及当前工作区模式收尾后才开始。任务始终沿用既有目录、runtime 与定义快照；后来修改 YAML、个人绑定或 CLI cwd 不重定向旧任务。

有附件时，preparing 先完成[本轮输入](../../artifacts/inputs/spec.md)。原生停止和 Git 封存后进行[文件交付](../../artifacts/delivery/spec.md)，传输未确定前不开放下一轮；确认部分交付后可结束本轮。文件 retry/collect 的恢复独立于模型轮次，不改 completed_revision。

首轮通过 HAPI 启动。后轮优先 resume 前轮已停止的原生 session，核对实际返回的 machineId/path/flavor 与能力就绪后才投递新输入。只有明确 native_session_missing 才按[上下文规则](../context/spec.md)构造历史并新建 session；离线、权限、读取失败或未知响应不当作历史缺失。真实新旧 HAPI/native 身份在输入前关联。

独立模式在 preparing 取得当前准备引用，spawn/resume 都消费该引用；每轮完成前须经 finishing 固定 Git 成果。收尾失败/未知阻塞后轮，显式 retry_finish 只重试收尾；已排队的轮次不重建目录或重新选择基线。环境删除与 next 在同一事务互斥，已删除环境拒绝续接。

## 本轮追加

steer 要求当前活跃 round_id，只支持 Codex；Claude 返回 steer_unsupported。接受记录不等于已经注入原生 turn，输入分别展示 pending、steered、queued、invoked、unknown。沿 HAPI 已有消息队列及 steer 入口查询实际归属；同一业务轮次可能包含同原生 turn 的追加，也可能由后续原生 turn 消费，不伪造二者一致。

同一轮次所有实际输入取得可靠终态后，中心关闭本轮执行；模式收尾完成后才允许下一轮写入。已知可靠终态和已收集输出不会被后来的传输 unknown 或关闭后读取失败覆盖。

## 中断与审批

interrupt 固定业务轮次。排队且未启动的轮次可直接取消，不触碰正在执行的前轮；已结束轮次返回 already_finished，不影响后轮。活跃轮次优先取消队列输入或按 localId/executionId 定向中断，再归档该轮 session；requested 不代表已停止。

独立任务在准备中取消时先等待原 Git 操作明确；准备成功但没有启动执行的轮次同样封存后才结束，不为收尾启动模型。已在 finishing 的执行已经停止，interrupt 返回 execution_already_stopped，不改变取消或原生结果。

原生执行未知时也可显式请求取消，但必须确认同一实际执行已停止后才完成业务取消，保留 native unknown 和不完整报告标记，不能伪造原生 interrupted。停止未知或失败通过 attention 返回。

审批必须绑定当前活跃 round 的真实 pending request，排除启动/续接前已有的旧请求；仅响应该 ID，支持原生 answers，不改变默认权限或使用全局自动批准。权限阻塞时 wait 立即返回可处理的事实。
