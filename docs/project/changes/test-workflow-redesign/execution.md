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
