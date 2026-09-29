# Agent 定义执行概况

## 一次 Plan 评审与采纳

- 评审：当前工作区 iclaude，2026-09-29 13:56–14:02（Asia/Shanghai），原生会话 `46bc9cae-6ff5-48c8-a04b-4f73c4bc09d3`；只读完成，退出 0，无额度错误。原始结果 `.dev-smoke/reviews/agent-definition/review.md`。
- 采纳：非空模型/推理参数必须指定 flavor，声明的 flavor 总是约束目标；坏文件只影响对应 id；connectionName + namespace + 稳定来源键；显式 scope 维护；Git common dir 共享个人绑定；显式宿主 cwd、可序列化连接快照与批量目标发现；home 搜索边界、.yml 错误提示、只读符号链接和明确 id 规则。
- 判断：worktree 仍读取自己的 Git 基线定义，共享个人执行资源选择不会混合内容；不同 clone 隔离。显式 flavor 即便无模型参数也有约束含义，避免空参数暗中撤销用户选择。
- 保留：validate 作为离线检查入口；description 允许空值，由 list 明示“未填写职责说明”，不因缺少展示说明阻断手动选择。schemaVersion 默认 1。不引入模型清单或统一配置平台。
- 下游：委派生命周期补充两种 flavor 非空模型/推理参数的真实启动验收；本 Change 只验证原生映射且不启动任务。
- 确认：按用户自主推进授权采用修订后的 Requirement/Technical/Plan，三个任务依次独立提交。

## T1 可解释的全局与项目定义

- 结果：全局/项目 YAML、完整覆盖、来源与被遮蔽项、稳定内容版本、显式 cwd/Git worktree/非 Git 定位和 init/list/show/validate 已实现。坏文件逐项报告，指定 id 不受无关错误影响；符号链接只读，创建不覆盖。
- 验证：`bun run typecheck` 通过；`bun test ./test/agents.test.ts ./test/cli.test.ts` 6 项、60 个断言通过，包含真实 Git worktree/clone、配置错误和 CLI 子进程；Change 结构校验通过。读取未创建数据库或服务目录。
- 边界：个人绑定和在线目标检查按计划由 T2 加入；当前不创建任务。
- Commit：`agent-definition T1: add scoped YAML definitions and offline agent commands`
