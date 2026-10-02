# 第二轮测试瘦身执行概况

## T1 验收可靠性

- 结果：native-file/console 的第二轮造数共用真实 append/save 契约，快测经过中心接受、两轮存储和零 native dispatch；实际 consumer 复用 installedBinaries 校验，防止 launcher/core hash 混淆；浏览器先于模型或服务昂贵阶段启动。新增原生 host watchdog，超时后 exit=0 仍失败，只记录白名单错误码、最后工具和时序，拒绝原始 stderr 落盘。
- 验证：`bun test ./test/acceptance-fixtures.test.ts ./test/smoke-lifecycle.test.ts`：5 pass/0 fail、28断言、0.636秒；缺快照、跨轮输入、坏hash、坏浏览器路径、SIGTERM退出0及秘密不落证据均实际检查。`bun run typecheck`通过（首次发现 Error.code 类型错误后修正）；`git diff --check`通过。未运行真实模型。
- 边界：T1提供真实两端函数和宿主诊断基础；完整逐case前置/消费/清理编排与失败摘要在T4落实，不能把本次快测当模型或浏览器实际功能通过。
- Commit：`test-backbone-slimming T1: fail before model work and diagnose native hosts`
