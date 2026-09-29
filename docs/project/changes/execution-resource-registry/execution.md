# 全局机器与 Runtime 注册执行概况

## Plan 评审与主 agent 复核

- 当前工作区 iclaude 会话 `f54ca0d9-fc39-4c22-9ebe-9e8ee206833f`，2026-09-29 12:41–12:48（Asia/Shanghai），退出 0、result success。本 Change 的一次 Plan 评审已完成；无额度错误、不需要替代 subagent，不重复评审。
- 原始材料位于本机 `.dev-smoke/reviews/execution-resource-registry/`，以下为独立复核后的采纳结果。

| 意见 | 主 agent 处置 |
| --- | --- |
| Hub 服务端也是 local 配置，不应按它拒绝远端目标 | 采纳；客户端 local 限制本机，中心公共解析按 namespace。未采纳“loopback 天然只有一个 Runner”的推断，同机多个身份也需要正确处理 |
| Codex 旧 preflight override 不等于 shared launcher 实际命令 | 已独立核对源码，采纳。原 available/reason 保留 preflight 事实，新增详情查询真实命令。登记/新目标解析同时核对二者，增加有效旧 override 但真实 CLI 缺失的用例；不改 launcher |
| 环境变更需重启 Runner | 采纳，在缺失/无效诊断和使用说明提示沿启动时环境探测，修改后 restart |
| 版本查询异步、有时限，不强制旧 Runner 升级 | 采纳，异步并行 execFile，上限 3 秒；使用可选能力，只有请求详情时核对，不加入 REQUIRED_MACHINE_CAPABILITIES |
| 列表避免历史堆积且应显示派生资格 | 采纳，默认已登记与当前本机，--all 查完整历史；runtime 显示不可用于新委派的具体原因 |
| machine register 不隐式启动中心 | 采纳，首次提示 start，登记和启停分开；已知离线身份可以登记但保持不可执行状态 |
| 项目 agent 的中心 runtime ID 不可跨用户直接复用 | 作为下游事实写入 Agent Change，要求显式重绑定，不在本 Change 引入项目级资源注册或自动按名称改派 |

四项任务和依赖保持不变。Requirement/Technical 已按既有自主授权收敛，Plan 可进入执行；以上调整不引入新的执行框架、权限或外部资源。


## T1 暴露 HAPI 现有机器库存与原生工具详情

- 结果：现有机器列表增加 includeOffline=true，并声明 machineInventory:1；保留默认在线列表和 namespace。原 availability RPC 增加可选详情，Codex/Claude 使用实际 launcher 的解析器查询 executable/version，异步并行、3 秒上限、输出受限；原 preflight 与真实命令发现分别表达，不改 launcher、权限或原生会话。可选 Runner 能力在登记/连接时声明，详情请求对旧 Runner/离线机器明确报错。
- 聚焦检查：CLI 的命令解析、版本详情、机器 API 共 40 项，Hub 路由/RPC 共 44 项通过；覆盖旧 override 与实际 Codex 不一致、真实命令缺失、原配置无效、版本失败/不可识别/超时、默认探测不执行命令、跨 namespace 和旧 Runner 拒绝。超时测试确认事件循环仍可运行。
- 全量检查：HAPI 完整 typecheck 通过，Hub/Web/Shared/Relay 分别 1385/3249/323/118 项通过，Hub 3 项既有跳过；CLI 全量 2968 项通过、11 项既有跳过，1 个“非 Git 目录”既有用例因验证目录祖先 .git 标记失败。该模块 28 项在确认所有祖先没有 .git 的 /var/tmp 专用目录重验全部通过，覆盖全部 2969 个有效 CLI 用例；未修改无关 skills 代码或断言。gen:fixtures 无差异。Runweft typecheck 与 38 项/226 断言回归通过。
- 环境修正：首次 CLI 临时目录位于本仓库内，Git ceiling 无法影响 skills 的文件系统祖先查找；改到 /tmp 后仍受该目录已有 .git 标记影响。最终使用逐级确认无标记的专用目录，并仅删除本次创建的验证目录，保留已有 /tmp/.git。对应证据 `.dev-smoke/resources-t1-cli-skills-final.json`。
- 真实查询：专用源码 HAPI Hub/Runner，经现有编译 Runweft 的 hapi.executable 显式开发覆盖管理；空原生配置目录，不运行模型、不复制模型凭据。查询到 Codex 0.156.1、iclaude/Claude Code 2.1.283；默认 availability 不含详情，不同原生 namespace 不能读取机器；离线 ID 保留、默认列表排除、Hub 重启后保留，Runner 重启复用原 ID 并重发能力。证据 `.dev-smoke/resources-native-bdexM3/evidence.json`，success=true、cleanupErrors=[]。这是源码管理链路验收，配套资源产品组合由 T4 完成。
- 验证等待修正：首轮 10 秒等待短于 HAPI 的 45 秒活跃超时；第二轮又误以为 Hub ready 时持久 active 已收敛。按现有每 5 秒过期检查等待状态收敛后，上述完整重跑通过。未增加 Runweft 心跳或改变 HAPI 在线规则。
- 配套构建：`bun run build:hapi`、`bun run build` 通过，新固定版本的 Linux x64 配套二进制已生成；业务资源接口仍按 T2–T4 继续落实。
- HAPI 提交：`feat: expose offline machine inventory and native tool details`，Runweft 固定为 `56ec77f19322619a429304e7a948ba2c46eaca4d`。
- Commit：`execution-resource-registry T1: pin native machine inventory and tool inspection`

## T2 双模式全局资源登记与目标解析

- 结果：中心 state.sqlite 保存分开的机器/runtime 登记，WAL、事务化 schema version 和唯一约束保障稳定 ID；取消保留引用、恢复复用原 ID，名称不能改绑目标。新增认证资源 API 和 ResourceClient/ResourceService，转交调用者原 JWT，按 namespace 读取与写入；local 本机限制只位于客户端，中心不按自身部署配置拒绝其他 Runner。API 保留结构化 code/message/hint，不自动重放变更。
- 目标判断：每次解析查询实际 Runner，同时检查原 preflight 和真实命令；版本失败本身不拒绝已发现工具。列表每台机器探测一次，明确当前/历史观察、不可选原因和模型认证/执行未检查。探测期间取消机器或 runtime 会在返回前重新核对，阻止新解析，不改已有快照或控制原生任务。
- 检查：`bun run typecheck`、`bun test ./test`（48 项、471 断言）、`bun run build` 通过。10 项资源组合测试使用真实 SQLite、HTTP 网关和 JWT，覆盖并发 16 次登记去重、namespace/连接隔离、目标不可改绑、取消/恢复、探测期间取消、离线历史、不一致 preflight/命令、版本失败、单机故障与结构化错误。原生查询在此组使用受控响应，不视为模型执行验收。最后名称上限复用 HAPI 常量和数据库错误传播调整后，重新通过 typecheck、10 项/245 断言资源测试及编译。
- 测试修正：首轮并发取消用例在释放探测前调用 Bun 的异步 expect matcher，测试自身等待导致超时。改为先收集 Promise 结果、完成取消并释放后断言，最终整组通过；未为通过测试修改取消行为或放宽断言。
- 编译服务回归：`bun run test:service` 通过认证、HTTP/SSE/WebSocket、重启、独立 Hub 客户端、公开中心及信号清理，证据 `.dev-smoke/service-9fci7z/evidence.json`，success=true。最后调整未改变该网关/服务路径。
- 真实 API 组合：最终配套编译程序、专用中心和独立 Hub 客户端/Runner、空原生配置，仅查询版本。实际发现 Codex 0.156.1 与 Claude Code 2.1.283；登记两种 runtime、重复登记、重命名、分开取消/恢复、namespace 隔离和中心重启后解析均通过；中心 local 配置可解析 Hub 客户端，客户端没有权威资源库。证据 `.dev-smoke/resources-api-dKomWj/evidence.json`，success=true、cleanupErrors=[]。不改真实用户配置、不运行模型、不冒充跨机器验收。
- 范围：本任务提供资源 API 和调用层，正式资源 CLI、使用说明及可重复整体验收仍按 T3/T4 推进；HAPI 固定源码未变，不重复 T1 全量检查。
- Commit：`execution-resource-registry T2: persist scoped resources and resolve execution targets`

## T3 统一资源 CLI 与使用说明

- 结果：统一 CLI 提供 machine/runtime 各自的 register/list/show/rename/unregister，以及 runtime discover/check；支持本机默认、Hub 显式机器、默认列表与 --all。人类与 JSON 输出包含当前连接、namespace、稳定 ID、登记/Runner/工具状态及观察时间；check 不可选时非零退出，discover 不因只安装一种 CLI 而失败。空环境提示 start 和最短登记命令，无隐式启服或安装。
- 使用说明：说明机器/runtime/agent 的区别、后续按 ID 引用、取消/恢复、不自动迁移 Hub 引用、环境修改后重启 Runner，以及版本未知不等于认证失败。paths 与数据表说明中心 state.sqlite；Hub 客户端明确指出权威库位于中心，项目目录不生成资源配置。
- 验证：`bun run typecheck`、`bun test ./test`（51 项、616 断言）、`bun run build` 通过；编译版 machine/runtime 帮助完整。新增实际 CLI 子进程对接真实网关/SQLite 的三项组合测试，覆盖空环境、输入错误、两个 cwd 同 ID、全部管理命令、名称保留、分别取消与恢复、JSON/人类一致、check 退出码、历史观察、版本超时及缺少命令。测试共用受控原生响应，不冒充真实模型或完整原生组合；T4 使用配套 Runner 验收正式 CLI。
- Commit：`execution-resource-registry T3: expose machine and runtime commands with clear resource guidance`
