# 委派结果与等待

概览提供 agent_id、round_id、revision、当前活跃轮次、status、attention、有界报告、原生输入状态、stop 与 finish。列表优先显示仍在处理的轮次；read/show 默认最新接受轮次，可显式读取历史轮次。取消后方排队轮次不会在列表中隐藏仍执行的前轮。

status 为 running、needs_attention、completed、failed、interrupted、unknown。正常完成要求可靠原生终态、执行停止及模式收尾均满足；启动前明确拒绝可形成业务失败，但不伪造原生终态。显式取消的未知执行保留未知来源。审批、未知步骤或关闭失败附原因及下一步。

执行、交付和接纳分开表达。共享模式报告为 available/pending/no_final_text，Git 为 not_applicable，接纳为 external；completed 不表示已经合码或验收，也不要求文本报告任务制造提交/bundle/PR。

artifacts 提供 none/pending/delivered/incomplete、不可变清单、待处理操作和当前留存；input_files 展示输入准备及下载副本回收。文件交付失败不篡改原生执行结论；固定候选和补收规则见[文件交付](../../artifacts/delivery/spec.md)。

独立模式展示 preparation、实际 cwd 和环境 retained/deleting/removed。Git 交付区分 pending/not_prepared/sealing/sealed/needs_attention/unknown，成功返回 base/start/result SHA、成果 ref、可选 checkpoint、partial、变更数量/有界路径。finishing 仍为 running，收尾错误返回 workspace attention 且保留原生 completed/failed/unknown 与报告，不伪造模型失败或重放任务。

未启动且已明确失败/取消的执行显示 not_started；准备失败的 Git 为 not_prepared，不伪造模型终态或已固定的成果。执行取消的部分结果仅在停止确认后封存。删除错误单独保存在环境 removal 中，不覆盖原生结论；清理后报告与 Git 引用继续可查。

## 报告

概览报告最多 4000 字符，详细读取默认 16000、上限 64000，使用 offset/next_offset 分页。结构化 summary/changes/tests/remaining 可选，解析失败仍保留原生原文并标记 structuredMissing；不根据报告文本猜成功。详细事实不通过原生结果字段重复返回完整报告。

## 等待与游标

wait 在任一指定任务完成或需处理时返回，并内联有界报告。超时返回 timed_out=true 和当前概览，任务继续运行；等待取消不归档执行。

不带游标时，以调用开始时已接受的最新 round 为目标，旧轮次完成不会提前满足新轮次。带每任务 after_revision 时按序返回其后的完成/文件通知，每个 round 保留 completed_revision，文件交付与留存另有 artifacts_revision；按二者最大值升序消费，后轮开始不抹掉前轮完成通知。历史通知的 revision 指向该通知版本，current_revision 表示任务最新版本。

等待后轮时，前轮的审批或未知状态仍通过 blocking_round_id 返回。游标只抑制已交付通知，不删除报告或审批；需要详情时按固定轮次读取。
