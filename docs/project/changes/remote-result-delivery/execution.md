# 远端代码回收执行概况

## Plan 评审

本 Change 唯一一次 iclaude 只读评审已完成，session `d215c3f1-50fa-4a14-b0ce-cd92e777f994`，2026-09-30 02:06–02:18（Asia/Shanghai），exitCode 0、result success。仅开放 Read/Glob/Grep，无 MCP、无子 agent、无文件修改。结论为核心方案可执行、无硬阻断；主 agent 逐项复核如下，不再重复评审。

| 建议 | 独立判断与落实 |
| --- | --- |
| 用成果清单直接持有恢复文件，取消 result consumer/nullable importId | 采纳简化，v6 只增加表。但完整 Git bundle 不含旧 LFS 实体，因此清单必须内嵌初始基线与成果两份文件映射，并 pin 去重集合。只保留成果 HEAD 的字节不足以恢复基线。 |
| 复用未变化模块、明确全量包配额代价 | 采纳发布阶段按 path/module/format/commit 复用已验证 artifact，保留原 bundleRef/hash；不为免除打包增加持久缓存。显示上传/复用/保留字节和准确清理、配置命令。 |
| wait 后正常即可 fetch，细分补交动作 | 采纳 seal → TaskResults → TaskOutputs → finished，初次发布先得出确定结果；补交使用 code_revision。code.next 区分 retry_result 与 retry_artifacts。 |
| 提前证明真实封存接入和 C9 回归 | T3 用实际 HAPI prepare/finalize facts 驱动 TaskResults；提取传输逻辑后立即跑 C9 实际诊断。T4 验证共享 baselines、origin/target 分离与 consumer 插入后崩溃。 |
| fetch 防止 Git 配置引入隐式副作用 | 采纳操作级空 hooksPath、禁递归/自动维护/commitGraph、no-write-fetch-head、本地协议；直接恢复 LFS。以 reference-transaction hook 和目标配置证明。 |
| 确定捕获失败后允许明确放弃 | 采纳严格限定的 discard-pending：原生停止、Git sealed、相关操作确定停止；保存 tombstone 后放行后续 prepare，未知操作不能绕过。首次基线失败提示按原固定 SHA 新 spawn。 |

另补齐两处源码风险：成果错误不能被当前 finishing catch 覆盖成 Git unknown；结果重试必须覆盖捕获失败但仍在 finishing 的轮次。共享依赖关闭顺序改为先等待 tasks 再关闭 preparations/store。T5 校验 cache 的 changed/ref allowlist 消费精确 ref 释放事实；T6 增加无 remote 和递归未变模块。

原始评审记录：`.dev-smoke/reviews/remote-result-delivery/{meta.json,events.jsonl,review.md}`。需求、技术与 Plan 的持续自主执行授权有效；本次规划提交不表示目标行为已经实现。

## 实施前证据

- 现有 HAPI 成果导出、独立导入与 Git/LFS/模块对象恢复原语：`.dev-smoke/c10-result-research-14IO6t/evidence.json` 成功；首次 bare 模块配置失败及修正见 Research，尚不构成新 API 或正式应用验收。
- nullable importId 迁移原语：`.dev-smoke/c10-consumer-migration-34tvyf5h/evidence.json` 成功；14 张原表/11 条原行不变。评审后选择更小的直接 pin 方案，不采用该表迁移；正式 v6 与完整旧任务/附件数据留在 T3 验证。
- 规划仅修改文档，未修改运行代码或 HAPI revision；结构、本地链接和 diff 检查通过。
- Commit：`remote-result-delivery: confirm reviewed recovery and delegation plan`
