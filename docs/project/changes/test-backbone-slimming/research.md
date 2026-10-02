# 调查依据与裁剪清单

> 基线：`6cb4332`；调查：2026-10-03。静态判断与实际测量分开，不将候选改法写成已完成。

## 已测量与已确认

- 本次 `bun test ./test`：255 pass、0 fail、4,811 断言、42 文件，墙钟 60.078 秒；日志 `.dev-smoke/test-backbone-plan/root-test.log`、计时 `root-test-timing.json`。只跑一次基线，不为了估算再重复整套。
- 用例耗时合计较高的文件：`hub-resource-cli.test.ts` 11.785 秒，`hub-consumers.test.ts` 4.669 秒，`artifacts.test.ts` 4.354 秒，`tasks-overview.test.ts` 4.120 秒。后者约 3.039 秒来自真实库存 deadline；这是超时保障，不能直接删除。`compiled-cli.ts` 已全进程只编译一次，不把“减少重复编译”当新增收益。
- package.json 有 47 个 `test`/`test:*` 命令。前轮成功证据 53 份不等于 53 个独立能力；入口、进程启动和消费者之间存在重复。
- 第一轮远端 MCP 四次尝试耗时 20.81、14.46、19.88、17.62 分钟，合计约 72.77 分钟、374 次 MCP 调用，前三次失败约 55.14 分钟。证据为 `.dev-smoke/remote-mcp-{C6hU6A,Cdedes,fzpnCz,cnexH5}/evidence.json`。该数字仅覆盖远端这一组，不是整个验收耗时或 token 用量。
- [前轮验收](../../archive/2026-10-02-module-slimming-audit/acceptance.md)和[执行 T13](../../archive/2026-10-02-module-slimming-audit/execution.md#t13-最终同候选验收)记录了输入 fixture、真实二进制 hash 与消费者失配后重跑模型的问题。当前 `installed-binaries.mjs` 已解决 launcher/core 分辨，第二轮应前置复用，不另造一套解析器。
- `smoke-hub-native-mcp.ts:60` 的 shared 分支在 2 host × 2 runtime 中各执行 65 秒等待；`smoke-task-mcp.ts:47` 再按两宿主执行，合计六次同类等待。宿主超时差异是真实边界，保留每宿主一次，runtime 维度不再复制该等待。
- `smoke-collaboration.ts:27` 的 shared/worktree 默认各八组合，remote 四组合；`smoke-artifact-mcp.ts` 再跑八组合，`smoke-hub-native-mcp.ts` 再跑十二组合。不是每项断言都重复，但启动、两轮完成、原生历史、递归拒绝和 MCP 发现多次覆盖。
- `smoke-dashboard.ts` 调用同一个 `smokeConsole`；独立跑 console 后再跑 dashboard 会重复整个浏览器主体。历史读取消费者仍有价值，应在同一次主体运行后接上。
- `cli-install.yml` 在源码或测试推送时四平台构建/安装；`npm-publish.yml` 在发布相关文件推送时又调用它。两者 path 范围相交，可导致同一推送两套构建。Beta 工作区也改这些文件，实施前协调最终版本。

## 前轮失败分类与首要修复

下表只统计前轮 T13 记录明确列出的失败，不代表全部任务失败率；没有全场首次执行分母，不能编造首跑通过百分比。来源为[验收失败记录](../../archive/2026-10-02-module-slimming-audit/acceptance.md)及对应 Execution。

| 失败记录 | 能确认的归因 | 第二轮优先处理 |
| --- | --- | --- |
| SM1QaY | Chromium 可执行路径错误，在模型前失败；环境/调用错误 | 真正启动并关闭专用浏览器的前置探针，不能只检查路径存在 |
| 4xJAw5、i8UBnx | fixture 缺当前 Agent 快照，之后又将全部轮次 inputs 写入第二轮；是两次测试造数错误 | 使用当前真实构造/保存路径，第一轮→第二轮的无模型闭环，产品校验不放宽 |
| outputs 60FNTA | 八轮模型已通过，之后消费者发现 producer 将 npm launcher hash 记成 core；验收证据失配 | 模型前用真实 writer/reader/installedBinaries 校验身份，避免付费执行后才发现静态失配 |
| controls 3z6Foc | 原生错误明确为 serverOverloaded/Selected model is at capacity；不是业务控制通过 | 保留明确外部错误码、停止本 case；固定测试模型/effort，允许一次有记录的新环境重试，不自动降级 |
| remote C6hU6A、Cdedes、fzpnCz | 三次 host 整场超时；出现 201 秒工具间隔、超时后 exit=0，或两轮业务完成而 host 未结束。原始长间隔根因未确认，不能全部判为 provider | 缩短模型承担的流程，逐阶段记录最后进展和错误；host timeout 独立决定失败，首次失败先诊断再决定是否重跑，不能只加时长或整组重试 |

`smoke-collaboration.ts:145–163` 让同一原生 host 完成多步照抄 prompt、审批、轮询、两轮传输、取回和报告；这放大模型行为差异及等待成本，但不能仅凭代码推定每次超时原因。控制器能做的确定性操作移出模型，只保留需要证明真实宿主/MCP 的工具交互；记忆标记、真实字节及原生身份等有效结果检查仍保留。

`smoke-collaboration.ts` 与 `smoke-task-mcp.ts` 直接丢弃 host stderr，可能缺少错误诊断。修正方向是记录有界、脱敏的错误码/摘要和阶段时间，禁止保存完整 prompt、凭据或用户源码；不是原样扩大日志。

实施优先于“40 秒目标”的结果是：已知脚本错误前置阻断、无模型流程可重复、首次失败有明确阶段、未明根因不重试掩盖、失败不拖累已完成且仍有效的 case。真实产品缺陷必须保留失败并修复，不能因为本表有多次验收错误就视为全部是假失败。

## 核心保障与测试归属

以下覆盖当前全部 42 个测试文件。表内名称省略 `.test.ts`，`npm-publish` 为 `.test.js`；归组不表示合成一个巨型用例。便宜且能独立发现错误的测试不因文件短而删掉。

| 骨干 | 当前文件 | 必留的独立故障 |
| --- | --- | --- |
| K1 当前数据与配置 | state、task-records、config | 旧/损坏/WAL 格式无写拒绝、并发初始化、坏任务隔离、无效配置不能覆盖有效文件 |
| K2 身份与授权 | hub、hub-access、hub-sockets、hub-resources、hub-resource-dispatch、hub-agent-resolution | 跨身份/空间/凭据种类拒绝、撤权后在途重查、最后 owner 并发保护、机器/运行时权限不互借、真实 outgoing RPC 重查 |
| K3 中心配置与接入 | hub-agents、hub-repositories、hub-resource-cli、hub-connect | 配置 CAS/重放、仓库身份与脱敏、连接加密/原文件保留、CLI 确实接到中心 |
| K4 执行与恢复 | execution、tasks、task-rounds、hub-delegation、hub-delegation-native | 丢回执不重放、未知不当成功、重启恢复、queued/steer/interrupt/审批、仅原生缺失才重建、准确退出 |
| K5 MCP 接入 | mcp、tasks-mcp、hub-consumers、artifact-mcp | 两宿主真实身份关联、17 工具契约、父隔离/递归拒绝、取消只取消等待、参数到业务行为、附件不泄漏内容 |
| K6 工作区 | task-workspaces、remote-tasks | accepted base 固定、prepare/stop/seal 顺序、取消不启动、hook 失败后仅 retry-finish、删除和新轮互斥、报告/ref 保留 |
| K7 文件 | artifacts、task-files、task-outputs | 路径/归属/字节完整性、固定候选重试、输入 pin、外部引用保护、部分交付与显式 discard |
| K8 远端成果 | remote、task-results | bundle/模块/LFS 的边界调用、固定成果、离线取回/失响应重查、原主库不自动合入、跨消费者引用保留 |
| K9 查询与 UI | tasks-overview、hub-console、proxy | 有界只读查询、unknown/执行/交付区别、HTTP/SSE/WS、浏览器身份与迟到响应、XSS/秘密不进 URL |
| K10 CLI 与安装 | cli、resource-commands、service-commands、mcp-install | 可解析错误/stdio、退出与信号、显式 Hub、真实宿主配置格式、安装回滚和并发编辑保护 |
| K11 发行 | release-assembly、release-inputs、npm-publish、website-build | 源码/包 hash、冻结输入、发布顺序/未知上传/脱敏、网站原子输出与 HTML 转义 |
| K12 测试资源生命周期 | fixture-cleanup、smoke-lifecycle | 构造半失败也清理、逐资源尝试、活进程凭据不删、非零退出/清理失败不冒充通过 |

## 按收益和风险排序的处理建议

| 顺序 | 位置与问题证据 | 具体处理及保留保障 | 风险/验证 |
| --- | --- | --- | --- |
| 1 | T13 inputs/outputs 直到真实模型后才发现消费契约失配 | 复用 current schema、installedBinaries 和消费者读取/所有权检查，模型前做小型合成当前记录的接线演练；不伪造原生成功 | 中；正常接线可进入模型，错误 hash/格式/归属在零模型调用时失败，producer→consumer→cleanup 链检查 |
| 2 | 多个 native/file/task fixture 各持有模型 home、服务和完整证据 | 保留既有 helper，按每条链复用不可变程序和必要源材料；模型 home/身份/任务现场隔离。成功删除自有临时环境，仅留脱敏摘要/失败诊断 | 中；故障注入验证部分构造失败、producer 成功 consumer 失败、清理非零；不做跨用例可变资源池 |
| 3 | remote 单 case 失败后重新跑完整四组 | case 独立持有现场和成功清理证据；同候选且相关测试未变才复用通过 case，失败 case 从新环境重跑全链 | 中；保留失败记录，消费者/共享 fixture 改变则使全部依赖 case 失效，无法确定影响时扩大重跑 |
| 4 | 上述 40 个原生矩阵 case 的重复生产者，加 task-* 原生脚本 | 用六条两轮主链承担同一候选的正常协作、输入输出、工作区、历史；控制/重建保留两 runtime 定向探针。退出历史由后继消费者读取一次 | 中；逐断言映射至 Technical 的 N1–N6 与专项探针，先有真实替代证据再删生产者 |
| 5 | 两个 MCP 脚本的六次 65 秒等待 | 留 Codex、Claude 各一次真实超时及返回检查，移除其余四次；取消/after_revision 正确性留快测 | 低；相同的四次等待本身可少约 260 秒，不据此保证整套提速 |
| 6 | `smoke-dashboard.ts` 与 `smoke-hub-console.ts` 共用主体，历史遍历十二条相同形态记录 | 保留一次浏览器主体 + 两 runtime 各一条真实历史；删除纯转发入口并更新调用方 | 低；权限、token/401、分页、迟到响应、归档消息与 reload 仍由真实 Playwright 覆盖 |
| 7 | `hub-console.test.ts:66–68` 搜索 JS 字符串，`:127` 六条纯标签映射 | 删除实现拼写断言，标签文字并入关键状态的行为核对；浏览器骨干保留 URL 无 token、Authorization、401 清理，快测保留 unknown/停止/交付语义 | 低；先确保便宜浏览器层必跑这些实际行为。CSP/MIME/授权等外部契约不按字符串一概删除 |
| 8 | `resource-commands.test.ts` 四个独立源码 CLI 启动、`cli.test.ts` 多次源码启动；resource CLI 在根测试占 11.785 秒 | 复用已存在的 compiledCli，保留每个命令入口接线检查；权限/CAS 大组合留领域测试，编译 CLI 只留端到端代表主链和必要错误出口 | 中；移除的每项 CLI 断言必须在领域测试中仍可失败，不能只保留 mock 调用次数 |
| 9 | `execution.test.ts:200` 简单审批转发与上层审批流程重叠 | 待核对上层是否验证真实 HTTP path/body/409；确实相同才并入，否则保留该小用例 | 待验证；mock ExecutionClient 不等于 HTTP 适配保障，不能先删 |
| 10 | `.github/workflows/cli-install.yml` 与 npm 工作流的重叠触发 | 普通提交只跑核心及按影响的本机检查；发布候选复用一个四平台构建入口，npm 由该入口获得候选 | 中；actionlint、事件→job 表、稳定/Beta 门禁和真实手动无发布预演；不靠取消发布验收提速 |

## 尚需实施时验证

- 42 个文件中多数用例验证真实边界，不能据标题判成浅层。T1 按实际断言完成删除/合并的精确映射，尤其 K2/K4/K7 不承诺大幅删除。
- 远端同宿主/runtime 配对是否还存在独立耦合：快测仍覆盖四配对；涉及 host/native 映射、HAPI pin 或 workspace 分支时扩展原生矩阵。
- 六主链整合后的固定案例运行时间、两个隔离 case 并发是否互相争用、消费者如何消费最小历史，需要真实验证。默认先串行，不用全局并发隐藏重复。
- 72MiB 流式传输、库存 deadline 和真实 heartbeat 过期测试有不同故障来源，保留在对应集成层，不直接替换为小文件、假时钟或静态状态。

## T2 实际删除与保留映射

| 删除/收敛 | 接替保障 | 实施判断 |
| --- | --- | --- |
| hub-console 中 JS 源码拼写、六条纯标签映射 | hub-console 的 HTTP MIME/CSP/授权；tasks-overview 的 unknown/停止/留存语义；consoleTasks 的真实浏览器 token/401/迟到响应 | 删除实现复述，浏览器集成归 T3 |
| resource-commands 独立文件 | cli 的四资源入口错误出口，仍逐个启动实际编译 CLI | 收敛文件与准备环境，未删除四个入口验证 |
| config 单独的 env URL 用例 | sources 优先级用例保留同一行为断言 | 合并同一职责 |
| hub-resources 重复 schema 用例 | state 的 fresh/WAL/unsupported 无写拒绝；保留 WAL 模式断言 | 删除重复领域覆盖；临时取消版本拒绝后保留用例实际失败 |
| artifacts/state/service-commands/mcp/cli 的源码 CLI 启动 | 共享现有 compiledCli；实际进程、argv、退出信号和 stdio 仍检查 | 减少每次解释源码，不新增编译缓存 |

执行层审批测试保留：上层替身不验证其 HTTP path/body/409。resource CLI 的权限、CAS、丢回执与命令参数接线也保留；仅凭耗时没有证据删除。K1–K12 的其他领域骨干不变，不把少量文件合并包装成大幅用例删减。

## T3 集成收敛与实际发现

- 新的固定入口分 access/storage/web/service-package，组内串行、每脚本独立现场；失败停在该脚本，直接调用该脚本重跑。storage 的 result-export 只执行 fetch 超集和不同的 tasks 分支，不再额外执行基础分支。安装/包组使用冻结候选，在 T4 候选形成后执行。
- 删除 agents/resources/dashboard 三个纯转发脚本。console 接受历史证据参数，主体与历史可一次调用；现有原生历史格式收敛在 T4 完成。
- 浏览器只保留接入→资源登记→Agent 编辑冲突/私有与共享→个人选择→任务/原生视图骨干。删除普通机器改名、Runtime 停用恢复、仓库别名增删/取消恢复、Agent 三种分享范围往返、个人选择删除的重复浏览器 CRUD；对应权限/登记状态/变更行为继续由 hub-resources、hub-agents、hub-repositories、hub-resource-cli 和真实 access 集成保障。浏览器仍验证真实表单写入、CAS 保留编辑、分享后的只读边界与私有概要。
- 首跑 web 的前两脚本通过，console 207.78 秒失败。证据 hub-console-H2fzCm 显示原生会话 offline、审批按钮禁用；fixture 只发过一次 session-alive，跨过 HAPI 有效期后正确离线。修复为存活期每5秒心跳、finally 清理，审批前检查实际 active；没有放宽产品授权或移除审批断言。保留失败日志，重跑范围仅 console。

- 第二次 console 已通过审批，但撤权后人工执行 new EventSource 的负例与真实重定向竞态：页面已回 Hub 后创建了不带 JWT 的原生 EventSource，引发 request 回调未捕获断言，脚本退出1却写 success=true。删除这条额外人工请求，保留真实撤权后的自动跳转/清凭据断言；请求回调错误进入最终 errors 断言，避免异常与证据结果分离。GUI本身无需修改。
- T4 准备时发现 collaboration 的 local/hub 仅按目录命名，nativeUserSmoke.runner 新建目录均初始化为 hub。必须在 N1/N4 使用本地主服务 home，并断言实际 config.mode 和 MCP connection.mode；不能仅沿用 case 标签声称 local 覆盖。此为验收纠偏，不改变产品运行模式。

## T4 原生骨干替代映射

| 移除的重复生产者/消费者 | 接替骨干 |
| --- | --- |
| task-mcp、hub-native-mcp | N1/N2各一次65秒真实等待；N1–N6实际递归CLI拒绝、工具过滤、停止；T3浏览器连接、shared消费者的真实历史 |
| artifact-mcp、artifact-package、task-inputs/outputs/retention | N4/N5/N6两轮输入输出；N5/N6实际MCP上传/下载/取回；artifact-mcp和task-outputs快测保留两宿主retry/collect接线；storage真实capture/delivery故障、固定候选重试与pin释放 |
| tasks、workspaces、worktree-tasks/lifecycle及其专用helper | 六链续接/停止、N3真实hook失败后retry_finish、N4无变更不提交、worktree消费者清理/留存ref/doctor；task-workspaces快测与storage HAPI准备/删除故障保留 |
| remote-native、hub-consumers | N5/N6两Runner、真实模块/LFS、离线取回；storage预检拒绝/准备与引用；按runtime隔离的原生重建/控制专项 |
| mcp完整旧矩阵 | 六链真实宿主MCP；现有probeMcpProtocol（access调用）、根stdio/取消/身份快测 |
| hub-upgrade旧候选入口 | state当前编译CLI对两种DB及start/serve/restart无写拒绝；不再要求建立旧版二进制现场 |

未删除 execution 原生低层能力专项：它含 shared sibling 停止边界，适用于 HAPI/native接口变更，不能只看名称当重复。全部原生替代尚待 T4V 实测；提交前只声明无模型前置通过。T4/T4V拆分只为先冻结候选再记录真实结果，不放宽验收条件。
