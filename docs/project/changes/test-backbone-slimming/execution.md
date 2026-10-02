# 第二轮测试瘦身执行概况

## T1 验收可靠性

- 结果：native-file/console 的第二轮造数共用真实 append/save 契约，快测经过中心接受、两轮存储和零 native dispatch；实际 consumer 复用 installedBinaries 校验，防止 launcher/core hash 混淆；浏览器先于模型或服务昂贵阶段启动。新增原生 host watchdog，超时后 exit=0 仍失败，只记录白名单错误码、最后工具和时序，拒绝原始 stderr 落盘。
- 验证：`bun test ./test/acceptance-fixtures.test.ts ./test/smoke-lifecycle.test.ts`：5 pass/0 fail、28断言、0.636秒；缺快照、跨轮输入、坏hash、坏浏览器路径、SIGTERM退出0及秘密不落证据均实际检查。`bun run typecheck`通过（首次发现 Error.code 类型错误后修正）；`git diff --check`通过。未运行真实模型。
- 边界：T1提供真实两端函数和宿主诊断基础；完整逐case前置/消费/清理编排与失败摘要在T4落实，不能把本次快测当模型或浏览器实际功能通过。
- Commit：`test-backbone-slimming T1: fail before model work and diagnose native hosts`

## T2 浅层测试与 CLI 启动

- 结果：移除源码拼写/纯标签断言及重复 schema 用例；环境 URL 归入来源优先级用例，四资源入口归入 CLI 文件。五个文件改用已有 compiledCli，进程/协议保障保留。逐项替代见 Research 的 T2 映射。
- 验证：7文件定向35 pass/0 fail（7.12秒）；完整根测试255 pass/0 fail、4,814断言、42文件、58.37秒；typecheck通过。临时移除版本拒绝时 state 保留用例实际失败，随后原样恢复产品源码；无产品代码变更。
- 偏差：原有255用例删/合并3个，T1新增3个有实际回归价值的用例，净用例数不变。单次58.37秒对基线60.078秒不足以声称显著提速；主要收益仍须看集成和原生验收。
- Commit：`test-backbone-slimming T2: keep behavioral tests and reuse compiled CLI`

## T3 无模型集成与浏览器骨干

- 结果：新增固定四组入口，删除三个纯转发文件；web 的 console 与历史使用同一入口，保留原生历史读取接线供 T4 收敛。console 删掉重复 CRUD 浏览器往返（45行），替代见 Research；保留并发编辑、私有/共享边界、审批与文件、身份失效、迟到响应等实际浏览器保障。
- 验证：access 4脚本与 storage 11脚本均退出0、各证据 success=true（详见 `.dev-smoke/test-backbone-plan/t3-{access,storage}.log`）。web 身份/连接两脚本通过；console 最终 wDqAAi 通过且临时 home 删除、cleanupErrors=[]。typecheck、diff与文档校验通过。service-package 依赖干净包候选，按计划在 T4冻结后执行，当前不声明通过。
- 首次失败：console H2fzCm 因单次心跳过期而审批按钮禁用；补持续心跳后 GU1c65、收敛 CRUD 后 CKon6r 又暴露撤权重定向后人工 EventSource 竞态及回调异常未进入证据。均保留失败退出记录，修复夹具心跳/异常归集并移除竞态人工请求；仅重跑 console，没有重跑已通过脚本或调用模型。最终原生失效检查仍实际通过。
- Commit：`test-backbone-slimming T3: group model-free checks and stabilize console fixtures`
