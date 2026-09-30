# Hub 最终集成执行记录

## 执行环境

- 主执行者：TraeX 会话 `01a0f3d9-1ed7-7b33-a2f6-146c5e371e55`，GPT-6-Astra，xhigh；沿当前会话独立完成，不等待前执行者。
- 工作区 `/home/tiger/workspace/runweft`，分支 `codex/cli-foundation`；阶段六归档基线 `9f85353`，开始时干净。整体阶段七由本父 Change 承担，不是第五阶段内部 T7。
- 当前 HAPI pin `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`，0.30.7/protocol 1，子模块不修改。全部临时证据在 `.dev-smoke/`，用户全局配置、模型原件、在线 Hub/Merlin 不动。

## 方案评审

正式 Technical/Plan 已建立，纠正父需求中已被用户取消的旧数据导入验收，改为有界显式 reset；版本定为 1.1.0，避免与旧认证 1.0.0 产物混淆。

iclaude 首次进程因变长 `--mcp-config` 参数吞入末尾 prompt，在模型启动前退出；错误保存于 `.dev-smoke/reviews/hub-final-release/stderr.log`。加入 `--` 后重启同一次只读评审，输出路径为同目录 `review.json`。仅允许 Read/Grep/Glob，禁止编辑、模型实测、子 agent 与读取临时凭据。

评审会话 `5146b7ab-98a3-4f75-8f66-25568718eee5`，385217 ms、51 turns，is_error=false，无阻塞、七项非阻塞意见。独立采纳：连接 smoke 改编译服务（评审期间主 Agent 已发现并补方案）、各入口显式传平台二进制并记相邻 hash、dirty=false/固定包输入差异/按源码revision归档、reset运行中拒绝与保留字节、Skill相同内容才复用独立场景、QEMU记录当前命令。未采纳“不测1.0.0→1.1.0”：本机已有阶段六 Hub/schema18 的1.0.0真实编译程序，并非旧root版；已保存到 `.dev-smoke/final-baseline-1.0.0`，hash及来源见 provenance.json，可在专用新数据上真实升级，不扩展兼容框架。

方案与Plan按持续授权确认，开始串行 T1。没有再次调用 iclaude 或另开代评 subagent。

## T1 当前安装与维护验收入口

- 结果：Node 服务 smoke 通过已安装 CLI/相邻 HAPI 覆盖首次无身份/Runner、root拒绝、机器登记、两连接、监督重启、信号关闭及运行中reset拒绝/停服保留worktree/新身份；不依赖Bun或模型工具出现在产品PATH。registry 安装删除旧现场分支，保留专用npm/MCP、重装/卸载/缺包和留存断言；新增配套二进制realpath/hash记录。
- 结果：增加 `smoke-hub-upgrade.mjs`，以专用新建Hub数据验证旧程序写入、候选诊断运行版本、停服升级后身份/机器/Agent/仓库/附件/保留工作区不变。T1用1.0.0→1.0.0预演成功，真正1.1.0版本差异待最终候选验证，不冒充已完成升级。
- 验证：typecheck、Node语法、diff-check、9 pass / 0 fail（97断言）通过。服务 `.dev-smoke/service-nyYA51/evidence.json` 五组；registry `.dev-smoke/install-Fmp68g/evidence.json` 八组和两宿主MCP检查；四包/Skill内容及Linux x64独立服务 `.dev-smoke/release-packages-JWhV08/evidence.json` 全部通过；升级预演 `.dev-smoke/hub-upgrade-erCu3B/evidence.json` success=true、cleanupErrors=[]。
- 返修：首次registry断言仍要求旧手册英文措辞，改为当前契约；失败 `.dev-smoke/install-vFf4dU/evidence.json`。包验证首次 `hapi --version` 没有专用home，读取默认旧配置后报tokenEnv无效，未写配置；补显式 `--home` 后通过，失败 `.dev-smoke/release-packages-upSn3p/evidence.json`。这些是阶段六1.0.0工作区包验证，T4必须对1.1.0统一重跑。
- Commit：`hub-spaces-and-agent-configuration T1: verify current installed Hub services and maintenance`。

## T2 已安装程序的真实协作组合

- 结果：连接 Playwright 与消费者使用已安装 CLI 托管默认 Hub/相邻 HAPI，移除 harness 内源码 gateway；消费者使用两个 CLI-managed Runner。新增两 runtime 精确轮次停止/旧轮次拒绝/原记忆续接，以及 Hub 重启后读取原报告不重放。所有入口记录配套程序 realpath/hash。
- 结果：MCP 入口扩为两宿主 × 两 runtime × shared/本地worktree/同机远端十二组；shared 四组保留真实65秒等待。支持 host/mode/runtime 聚焦选择，核对父原生身份、工作区/目标机器、报告、子CLI递归拒绝及轮末PID退出。只批准专用helper、proof读取及精确只读Git状态/末次摘要，其他操作走原生拒绝而非放宽权限。
- 验证：typecheck、diff-check、16 pass / 0 fail / 527断言（3文件）。安装版连接 `.dev-smoke/hub-connect-4VDuxX/evidence.json` 五组；消费者 `.dev-smoke/hub-consumers-rrWZeQ/evidence.json` 十组 success=true、cleanupErrors=[]，包含真正非空任务重启检查。prepare/controls 聚焦分别为 `hub-consumers-34fYH9`、`hub-consumers-iDE4QN`；prepare-only 的重启空集不当作完整恢复证据。
- 验证：远端Codex已在 `hub-native-mcp-MQcEkf` 完成真实spawn/wait/read；远端Claude最终 `.dev-smoke/hub-native-mcp-Utj7i0/evidence.json` success=true、cleanupErrors=[]。T2仍使用安装版1.0.0入口预演，不代替T4正式1.1.0十二组。
- 返修：`hub-native-mcp-Hhc9Ki`、`hub-native-mcp-ncc2IL`、`hub-native-mcp-MQcEkf`、`hub-native-mcp-LNlROL` 的整组均失败且清理成功，原因是测试遇到模型额外只读Git及echo组合时直接终止。没有未知执行重发：每次已清理专用现场后创建新测试；改为明确限制提示及非预期命令返回denied，保留精确允许集合。最终聚焦没有非预期请求。此前对已清理现场的两次人工批准尝试均因cwd/连接失败未生效。
- Commit：`hub-spaces-and-agent-configuration T2: exercise installed Hub collaboration and native matrix`。
