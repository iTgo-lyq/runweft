# 一键完整卸载执行概况

## Plan 评审

- iclaude 只读评审会话 `ff08266e-4108-42da-bd9b-8e91fe2dc187` 成功，耗时约 12 分钟；未耗尽额度，未使用 subagent。有关进程、跨 home 接入、Skill/Git 元数据与 npm 时序的必要意见进入 Technical；主 agent 落实并自动验证。

## T1 完整卸载实现与删除边界验证

- 结果：根级 uninstall 默认预览、--yes 执行；核对 npm/独立平台包归属，MCP 无备份编辑及内存回退，保护 home/Skill/源 Git 边界，直接调用已存在的 HAPI 控制接口。进程检查包含恢复记录、程序 realpath、父进程链及控制端口实际所有权；保留其他配置/模型凭据，拒绝未知状态。
- 验证：`bun run typecheck` 通过；`bun test ./test/uninstall.test.ts ./test/mcp-install.test.ts` 15 项、169 个断言通过，真实编译 CLI 子进程执行独立包卸载，验证预览、源项目与用户分支、符号链接、另一 home、配置回退和原有备份行为。Hub/Runner/npm 真实安装在 T2 验证。
- Commit：`complete-uninstall T1: add guarded complete uninstall without backups`

## T2 实际安装自动验收与维护说明

- 结果：新增 `test:uninstall`，在独立 HOME、原生配置与真实 npm 全局 prefix 中复制包模板，换入当前编译程序/Skill/说明后本地安装，完成 8 组卸载验收。真实 Hub、两个连接的 Runner 使用原生控制接口停止登记的当前/恢复记录测试进程；不调用模型。npm 失败保留数据及程序，重试删除安装、home、全部备份和三处产品 Skill；其他 Hub、原生配置/凭据/历史、其他软件及源项目保持不变。重装重复执行与完整独立平台包/PATH 链接删除通过。
- 修正：强化 Git 测试发现另一工作树同时检出任务分支时未被拒绝，原因是 porcelain 分段后的最后字段不带尾部 NUL；按字段匹配后拒绝并保护该工作树。macOS ps 参数按 Apple 原始手册修正为 -E 输出环境、state 输出状态；此处是文档依据，未声称 Mac 运行通过。
- 首次失败：npm smoke 最初以同步子进程运行卸载，阻塞测试父进程回收会话替身，HAPI 将僵尸子进程视为忙碌；改为异步等待使父进程正常回收，再验证真实控制流程。随后全根测试首次 259 通过/1 失败暴露上述 Git 检查缺口，修正后全量通过。没有盲目重发模型或修改真实用户配置。
- 文案：iclaude 成功会话 `595dd164-f86c-49b7-b732-9c0b6039ce2b` 重写维护文案；更新 usage、产品 Skill 与开发验收入口。官网仍对应公共 1.1.3，因此未添加尚未发布的操作；源码说明明确该版本没有完整卸载命令。
- 最终验证：`bun run typecheck`、`bun run build` 通过；`bun run test` 260 项/42 文件、4887 断言、65.94 秒通过；`bun run test:uninstall` 8 组通过；`git diff --check` 通过。编译程序 SHA-256 为 `99f37911bdb3b8756f212eb608382ff8005d12dbd735aa05833fd01f9a87f24b`，本地 npm 安装实际二进制匹配；详细摘要见 verification.json。
- 清理：所有 uninstall-npm 专用现场移除；原独立 HAPI 两个 PID/启动标记保持，默认 ~/.runweft 仍不存在。本次没有 npm 发布、推送、线上部署或 Mac/arm64 实机验收。
- Commit：`complete-uninstall T2: verify installed teardown and document full removal`
