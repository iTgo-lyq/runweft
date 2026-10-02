# Runweft 模块瘦身实施计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 状态：执行中
> 规模：大型
> 执行模式：实施 subagent 自检与记录，主 agent 逐任务复核、验收和提交
> 确认依据：用户已授权方案/Plan 工程决策和自动验收；无重复用户门禁。

## 交付目标

保留全部现行产品接口、能力与权限边界，减少过期接线和明确重复实现，验收入口继续真实覆盖原有效行为。主 agent 冻结现行 CLI/MCP 接口（仅移除data/reset树；脚本另允许删除历史专属smoke-upgrade.ts）；实施每任务对照，不恢复已下线接口。

## 执行约束

同一工作区按依赖顺序执行，每任务下发后才实施；阶段方案评审不是用户批准门禁。每项删除/合并在 execution 写原保障、替代测试、命令结果及删除条件。没有等价保障就保留旧实现到迁移完成。根历史 265 pass 是审计基线，不预设必须保持计数。S/U处理见 Technical；排除候选同样需写依据。

主 agent 已提供固定 HAPI checkout、专用目录依赖和核对 SHA 的四平台缓存/manifest；不安装依赖或重建HAPI。不修改版本/lock/其他发行 Change，不npm上传或部署官网。真实验收使用专用 home；恢复现场不被通用清理扫除。

## 任务

### T1 中心 fixture 脱离旧服务

- 状态：已完成
- 交付：S01/S06；提取 native fake，中心 delegation/resources fixture 直接组装当前 gateway，fault hooks、HTTP 和独立 root 保留。
- 依赖：无。
- 验收：中心 fixture 不调用旧 handler、不启动旧协调器，实际中心 HTTP 请求与原故障开关可达；root/进程/DB 独立且构造失败可清理。
- 验证：hub-delegation、hub-consumers、hub-delegation-native、hub.test 和 hub 领域测试；构造/关闭失败验证无残留。

### T2 任务接受、轮次与查询保障迁中心

- 状态：已完成
- 交付：tasks、task-rounds、tasks-overview、tasks-mcp；迁固定回执、unknown、不重放、审批、等待取消/断联、只读分页、千任务边界；本任务迁接线并窄修复中心overview原3秒库存截止缺口（组合请求signal，撤权/断联不降级成功），格式仍schema18；迁移用例与旧字段回退留到T14统一删除。
- 依赖：T1。
- 验收：原任务/轮次/MCP有效断言均在中心接线执行；取消/EOF不停止已接受工作，格式相关保障迁到直接openState测试，不提前删除；查询纯读和有界页保持。
- 验证：对应五组测试及 hub-delegation；原有效断言逐项可追溯，compiled consumers 身份隔离通过。

### T3 工作区与输入输出保障迁中心

- 状态：已完成
- 交付：task-workspaces、task-files、task-outputs、artifact-mcp；保留 seal/准备/停止证明、输入 pin、capture/deliver 丢回执、路径限制、retry/collect、取消清理和重启；窄修当前worktree指纹的baseRef键序，使本机省略/显式HEAD在spawn及lookup等价，不改远端显式基线要求或旧hash兼容。
- 依赖：T2。
- 验收：工作区/文件唯一故障窗口与两runtime原断言保留；上传路径/符号链接限制、固定候选重试、停止证明及删除续轮互斥通过。
- 验证：对应测试及 hub-delegation-native grants、workspaces；两 runtime 和删除/续轮互斥仍执行。

### T4 远端与代码成果保障迁中心

- 状态：已完成
- 交付：remote、remote-tasks、task-results、result-retention；保留固定基线、Git seal、部分发布、fetch/release/restart；旧 resources/agents 的有效 preflight、错误传播与 launch mapping 迁入当前测试。
- 依赖：T3。
- 验收：远端/成果故障与留存恢复通过；旧资源/Agent有效断言有明确替代，原生映射、preflight与错误不重放未丢，不清理旧表/文件。
- 验证：对应测试、hub-agent-resolution、hub-resources、execution；schema18格式原行为保持至T14及错误 code/status/hint 等价。

### T5 无模型 smoke 与临时环境收敛

- 状态：已完成
- 交付：S02/S06/S07/U03；建立旧脚本场景→现行入口映射，迁配置/服务/资源/连接/升级；窄 Hub 启退 helper；删除smoke-upgrade.ts（当前无test:upgrade脚本名）历史升级回滚入口；保留当前安装/服务版本不一致诊断与同格式重启保障。
- 依赖：T1。
- 验收：所涉test:*真实到达中心场景并保留参数；scripts/smoke-upgrade.ts（当前无test:upgrade脚本名）历史迁移/回滚专属入口删除；独立当前服务版本诊断与重启保障已迁现行服务/安装测试；启动/退出失败仍报告失败且无进程/秘密副本残留。
- 验证：实际运行涉及 test:*；模拟构造/关闭失败，证据明确失败且无遗留；专用 home 清理不损恢复证据。

### T6 工作区附件成果与原生 smoke 迁移

- 状态：已完成
- 交付：S02/U06；迁所有旧 agent init/client 流程到当前中心，保留原 test:* 名称/argv 和独有恢复/留存场景；十二 native MCP、十 consumers 不预设缩减。
- 依赖：T4、T5。
- 批次A窄产品修复：正常整体Socket停服使用transport关闭，让现有Runner自动重连；权限撤销/旋转仍显式断开。根测试保护重启/不重放/旧凭据拒绝，真实诊断保留正常Hub重启+存活Runner窗口；build后重跑相关compiled场景。
- 验收：全部旧smoke场景映射有可执行替代，原test:*名称/argv保留；迁移原生/留存/重建场景已实际执行，十二/十组契约未减少，缺口明确列出。
- 验证：逐场景运行真实 HAPI/Runner/原生模型与安装场景；记录 binary/hash、清理；实际远端缺口单列，不用转发空操作通过。

### T7 当前浏览器与 CLI open 保障接替旧看板

- 状态：已完成
- 交付：S05/S12；open 移入 service-commands，转义/迟到请求/状态可读性迁 console；短 JWT、无 URL token、存储清理/轮换拒绝纳入必跑 Playwright；`test:dashboard` 保留名称与参数并转到当前 console 的真实等价浏览器场景，`dashboard-browser` 的有效断言迁入后才退役；只有现有根测试实际行为保障保持CI覆盖时删除源码拼写断言；否则排除S12。
- 依赖：T2、T5。
- 验收：open有效断言迁移且执行；旧UI有效竞态/转义得到当前浏览器保障；短JWT请求/无URLtoken/存储清理/轮换拒绝在根测试/现有CI自动层级继续保障后才删拼写断言，否则保留。
- 验证：hub-console/service-commands 根测试及当前 console/native Playwright 实际请求断言；记录根静态到必跑浏览器层级变化。

### T8 共享依赖迁移并退役旧消费入口

- 状态：待开始
- 交付：S03/U05；搬 contentVersion、共享 Agent/Preparation 类型；Hub MCP context 必需；去旧 Task/Preparation/Agent client、bindings/YAML discovery，单继承 TaskOperations 核对后直接收敛。
- 依赖：T2、T3、T4、T6。
- 验收：CLI命令树除已授权移除data/reset外与基线相等，17项MCP工具/schema相等；活跃产品/测试/smoke没有旧构造器消费者，共享hash/schema/types仍被正确使用。
- 验证：typecheck、根测试、build、compiled consumers、MCP 身份/取消/EOF/stdout、无 Hub 拒绝；活跃源码/smoke 不依赖旧构造器。

### T9 退役旧公开路由资源接线及旧看板

- 状态：待开始
- 交付：S04/S05；先移 List/Read/Wait schema 与 CSS declaration，再删旧 handler/resource API/store 接线和旧 UI；协调器/准备服务保留中心 policy；ResourceStore删除前更高schema拒绝用例迁直接openState。
- 依赖：T7、T8。
- 验收：旧handler、namespace资源服务和旧看板无现行调用并退役；CSS/schema共享保留；中心不额外开旧store，现行授权HTTP/实时行为通过；schema切换/旧格式拒绝由后置T14完成，迁移/回退断言在此前继续保留。
- 验证：根三检查、HTTP/Socket/SSE授权、outgoing撤权、schema18原行为保持至T14、服务/upgrade/browser；中心不打开额外旧资源 store。

### T10 收敛纯投影与同层 send 解析

- 状态：待开始
- 交付：S09/S10；detail 局部复用；内部 send 接已解析值，不动原始请求及异步/事务/授权校验；U04仅复查，不强行抽象。
- 依赖：T9。
- 验收：详情字段/别名/分页与原输出相等；非法send在副作用前拒绝，同层重复解析消失但异步撤权/幂等/排他断言保持。
- 验证：rounds/overview/console 字段分页；非法 HTTP send 副作用前拒绝；配置撤权、steer、附件限制与删除续轮互斥。

### T11 文件传输样板及 capture 恢复证据

- 状态：待开始
- 交付：S11/U01；定向复现固定 HAPI capture 中断/丢响应及持久回执，窄 RPC helper 保留错误差异与固定 ID恢复；证据不足或抽象更复杂则明确排除。
- 依赖：T9。
- 验收：RPChelper保留各调用方错误语义及授权client；四家故障测试通过；U01有中断/丢响应/持久回执证据，无充分证据保留原恢复分支。
- 验证：files/outputs/remote/results 与 grants 故障测试；operationId 不一致/离线原错误；不重读capture，不合并恢复策略。

### T12 编译测试产物生命周期与构建审查

- 状态：待开始
- 交付：S06/S08/U02；config/cli/resource-commands/website-build/release-inputs/release-assembly/hub-connect 等普通测试目录登记单一清理所有者，注入清理失败仍尝试后续关闭；小实验确认 Bun hooks 后共享本进程只读 CLI产物，单文件仍独跑；画同 run 构建 DAG并记录排除结论，本轮不改workflow，独立 workflow/package 校验保留。
- 依赖：T8。
- 验收：普通fixture本次新建目录按所有者回收，注入一次清理失败仍关闭其余DB/server并报告失败；根套实际CLI编译次数为1，三文件均可独跑，失败明确传播且退出回收产物；U02同run DAG与采纳/排除理由记录，独立候选校验保留。
- 验证：根套编译一次、三文件独跑、失败明确报错/退出清理；typecheck/test/build及release inputs/assembly/npm-publish/website tests，无上传。

### T14 当前格式唯一支持与旧数据入口移除

- 状态：待开始
- 交付：按data-format-research将state改一次唯一schema19创建/已有同格式验证，不定义两张旧登记表，旧未知损坏格式无写入拒绝；config当前省略版本默认保留、显式非当前版本拒绝，删除Task/Round旧字段回退；移除data reset、scripts/smoke-upgrade.ts（当前无test:upgrade脚本名）、迁移专属测试和活跃smoke/usage/Skill的reset调用。当前库重启及现行任务恢复不变。
- 依赖：T9；旧fixture/store消费者退役后切换唯一格式，不造过渡兼容层。
- 验收：源码无业务数据迁移/版本升级/旧字段fallback/旧数据清理；全新schema19建库与同格式库正常重开；旧18及所有不匹配格式只拒绝；所有不匹配库/配置/记录明确报错，前后bytes/hash/mode/文件集与表行不变；CLI唯一基线例外为data/reset删除，17MCP保持相等。
- 验证：新增当前格式/无写拒绝定向测试，迁移专属测试移除后根typecheck/test/build；service/install/arm64/native-mcp/hub-upgrade相关真实smoke改当前格式与专用新home，实际执行由主agent验收；没有reset推荐或旧库清理副作用。

### T13 同候选整体验收与事实同步

- 状态：待开始
- 交付：主 agent 对全部改动review与本地自动验收；汇总 S/U采纳/排除、原保障替代证据，成功后同步受影响Specs并归档。
- 依赖：T10、T11、T12、T14。
- 验收：主agent完成同候选接口/全部本地组合验收，S/U处理及保障替代可追溯；仅主agent随后同步验证事实并归档，未验证远端范围明确保留。
- 验证：根 typecheck/test/build、现行安装升级/原生十二组/消费者十组/HTTP实时/Playwright/附件Git留存发行组合；远端缺口如实保留。

## 整体验证

T13 仅由主 agent 执行 Specs 同步与归档；实施 subagent 提供证据，不自行关闭 Change。所有实际执行记录注明候选身份；静态/模拟/真实原生/远端分开。测试 fixture、smoke、构建发行、官网和 Skill 的覆盖排除理由逐项回到 coverage 对照。功能、权限、恢复或接口有未解决差异时不宣称完成，不同步未验证 Specs，不归档。


## 修订评审与保障补充

旧Plan iclaude提出B1/B2：T1提供完整createDelegationGateway restart，同statePath、native receipts/sessions/queue/fault跨重启，T2–T4重启不得裸new协调器；T5映射以package全部test:*为输入，含resources旧auth/route、mcp取消与task-retention证据链。T8/T9退出检查没有test:*依赖已删除旧命令/route/非Hub分支。MCP零配置读取旧断言改为不创建home/不写库，当前schema对齐。S12不得降低CI自动保障：仅用现有根测试实际行为保障等价替代；需要新DOM框架/浏览器CI则排除S12保留原断言，真实Playwright仍跑。U02只记录DAG，不修改workflow避免与发行Change重叠。T6按文件Git留存与模型矩阵分批自检，但由同一任务提交前主agent验收；最终候选T13重跑。

T14 开工前先以专用目录实验确定无写入核验与首次建库方式：新DB在同目录临时文件创建并关闭、以不覆盖原子link落位，失败只回收自己的临时文件；已有DB先读取文件头与WAL存在状态，禁止未经核验直接readonly打开原文件（SQLite可产生SHM）。旧格式/损坏结构验证采用不写原文件的读取或专用副本，具体方式由实验决定；拒绝主DB及已有WAL/SHM字节/mode/文件集不变，不事后放宽。当前结构核验包括表、索引/UNIQUE/FK，不能仅比版本或列名。

文件不匹配使用稳定state_format_unsupported错误，损坏用state_format_invalid；503，提示使用独立新--home启动并自行保管原目录，程序不迁移/改写/清理，不推荐reset。schema19库内非法Task/Round按state_record_invalid拒绝该任务read/wait，恢复扫描不写/不恢复该项，stderr只报task ID与错误码，其他有效任务恢复；这是错误隔离，不是旧记录兼容。Task写入原JSON断言version=2与round.agent，无补字段。

test:hub-upgrade两场景：现有schema18专用基线交候选明确无写拒绝；候选新schema19数据交同候选停服重启，身份/机器/Agent/仓库/附件/worktree保持，不声称不存在的schema19旧版升级。重启复用T1完整gateway restart。

T6批次C逐家验收tasks/controls/task-mcp/task-inputs/task-outputs及其唯一retention consumer。六高层场景必须compiled真实coordinator，不用领域seed替代；空non-Git项目在本次tmpRoot/.dev-smoke下核验后独立回收。producer关闭模型并清认证副本，当前数据/连接handoff到retention；最终consumer实查所有原释放/历史/Git/物理spool保障后回收本次环境，仅留两家证据。六入口argv/HOST/--shared-only保持，默认inputs八轮、outputs八轮，不缩矩阵。
