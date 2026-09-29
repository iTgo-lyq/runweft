# 宿主 MCP 适配实施计划

> 来源：[Requirement](requirement.md)
> 技术方案：[Technical](technical.md)
> 状态：待执行
> 执行模式：逐任务提交
> 确认方式：按用户授权，当前工作区 iclaude 一次评审，主 agent 独立复核后执行。

## 交付目标

用户通过一个 Runweft 命令为 Codex/Claude Code 安装全局 MCP，在实际工作区内取得正确宿主身份和工具结果。HAPI 受控子执行首次启动及停止后续接均不暴露 Runweft MCP，其他 MCP 与内置 subagent 能力保持可用。

## 关键决策与风险

- 工具禁用只覆盖 Runweft 受控执行，不再要求所有原生子会话动态分流列表。
- HAPI 沿原有启动与续接链路承载非秘密参数；Codex 的禁用配置必须逐 root 应用，不能影响共享 engine 的兄弟会话。
- Claude 调用身份依赖精确 toolUseId 的公开 hook；同 cwd 不能充当身份，启动环境不能跨 `/clear` 永久绑定。
- 安装只维护自己的 server/hook 条目，备份集中管理；成功握手与真实宿主调用分别验收。
- 工具响应是已支持结果通道；未验证的后台唤醒不冒充交付。本 Change 不搬入委派状态、附件或 Git 成果实现。

## 任务

### T1 HAPI 受控执行的 MCP 工具禁用

- 状态：待开始
- 交付：逐执行 disabledMcpServers 参数及能力声明，现有 metadata 保存、spawn/resume 转交、Codex/Claude 原生应用，Runweft 执行调用层兼容检查。
- 依赖：已归档执行契约
- 验收：真实 HAPI 启动、停止、原生续接均不暴露指定 MCP；Codex 有/无原条目均可启动，另一个 MCP 和默认原生配置保留，无关 root 不受影响；缺少能力/不支持的 runtime 明确拒绝，重复 requestId 的参数冲突可见。
- 验证：管理链路和原生配置聚焦回归，两 runtime 的专用真实 HAPI 实验；HAPI 共享契约规定的类型、全测试及 fixture 检查；两仓库独立提交并固定 revision。

### T2 真实宿主身份与 MCP 调用承载

- 状态：待开始
- 交付：stdio 入口、静态业务工具注册、Codex 调用身份、Claude hook 关联、统一上下文及连接诊断工具；取消/断开传递。
- 依赖：T1
- 验收：真实两宿主可以调用诊断并得到正确 cwd/会话；同 cwd 并发不串身份，Claude clear/resume 使用当次 hook；身份缺失/冲突报错；取消等待不触发执行控制，测试工具不进正式列表。
- 验证：协议与上下文测试、真实 Codex/Claude 主会话、hook 身份切换与延迟审批实验、同一 Codex app-server 两个不同 cwd，类型检查及相关回归；临时手动配置只在专用目录，正式安装由 T3 交付。

### T3 一键全局安装、诊断与维护

- 状态：待开始
- 交付：install/check/uninstall/restore CLI，Codex 原生编辑器 staging、Claude 自有条目合并，集中备份与用户说明。
- 依赖：T2
- 验收：默认检测与显式选择清晰；重复安装、更新、卸载均可用；其他 MCP、配置及注释保留；失败能恢复，备份路径明确；两个项目使用同一全局安装仍绑定各自 cwd。
- 验证：独立原生配置目录及临时 HOME 下未设置 CLAUDE_CONFIG_DIR 的安装/失败注入/恢复测试；安装后的两种真实宿主连接；编译路径含空格测试及原有 CLI 回归。

### T4 配套构建与宿主整体验收

- 状态：待开始
- 交付：可重复的两宿主/两 runtime 真实验收脚本、完整证据和使用说明。
- 依赖：T3
- 验收：同一配套 Runweft/HAPI 构建覆盖主宿主安装与身份、受控子工具禁用及续接、其他配置保留、结果返回与取消；Requirement 所有本地标准闭环。
- 验证：编译产物专用 local/hub 连接和真实客户端组合，原有服务与执行回归；通过后单独同步 Specs 并归档。

## 整体验证

本 Change 独立验收不制造业务 delegation。诊断工具与测试处理器证明真实身份、工具承载及禁用；完整派生/等待/续接业务由下一阶段实现。仅模拟 MCP、仅测试原生 CLI 参数或仅安装配置成功均不足以验收整项。真实远端验证仍单独记录，不以此阻塞本地闭环。
