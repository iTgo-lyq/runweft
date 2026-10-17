# 实施记录

## T1 按改动选择 CI 检查与依赖

开发工作流先在 Node scope job 确定范围与执行文档/流程检查，checks/prototype 仅按结果运行，最后汇总拒绝失败、取消或缺失的必需结果。修复首次 push 零 SHA、PR merge-base 与测试路径漏选；本地同一入口支持显式基线和工作区改动。官网仍由所属工作流负责，安装/native 范围为后续入口及人工验收提供选择依据，当前未将建议冒充已执行。

验证：Node 工具测试 56/56 通过（含 3 个 scope 契约测试，使用真实 Git 仓库验证首次 push、分叉、重命名、删除及未提交文件）；actionlint v1.7.12 通过。以 origin/main 到 170d47e 的实际文档差异运行 scope，core/tools/kit/prototype/website/install 均 false、groups/native 为空。新工作流的 Actions 实际运行证据待后续提交后读取，当前结果是本地验证。

开始交付 `docs/testing.md` 的现行范围选择说明，其余操作随对应入口补入。尚无产品测试/模型执行结果，不把旧 Claude 实测作为本次运行。

## T2 删除已确认的低价值测试和不可达分支

删除 24 个指定测试块及无用 import，website-build 整文件删除；collaboration 删除不可达 CONTROLS/DISCONNECT 分支和唯一使用的 43 行 mcp-cut 代理。没有补等量测试，保留配置写入失败、数据库/WAL 保全、真实 HTTP/字节、任务不重派、真实进程强杀失败和发布不可重复写入等已有保障。原生 main/专项及交接机制在后续任务切换，本次未调用模型。

定向 Bun 测试 40/40 通过（10 文件、757 个 expect、18.79 秒），Node 工具测试 50/50 通过，类型检查通过；文档/流程及 diff 检查通过。首次类型检查发现删除三元分支后留下的逗号，已修复并重新通过，不将首次失败隐去。

删除旧测试后暴露历史归档的本地链接依赖。未修改只读归档，文档检查对当前不存在的归档引用使用归档加入时的 Git tree 核对；当前文档仍要求现行文件存在，历史中也不存在的链接仍失败。实际旧 website-build 引用已按该方式核验。

## T11 修复轻量文档校验的 submodule 隐含依赖

T1 的 Actions run 38994958028 在 scope 的文档检查失败：54 个历史/现行链接指向尚未初始化的 HAPI，checks/prototype 被跳过且 result 正确报错。没有把该 run 报作成功，也未初始化 HAPI 来维持文档-only 的隐藏依赖。

文档检查现在明确报告未准备外部树的链接未验证，产品检查准备 pin 后再次核验；根仓当前/历史引用仍执行原有校验。在新建的无 submodule、无 node_modules checkout 复验：349 文件、899 个本地链接、0 错误，54 个 HAPI 链接明确 deferred；流程检查通过。当前已准备 pin 的工作区：953 链接、0 错误。actionlint 与 diff 检查通过。后续 Actions 结果继续跟踪；这是 T1 的追加修复，不覆盖其首次证据。

## T3 用真实接线试点 Bun 集成与关闭语义

235 行 hub-configuration 长链替换为 91 行 Bun 集成：保留实际 CLI/Gateway/HAPI Runner 的 Agent 选择与解析、runtime 撤销和错误身份拒绝，删除多层重复治理、参数和展示矩阵。当前整体入口和 scope 已切换到同一测试，默认根测试暂显式限制在根层文件；没有保留旧 smoke 转发文件。

共享关闭函数合并并发/重复关闭结果，逆序尝试全部资源；owner hook 在 Bun 超时后仍等待实际退出。真实子进程超时测试已证明该行为；忽略 SIGTERM 的强杀测试将宽限改为 30ms，从约 5 秒降至约 40ms，仍要求失败和进程消失。

实际验证：重建 dist/runweft（复用匹配 pin 的 HAPI）；真实 Hub 配置接线 1/1 通过，4.72 秒，无模型；关闭/超时/旧分片接线 8/8 通过，新增超时 hook 后生命周期文件 3/3 通过。首次真实链发现 Agent definition 缺少 flavor，服务拒绝输入，修复后通过；类型检查发现访问私有 Store 字段，改用现有 gateway Store。失败及成功后的专用运行根已由 owner 清理。文档/流程和 diff 检查通过，现行说明已同步。

## T4 集中核心契约并切换默认与集成入口

默认入口缩为 core 的 3 文件、8 项检查，实际 0.36 秒；跨模块契约迁入平铺的 integration。原 smoke 集成清单、四个清单镜像测试及调度入口删除，改为一次 Bun test 调用，直接支持文件/名称筛选、原生分片和 timings。真实服务显式传配对程序；CLI 替身仍按本次进程共享编译。CI 和发行工作流同步改为文件选择与 Bun 分片，按所选文件准备 HAPI、原生程序版本发现和浏览器。

删除 CLI Agent/选择完整矩阵、Runtime 治理复演、第二次真实心跳过期等待、普通状态机/MCP 重复双 runtime/宿主排列和同路径第二份 72 MiB 文件；2×2 接线集中于 cli-consumers。仓库 import 长链并入 results，保留重启后导入收据、另一个 worktree 删除不破坏已有结果/缓存；真实 Git hook 首次封存失败与显式新 attempt 进入同一无模型成果链。三条不同的大文件传输、SSE/授权撤销/回执未知不重放仍保留。HAPI Runner 无 ACK、拒绝启动、重启与断连退出从原模型脚本独立为无模型生命周期测试。测试 helper 移到实际消费者旁边，跨验收共用的 lifecycle/deadline/preflight 留 test 根；没有新增调度框架。

实际验证：类型检查、core 8/8、Node 工具 50/50、文档/流程、actionlint、diff 检查通过。HAPI 固定 pin 的 artifacts/repositories/workspaces manager 31/31 通过，Vitest 含原有 globalSetup，23.89 秒；只按 pin/协议/检查接线影响选择。空名称筛选和真实配置链缺少 --bin 均以非零退出；大文件 hash、上传中撤权、未知回执及真实 Git hook 拒绝提供代表性失败反例。

第一次迁移整组为 250/251：旧消费者测试限定错误为 ENOENT，tmp 根先触发既有来源路径拒绝；改为核验拒绝、非零退出与结构化失败证据，该交接机制按 T9 删除。进一步去重后用 Bun 原生 4 分片复验，56 文件每片 14 个，timings 并集无缺项/重复：57/57、71/71、50/50、69/70。唯一失败为合并 import 断言放在 results 已主动删除 cwd 之后，已将隔离断言移至破坏性样本操作前，定向 fetch 1/1 复验通过（29.74 秒）。因此当前 248 项均有通过证据；没有自动整组重试，也没有把旧失败运行报成全绿。分片实测 22.51/43.15/134.94/151.63 秒，最后一片包含首次失败，不能作为最终全绿耗时。

Actions 38995400052 的 scope、prototype 通过，checks 在历史归档链接校验失败；根因是 checks checkout 缺少历史，无法查询被删文件的归档 Git tree。当前 checks 改为完整历史，保留此前失败记录及最终汇总的正确阻断。新实现的远端运行结果后续跟踪；本次未调用模型或发布。

## T12 补齐干净 CI 的 HAPI 构建前置

T4 Actions 38996745344 的 scope/prototype、文档、类型、core、tools 均通过，checks 在 `bun run build` 因缺少 HAPI manifest 失败。工作流明确先 build:hapi 再 build；本地移开已有 manifest 后执行同一顺序，实际生成配对清单并构建成功。actionlint 通过。此项是 T4 的追加修复，原失败与已通过的本地测试事实不改写；修复后的远端结果继续跟踪。

## T5 收敛候选安装、启动与卸载验收

实现检查点：launcher 移入 src；候选校验/私有安装与正式包输入、HAPI 源码归档校验归 scripts。一个 Node 入口按 npm/standalone 分别消费未改写候选，验证实际服务、信号、MCP 配置保全和完整卸载，删除旧 package/install/service/uninstall 四入口及 KEEP_INSTALL。HAPI 源码逐文件比对前移到打包阶段，四平台开发/发行安装复用同一入口。Node 工具 50/50、官网发布工具 20/20、类型/文档/流程/actionlint/diff 通过；此检查点用于冻结干净包输入，实际候选安装尚待以下验证记录，不提前宣称任务完成。

T5 安装实测：冻结候选 `b9b8006` 的 Linux x64 npm / standalone 两种布局均通过（`/tmp/runweft-install-t5-retry1.json`）；实际无 Bun PATH、Hub/Runner、MCP 握手、版本不一致诊断、前台 SIGTERM、npm 删除失败后显式重试、完整卸载与外部配置保留均有证据，两根已删除且 cleanupErrors 为空。首次运行及四平台 CI 38997190450 的安装失败为 fixture 遗漏 `hub.url`，已补齐；失败也正确停机清理，不冒充成功。候选 hash、平台缺项、dirty 来源三种反例均在安装前拒绝。关闭失败的严格语义沿用 T3/T4 生命周期反例；修复后的四平台 CI 继续跟踪。

T5 四平台复验：Actions [38997618984](https://github.com/iTgo-lyq/runweft/actions/runs/38997618984) 的 Linux x64/arm64、Darwin x64/arm64 安装 jobs 全部成功，每个平台均运行 npm 和 standalone 两种布局，共八个安装生命周期。该结论仅针对四个安装 jobs；此刻整个 development checks 尚在运行，未将其整体计为通过。

## T6 缩减浏览器与原型验收到核心用户路径

删去 Hub 的完整仓库/Agent 版本与分享/成员角色/选择排列，以及任务展示、筛选分页、错误排列、重复审批/文件样本和时钟模拟。样本从 owner 27 个任务加 member 1 个，降为两个 owner 各 1 个；身份页删除普通改名、空间 CRUD/角色矩阵。保留实际 WebCrypto/原点绑定、选择解析、一次编辑冲突保留表单、任务到原生消息与 SSE、跨 owner 拒绝、真实 token 轮换与恢复、DB/WAL/日志秘密扫描。`openTaskHistory` 是浏览器与后续真实历史共享的普通页面函数；删除 console 中不可达的旧 sourceFixtures 分支。

官网从六档宽度 × 三页降为两档 × 三页，删除几何/装饰/无 JS 重复链和公开 Kit 安装；原型从 24 个入口视口组合降为 16 个，删除整套演示 CRUD 和错误/空白场景排列。官网仅验证可见图像解码，准确 DOM npm 命令和失败短路仍保留。

实际结果：Hub console 1/1（12.50s）、精简后的 identity 1/1（6.62s）、connect 1/1（4.58s）；官网 build + browser-only 通过（27 个本地链接）；原型 build、发布工具 10/10 和 16 个浏览器入口通过。首次 console 断言误用未展示的 Runtime ID，改为实际展示的执行机器 ID 后通过；首次官网把手机隐藏装饰图当可滚动元素，改为可见图片检查后通过。只定向重跑失败项；未调用模型、公共 npm 安装或部署。

## T7 提供独立的灵活验收环境入口

新增薄 `scripts/dev-env.ts`，只有 start/stop、显式二选一程序来源、可选 Runner；复用候选私有安装/隔离环境和现有产品进程检查，不引入 PID 注册表、业务 seed 或测试调度。元数据只记目录、程序路径/摘要和来源，身份凭据保存在产品专用配置，终端只返回位置。未确认结束的轮次和活跃/MCP/未知进程拒绝停止删除；停机与程序消失确认后回收根目录。隔离配置同时排除继承的 Codex/Claude/API 环境值，正常入口不复制模型凭据。

实走仅 Hub 的后台启动、HTTP 访问、停止及重复停止；带 Runner 的启动、外来目录拒绝、损坏 Runner 状态拒绝、真实活跃进程登记后的拒绝，以及显式结束该进程后正常停止，均通过。本次反例是仓库外一次性验收驱动，没有沉淀第二套进程框架或测试镜像；没有调用模型。

T7 候选路径使用冻结候选 `b9b8006` 实际启动后台 Hub，启动进程退出后 HTTP 仍可访问，显式 stop 确认回收。失败 HAPI 替身返回退出码 7，产品 start 明确失败，dev:env 确认进程退出并删除其专用根。最初一次性残留探针误把同时运行的另一候选环境计入；改为只核对失败命令返回的自身根后通过，未扫描删除任何其他根。类型检查、npm-release 工具 17/17、文档/流程/diff 通过；一次测试文件名输入错误没有计入通过结果。

## T8 明确工程工作目录与报告消费

工程消费者已改为显式 `RUNWEFT_WORK_DIR`，发行冻结源码显式 `RELEASE_SOURCE`；CI 使用 run/attempt/job/slot 临时根，source 通过本地 Git object clone 后检出冻结 commit 到仓库外，工具、配置、公共候选及报告各在本次根下。成功收尾并输出证据后删除根；失败保留至一次性 runner 结束。Kit 使用系统临时导出且 EXIT trap 回收。没有扫描或删除旧 `.dev-smoke` 或未知用户目录。

report-evidence 仅消费显式文件列表，一次校验后输出原 `RUNWEFT_CI_EVIDENCE={path,report}`；官网生产者返回明确报告路径，最终收集沿用旧 `.dev-smoke/website-pages/...` 作为协议 ID，恢复不改。发行标记、原先 prepublication step 显示名和读回契约保留。普通集成直接使用 Bun 输出，删除无报告来源的全目录扫描步骤。官网本地浏览器验收新增必填 `--report`，服务/浏览器全部关闭后，成功回收私有安装，失败保留诊断根；报告和截图在根外。

实际验证：Node 工程/官网 71/71、actionlint、类型、文档/流程/diff 通过；真实官网 browser-only 成功且私有根已回收；错误浏览器路径的失败报告为 false，服务全部关闭且明确保留根，本次探针随后回收该已停根。CI 根与 slot 绑定、非法 slot 拒绝、仓库外冻结 checkout 源码干净通过。缺失/重复证据反例与官网只读恢复/上传失败留回执均通过。首次 actionlint 拒绝 job-env 使用 runner context，改为 13 行共享 CI 准备入口；两处工具测试原先依赖输出全字节/最后一步位置，改为核对实际门禁值，复验通过。未执行发布、部署、OIDC 交换或远端 Kit 同步；原生旧链的剩余物理依赖留 T9 整体移除。


## T9 单 case 原生验收实现检查点

删除旧 9 个 smoke 入口、跨命令交接/消费/重建续跑协议和两个镜像测试；必要原生准备、控制、恢复和少量协议探针归属 test/acceptance。main 只选五项，专项显式选择，固定 native 不调用 dev:env。三条主链各一个任务两轮，N5 单独承担 Hub/Runner 重启后成果取回，N1/N5 直接在停掉 Runner 的同一 Hub 读取真实历史并核对消息/会话未变化；单进程持有现场后取消数据库副本消费者。N4 单独保留项目 Skill/MCP 代表性接线，N1/N5 各验证一个 runtime 的禁止递归委派。控制去掉记忆准备轮/Agent 更新矩阵，保留真实批准、拒绝、中断及 Codex steer/兄弟隔离。

报告显式路径、拒绝覆盖，绑定源码与候选输入；校验必需集合来自调用者。去掉源/副本认证状态 hash，不默认调用 iclaude。初步类型检查及验收边界 3/3（错误候选、旧选例、缺项/错指纹/失败、真实超时）通过，文档/流程/diff 通过。此检查点尚未执行真实模型，不能计作模型通过；提交后冻结候选进行实测。

T9 首次 N1/L-claude 在 Agent 创建阶段失败：新公共 fixture 传 model/effort 时遗漏必需 flavor，尚未调用模型。补回 flavor；两个现场关闭通过、凭据副本清除。首次失败报告保留，验收代码变化后另建冻结版本，不能关联为同输入报告复用。完整开发 CI 38998858898（2a5d260）与官网 38998858887 均已成功。

T9 第二批：N1（66.8s）、N4（85.9s）和 L-claude（32.3s）真实模型通过，均确认关闭并回收；N1 读取真实 26 条原生消息且未改变消息/会话。C-codex 与 N5 首次把 Task 的 permission_required / needs_attention 误判为失败，均已停止并清除凭据副本；修正为仅允许明确审批等待，其余 attention 仍失败。这是验收驱动接线错误，非产品行为改造。新冻结输入下定向复验；首次报告不覆盖。

## T10 手册与实走检查点

交付 docs/testing.md：完整组织图、环节/触发条件/命令表、依赖准备、范围选择、固定 core/tools/integration、候选安装、浏览器/原型/Kit、自由环境、原生五项及专项、显式报告复验与失败/未知处置。入口对应真实文件与 CLI，不增加目录/注册表/调度抽象。模型等待期间在 T9 冻结实现后切换到文档任务；整体验证仍等待所有任务实际结果。

实走冻结候选 c0daff9 的本机两种安装（/tmp/runweft-t10-install.json）通过；干净源码工作区按手册启动候选 Hub、访问返回 URL、停止及回收通过。一次外部探针误在已带 /hub 的返回 URL 后再次拼 /hub，修正探针后正常访问，无产品改动。用明确不存在的 CLI 触发集成前置失败，再只重跑 hub-configuration（4.69s）通过。core 8、Node 工程/官网 71、接线/验收边界 4、Kit 结构、文档/流程/diff 通过。一次手输报告校验 SHA 不存在被拒绝，改用实际 git rev-parse HEAD 后 N1/L-claude 两份报告核对通过。

T9 R-claude 真实缺失重建通过；R-codex 首轮通过后，只移开 JSONL 而保留原生索引数据库，产品正确进入 resume unknown 并没有重发。本 fixture 改为完整移开自己的原生数据目录，仅复制当前配置/认证到空目录，再确认真正缺失；保留原始历史用于核对且移除留存目录中的配置/认证。该修正对应原方案的空原生 home 语义，不改变产品 unknown 行为。

T9 后续控制：C-codex 86.5s、C-claude 35.6s 通过，分别四轮/三轮；Codex 另以一个原生共享宿主会话对验证关闭隔离，未新建独立入口。R-codex 第二次已完成 missing 重建，只因退出后的 JSONL 位于 archived_sessions 而探针仅查 sessions 失败，改查自身完整 nativeHome。N5 第二次的原生父宿主拒绝了任务 cwd 内 git status，首轮因此 interrupted 且无报告；保持断言失败，修正专用验收指令明确允许该只读检查，不修改产品审批行为。

## T13 独立评审整改检查点

R26–R28 已落实：精确范围、严格报告终态、搬移后凭据归属。Node scope 3/3、Bun 验收边界 3/3（25 expects）、类型/文档/流程/diff 通过，实际搬移后故障的两处凭据清理探针通过。没有增加测试框架或新增完整排列；最终冻结后的模型与独立增量复核继续记录。
