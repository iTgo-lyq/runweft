# 本地自动验收

> 授权：用户确认本方案，并沿AGENTS既有授权由agent自动验收。

2026-10-10在Linux x64完成两项修复。HAPI代码在独立仓库提交，Runweft只固定引用及更新验收；本轮未改业务数据库/本地配置格式。未推送、发布npm或覆盖此前完整发行包。

## 候选

- HAPI：8f774b9413fd483bc163cc06425d7646f10a7c92，CLI0.30.7、protocol1；包含路径46430e47及退出8f774b94两个任务提交。
- Runweft任务提交：b4c99f1a651099e65aa9a7a098132add638878a7（T1记录c2ec2a7、T2记录ea44c9b）；package.json/gitlink引用同一HAPI；dist/runweft及dist/hapi均从该干净HAPI构建。真实center status核对pin，所有集成/原生用同一二进制。
- SHA256：Runweft `16b613c3a44ca53d200a2f91e9fa9998d66588bb32a36b6f7b0edf2e9bc46196`；HAPI `d72a2ddada75ea806a3abedd9d443602352eac44477eac38d9e1bd52b75467be`。

## 需求映射

| 需求 | 已观察证据 |
| --- | --- |
| Claude目录规则 | 核对实际Claude2.1.283算法；独立hash固定向量、200/201、Unicode及截断碰撞通过。真实299字符cwd写入原生JSONL，与公共适配一致 |
| 真实长cwd续接 | 编译center/Runner在268字符、无symlink、非Git专用cwd执行两轮Claude Task；同nativeSessionId f9cba7cd-34b3-4963-a93d-825d4e9ec363、同HAPI session，第二轮回忆首轮随机标记，未reconstruction |
| Hub通知失效仍清理 | 实际SIGSTOP本次自建Hub、连接仍在且无ACK，Runner617ms退出0；Hub停服112ms退出0；均无退出信号、state/lock清除、控制端口关闭 |
| 撤销凭据停止与恢复 | 资源smoke真实轮换撤销旧socket，旧Runner1467373退出0/无信号，正常清理日志及state/lock/port检查通过；新凭据启动同machineId并完成真实版本发现 |
| 正常停止与启动失败 | 正常121ms退出0，保留machineId重启114ms退出0；无效凭据启动456ms退出1，已有state/lock/控制服务清理。启动失败端口从本PID日志补充核验 |
| 失败/并发语义 | 回归覆盖一次500ms通知、不重试version-mismatch、更新取消/迟到ACK、停止门禁、重复请求、局部失败仍执行后续清理、8秒期限和阶段日志 |
| 独立会话保留 | HAPI串行真实进程测试，Runner清除state后独立session PID仍存活；测试自有进程登记器随后回收，最终审计通过 |
| 配置和凭据保护 | modelHomes核对原文件摘要通过，认证副本摘要未变；所有测试进程停止后删除副本/服务凭据，未修改用户Codex/Claude配置；原生现场cleanupErrors为空 |

## 已执行检查

| 检查 | 结果 |
| --- | --- |
| HAPI聚焦路径/nativeResume/sessionScanner | 三文件25项通过；补入真实固定向量后的path16项通过 |
| HAPI CLI typecheck | 通过 |
| HAPI CLI全量Vitest | 271文件3049项通过、11项skip；TMPDIR=/var/tmp/.dev-smoke/hapi-session-and-shutdown |
| HAPI Runner串行集成 | 14项通过、1项压力测试skip；补充保留独立session定向测试1项通过 |
| Runweft bun run typecheck | 通过 |
| Runweft bun run test | 最终248项通过、0失败、4800断言，显式./test |
| Node发布/CI/官网检查 | 33项通过 |
| bun run build:hapi及bun run build | 通过，HAPI源码/pin/hash核验通过 |
| bun run test:integration access | access/realtime/resources/configuration四脚本均退出0，组evidence success=true |
| bun scripts/smoke-hapi-session-and-shutdown.ts | 真实五Runner场景及Claude两轮通过，evidence success=true、cleanupErrors=[] |
| 启动失败端口补查 | 同候选五Runner控制端口均关闭，包括父进程尚未读到state的失败启动 |

CLI全量首轮唯一失败是既有skills测试：/tmp/.git目录标记让非Gitfixture被视为Git祖先。保持该目录及实现原样，改用无Git祖先的专用TMPDIR重跑后全量通过。首次build因旧HAPI缓存被拒绝；重新build:hapi后build成功。没有通过放宽断言或沿用退出1例外消除失败。

## 证据与边界

当前私有原始现场未提交：`.dev-smoke/hapi-session-and-shutdown/`保存评审/单测/构建/端口检查，`.dev-smoke/hapi-lifecycle-YXWEHq/evidence.json`保存进程与原生事实，`.dev-smoke/integration-XMHhTw/evidence.json`保存access执行，`.dev-smoke/hub-resources-VyQMMX/evidence.json`保存撤权退出。完整prompt、模型认证及用户源码不写入归档；本文件是可保留的脱敏摘要。

本轮只验Linux x64及同机专用实例，未重跑完整发行矩阵，也未做物理跨机、macOS或arm64原生实测。原已发布1.1.1与此前离线发行包仍是旧HAPI候选；本轮修复只有当前源码与本地构建。
