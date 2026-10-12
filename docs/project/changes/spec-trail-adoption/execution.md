# 执行证据

## T1 工作流与历史记录

完整引入 SpecTrail 上游 `67984848`，目录逐文件比较一致，移除旧技能入口，登记 main 守护分支；共享 `.githooks/pre-commit` 已通过仓库本地 core.hooksPath 启用。CI 运行全库状态检查，独立原型和工作流文件不触发 HAPI 运行集成，产品路径的触发规则保留。

迁移 39 个已归档 Change、163 个任务和一个暂停 Change。`migration.json` 记录原文提交、原提交时间、原 Markdown 摘要和任务映射；at 为本次登记时间。hub-host-cleanup 明确记 specs.not_needed。旧 T4b/T5b/T4.1/T3.1/T4V 映射为合法编号；原提交标题、日志与命令中的旧编号保持。两次发布故障触发的返修按最终完成依赖展开，原失败证据保留，避免制造任务依赖环。

依赖仅来自明确前置及 Hub 七阶段交付；组合/下游链接不转为依赖。47 处失效相对链接已修正到现存归档或实际存在的历史源码提交，归档相对链接检查无缺失。

验证：上游 setup 测试 10/10；完整 Workflow/41 个 Change 的共享 schema、编号/标题、任务 DAG、Change DAG 和归档路径一致。独立临时 Git 仓库执行本仓库共享 hook，非法 protectedBranches 提交退出非零，修正后提交成功；不是仅检查脚本文字。特殊任务的原始行内证据字符串已和基线比较保留。临时脚本、原始日志与 hook 回执在 `.dev-smoke/spec-trail-adoption/`。

Runweft 产品源码未改变；本次基线 typecheck、260 根测试/4890 断言、build 通过。后续对工作流和原型执行针对性验证，不把这些基线检查当成尚未完成的原型测试。
