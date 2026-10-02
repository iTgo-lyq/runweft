# 模块瘦身验收

状态：主agent验收通过。T1–T14已完成；依用户及AGENTS.md持续授权自动完成本地验收，随后同步Specs并归档。逐次失败与实际证据保留，不将未执行平台算作通过。

## 范围与候选

[覆盖表](coverage.md)记录首次审计的49模块组、274个范围文件；[研究](research.md)保存按收益/风险排序的12项候选及6项疑点、具体位置和删除前置。[执行记录](execution.md)记录后续实施和失败修正，不将历史审计建议当作最终事实。

四平台npm包从干净提交 `e3553755c321c4e7981185ba5aa9bf3308544605` 构建，package版本1.1.1、Bun1.4.2、固定HAPI `3ac8b08b2aead13e9eaae459de62d9a5d5df7395` / 0.30.7。Linux x64安装core SHA256为 `09bf189c4a0115b9f1badbf5991cb86d6665b6f42b7b22ca93468dc309e29ba3`，HAPI为 `bdf706d7966ae4818b09029991a2bb03e70b10b0555763fc41430afd977b4fec`。后续fixture修正不改变npm包输入；包核验和安装证据分别为P1ol3Q、rM9h2z，完整索引在本地 `.dev-smoke/slimming-acceptance/t13-index.json`。未发布、推送或部署。

相对实施起点 `bcd2669`，产品源码净减少1271行，测试净减少116行，验收脚本净增加1005行；脚本增加主要用于把原有保障迁到当前Hub及补齐真实消费/清理。行数仅作复核事实，没有删除比例目标，也不以测试数减少代替行为保障。

## 候选最终处理

| 项 | 处理与当前实现 | 保障/理由 |
| --- | --- | --- |
| S01 | 中心fixture不再依赖旧handler/资源store；任务家族改接完整gateway | 真实关闭/重建gateway及跨重启故障事实；T1–T4 |
| S02 | 过期smoke迁到当前身份/空间/Agent入口；合法脚本名与argv保留 | 全入口映射见[smoke覆盖](smoke-coverage.md)；原native/Git/文件/恢复保障继续实际执行 |
| S03 | 删除旧YAML Agent/bindings/客户端及MCP非Hub路径 | 当前CLI与MCP必连Hub；共享类型/hash保留；T8 |
| S04 | 删除旧公开handler、资源服务和协调器仅旧入口所需分支 | 现行policy、lease、事务和并发重查保留；T9 |
| S05 | 删除旧看板；open用例迁service-commands，浏览器行为迁当前console | 17项真实DOM、身份/空间/短JWT、迟到响应和历史消费；T7/T9 |
| S06 | 单测目录显式登记所有者；关闭故障仍尝试其余资源 | 两实际DB/server关闭故障测试；全套与单文件结束后新增残留目录0；T12 |
| S07 | 窄进程启退/秘密清理helper与现行Hub配置smoke复用 | 业务断言仍由各脚本负责；失败聚合，已取得资源立即登记；T5–T7 |
| S08 | 三家编译测试共用本进程一次只读CLI；全局afterAll回收 | 实测全套编译1次，三家独跑各1次；编译失败同一Promise传播且临时root回收；T12 |
| S09 | detail复用同次overview纯投影 | 16K报告分页、结构化上限、别名和私有字段剔除保持；T10 |
| S10 | Hub send只在原始请求边界解析一次 | 非法HTTP无持久/原生副作用；异步Agent变化重查仍拒绝；T10 |
| S11 | 四家文件RPC复用POST和operationId核对 | 各自错误契约、权限client与固定回执恢复保留；错ID故障阻止模型启动；T11 |
| S12 | 排除，不删现有安全字符串断言 | 当前CI缺少必跑DOM等价层；为删断言引入新框架不合本次目标 |
| T14新增约束 | 唯一Hub schema19/client schema1，Task/Round当前格式；移除升级、补旧字段、data/reset和专属迁移脚本 | 新建/同格式重开；旧、未知、结构损坏只报错，原主库/WAL/SHM/权限/文件集不变；不清旧数据 |

## 疑点结论

| 项 | 结论 |
| --- | --- |
| U01 capture unknown重试 | 保留。固定HAPI实际丢JSON/SIGKILL和持久回执实验支持恢复职责；共享路径也承担deliver恢复，未证实可删。 |
| U02 构建CI重复 | 排除。独立构建入口、平台安装和候选核验处于不同边界；[构建DAG](build-review.md)说明依据，workflow不变。 |
| U03 native临时环境 | 明确producer/consumer所有者、记录实际home/进程与候选；仅确认本次进程停止后回收本次现场，失败保留诊断并清可安全移除的凭据副本。 |
| U04 Round/retention抽象 | 排除。初次/续轮绑定和两种留存的pin/discard/revision不同；没有默认漂移证据，不造通用状态机。 |
| U05 包装与错误合并 | 仅将单继承TaskOperations并入HubTaskClient；保留不同错误、取消、认证及冻结请求比较语义。 |
| U06 模型组合重复 | 保留十二组native MCP、十组consumers及现行矩阵；宿主/runtime/模式/故障边界未证明等价。 |

## 测试删除与接替

| 删除/合并 | 继续保障 |
| --- | --- |
| agents、agent-targets旧YAML/绑定专属测试 | hub-agents/resolution/resources覆盖当前定义、CAS、不回退、快照/异步权限；execution保留launch defaults、原生参数与错误不重放 |
| resources旧namespace CRUD与local-only专属行为 | hub-resources/resource-cli/dispatch及真实resources smoke保留当前CRUD、版本探测、单机错误、取消恢复、撤权与45秒离线 |
| tasks-mcp重复壳 | compiled hub-consumers与保留tasks-mcp精确审批/取消/EOF/修复/续轮；MCP身份由mcp测试独立保障 |
| dashboard旧登录和展示壳 | hub-console根静态HTTP/权限和真实Playwright转义、分页、报告、刷新失败、迟到响应；open完整用例迁service-commands |
| schema升级和reset专属测试 | 按用户约束删除；state/task-records改验唯一格式、无写拒绝、非法单任务隔离及有效任务恢复，不保留迁移功能 |
| 三份CLI构建beforeAll与未登记目录 | 合并产物，保留各自隔离home与身份、真实子进程、stdio/CAS/0600；fixture-cleanup及编译故障探针覆盖释放 |
| 任务、轮次、worktree、input/output、remote、result行为家族 | 保留独有故障/恢复断言，仅换当前入口和fixture；不是按测试数量去重 |

## 已确认的执行证据

- 根最终产品源码：typecheck、build通过；`bun run test`为255 pass、0 fail、4811 expect、42文件（T12，之后产品源码未改）。T13验收fixture窄修后typecheck、真实17项console、双runtime四轮inputs再次通过。
- 完整CLI/17MCP契约对照：除授权移除data树外，参数、描述、schema和annotations与审计基线一致。
- 同候选四平台打包与包核验、Linux x64安装/更新/卸载及原配置保留、QEMU arm64命令验证通过。
- 同候选consumers十项；console17项、connect5项、realtime10项、resources10项、configuration9项；旧18无写拒绝及当前19重启3项通过。
- 当前源码gateway配同一HAPI/CLI的真实文件/Git/权限场景：artifacts、outputs、prune、repository export/import、workspace preparation、result export/tasks/fetch、hub access/delegation/preparation通过。它们含明确领域或协议fixture，不冒称全部为编译Task协调器端到端。
- 原生十二组8aThG1及其dashboard真实历史消费mouXhR→LPql2C通过，源读取不变、最终24个记录PID退出且本次现场回收。shared协作jHQQOu完整八组合18轮通过。
- Task输入HOnmYf完整八轮通过；修正证据后outputs 9GlRl1→retention c3clY4完整八轮消费通过。控制C2Jap7双runtime七检查通过（显式Codex gpt-6.1-sol/xhigh；Claude claude-opus-5-5/high），原6-astra容量失败3z6Foc单列保留。
- 远端Task rpnTt3双runtime四轮→retention FOasYt、remote-native i0iUno、execution 8LJIuF、底层MCP k06UNt均通过。worktree retry R314V4→安装消费j8O4TV通过。
- worktree协作X3u0lO默认八组合18轮；附件MCP Ny2oOU八组合16轮→安装消费aVEqUa八项均通过。Task CLI 39ptAn四项、双宿主Task MCP zMf5fo四项（实际长wait）、reconstruction bFZDeN两runtime四真实轮/七项均通过。
- worktree-tasks rJND0n两runtime四轮/五项→worktree-lifecycle fsmDNx两runtime全部生命周期检查通过，cleanupErrors=[]。检查真实hook失败后的显式retry-finish、重启原生resume、ignored依赖、无改动不提交、任务工作区隔离、准备期间取消不启动、parent推进不改已接受base、显式discard后checkout移除但报告/ref保留及后续send拒绝。
- 远端MCP remote-mcp-cnexH5默认四组合八轮→remote-package-VgzXdE安装消费完整链通过，cleanupErrors=[]。最终明确Codex gpt-6.1-sol/medium，远端整场预算900秒、再10秒强停，全部业务/审批断言保持；前三次失败未覆盖。

## 本轮失败记录与处理

| 原失败 | 证据与处理 |
| --- | --- |
| native-MCP SM1QaY | Chromium路径错误，模型案例开始前失败；修正调用路径后独立完整12案例8aThG1通过。 |
| console 4xJAw5 / i8UBnx | fixture缺当前Agent快照及跨轮输入；修正fixture，保留产品校验；Est9a8及mouXhR真实17项通过。 |
| outputs 60FNTA后继消费 | 八轮执行成功，producer把npm launcher摘要误记为core；消费者打开数据前正确拒绝。修正证据采集，新八轮9GlRl1→c3clY4通过；原证据未改写。 |
| controls 3z6Foc | Codex首轮明确serverOverloaded，尚无业务控制检查通过。新fixture显式使用可用gpt-6.1-sol，C2Jap7通过；无产品fallback或用户配置改写。 |
| remote C6hU6A | 前三组合通过，第四Claude宿主420秒看门狗结束时第二轮待审批；第一轮有约201秒无宿主工具调用，根因尚不能确定。失败不冒称通过，不消费该证据。第二次Cdedes第二组完成首轮后在看门狗边界结束，缺续轮断言失败；非wait RPC最长0.67秒而宿主工具间隔中位19.4秒。第三次fzpnCz两轮完成后宿主仍在420秒边界终止；实际时间线支持将远端整场预算改为900秒，明确记录超时，MCP和业务断言不变。最终remote-mcp-cnexH5四组合八轮及remote-package-VgzXdE后继消费通过，四case均hostTimedOut=false。 |

失败环境仅清本次已停止进程的精确凭据副本并保留诊断；未扫描或清理任何旧用户数据。完整执行过程及局部修正的候选关系见[Execution](execution.md)。

## 需求验收对应

| 要求 | 验收结果 |
| --- | --- |
| 全模块证据化审计 | 49模块组的基线清单、S01–S12排序及U01–U06待验证项保留；最终278文件重新列账，漏项/重复均0。 |
| 保留现行能力、接口和权限 | 先迁有效测试保障再退役旧实现；同候选CLI/MCP契约、真实原生/浏览器/文件/Git/故障恢复通过。授权删除data/reset是明确例外。 |
| 不迁移、兼容或清理旧数据 | 唯一当前Hub/client格式，新建和同格式重开；旧/未知/损坏无写拒绝，原DB/WAL/SHM与权限/文件集不变；不存在旧数据清理入口。 |
| 不把必要机制当冗余 | 保留信任边界、并发重查、当前恢复和固定回执；S12及U01/U02/U04/U06不满足删除依据的部分明确排除。 |
| 直接执行并验收 | 用户要求停止派生后，主agent完成剩余实现和全部最终验收；逐任务本地提交，不修改其他工作区或发布候选。 |

机器可读证据摘要及原始文件SHA见[verification.json](verification.json)，真实失败、修正和任务提交见[Execution](execution.md)。全部本地必要验收完成；以下平台/网络范围继续明确保留。

## 已知范围限制

未执行Mac实机、arm64模型或物理跨机/WAN；同机独立Runner和QEMU不替代这些实测。固定HAPI对过长Claude cwd的原生历史定位缺口已复现，验收使用专用短路径，没有修改依赖或伪造历史。机器凭据撤销后Runner停机也实测触发HAPI既有一秒退出兜底（exit1）；脚本核验确切日志、进程退出和新凭据重连，未冒称正常优雅停机。没有npm上传、远端CI、官网部署或用户全局配置变更。长期模型配置基线曾在本轮模型测试前出现auth差异，未推断原因或覆盖原文件；各fixture独立校验其开始/结束时的源配置。
