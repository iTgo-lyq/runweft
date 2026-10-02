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

## T4 原生骨干实现与冻结

- 结果：新增固定六链/按runtime控制和重建入口；expanded按明确触发扩到12组合。成功case连同消费者清理结果复用，源码helper/候选/原生配置指纹变化拒绝复用；逐阶段保存日志与证据，无整组自动重试。65秒等待只指定两个宿主代表。递归CLI拒绝进入所有主链，N4补双轮输入输出，远端保留真实MCP取回并把状态轮询交给控制器。shared原生历史消费者读取现行collaboration证据，不接受旧格式。
- 收敛：删除16个重复/孤立脚本和2个专用helper，合并开发入口至7个test命令；精确替代见Research。保留低层execution专项的独立shared sibling边界。产品源码、HAPI pin与源码未改。
- 验证：typecheck/diff/文档校验通过；fixture/lifecycle 5 pass、29断言；存储夹具实际通过公共读取及同一消费者DB校验，错owner拒绝且native调用0。最终native-backbone-IpDeyv为preflight-only成功，真实编译local/hub配置、专用原生MCP配置和零会话库存均检查；未调用模型。
- 已拦截问题：首个本地模式preflight因缺hub.url在machine enroll前失败，修复为显式连接本机Hub后通过；没有把hub目录标签冒充local验证。另修复watchdog诊断覆盖case.host字段的问题。完整日志与前置结果位于 `.dev-smoke/test-backbone-plan/`。
- 边界：真实模型及新历史消费者行为尚待T4V，不声明原生替代全部通过。拆分冻结与真实验收为两个任务，防止把未来验证写入当前提交。
- Commit：`test-backbone-slimming T4: freeze native backbone and per-case evidence`

## T4V 原生验收（进行中）

- 干净候选：`6a7e559`、版本1.1.1、HAPI pin不变；四平台 `package --all --reuse-hapi` 通过。service-package四脚本通过，真实registry安装候选见 install-Cyo3do；本地Chromium1243实际启动。
- 初次N1：native-backbone-P97jP0 / collaboration-dz8oeB / shared-package-hrdPxT通过，包含真实local Codex→Codex两轮、65秒wait、子CLI拒绝、历史网页、重启无重放和清理。注入N2 producer前失败时，QEUI3S实际复用N1且未调用N2模型，退出1符合预期。
- 初次N2：S5Kht4 / collaboration-OZ5Qya失败，已停止自建进程、cleanupErrors=[]。子CLI探针已写入两个subagent_delegation_denied证明且退出0，但无stdout；Claude为了确认探针结果读取helper，超出宿主当时的验收白名单，宿主按指令停止，尚未send_input。不是服务商失败或产品权限错误，不盲目重发已接受任务。
- 修正：helper输出明确成功标记；任务说明控制器负责证明检查，避免额外读取；只读专用helper/proof精确路径进入验收白名单。产品源码和二进制不变。因共享脚本变化，原N1保留为历史事实但不作为最终指纹下通过，不复用旧ledger；新现场重新验收。

## T5 CI选择与发行入口

- 结果：新增普通提交核心/相关Linux集成工作流；固定路径规则只选择受影响组，未知产品/构建路径和新分支默认全组，Git差异读取失败直接失败。同仓codex PR复用push检查。四平台候选仅tag/手动触发，完整根/Node/四组无模型gate不按差异跳过；npm同run等待四平台安装，手动只预演。开发说明改为当前四组、六链/专项与按case恢复入口，移除已删命令引用。
- 交叉变更：从已完成Beta工作区提交 `b698609` 核对并吸收发布通道、回执恢复、同版本完整性和官网Beta保护；保留本分支已删除reset/旧格式验收的决定。发布测试转换为Node原生assert并移到scripts/tests（17项，含Beta新增9项），不再同时用Bun重复跑同一文件。网站14项与路径选择2项独立。
- 验证：Node三文件33 pass/0 fail；typecheck通过；actionlint1.7.12通过；官网稳定源码实际构建通过；当前包输入与6a7e559冻结候选无差异。使用CI相同固定版本在专用prefix实际安装Codex/Claude并运行version，不读取模型认证。没有推送或远端CI结果。
- 前置发现：初次Node运行暴露原Bun import不兼容，转换后又由负例发现not.toMatch转换反向错误，均修正后通过。实际安装暴露Claude在ignore-scripts下只有占位入口，改为显式运行已检查的包内install.cjs并检查两个version后通过；Beta候选不运行stable-only网站构建，网站单独做版本资格判断。以上均在本地、零模型阶段发现，未伪称CI成功。
- Commit：`test-backbone-slimming T5: select local checks and build one release candidate`

### T4V N2消费者修正

N2在a610dfd脚本下已完成两轮、65秒wait及17次MCP调用。其消费者首试ImyBKb失败：历史读取错误地取中心serverPaths.identityConnection，Hub客户端实际身份在本case的Runner连接目录；local模式恰好同home所以初次N1未暴露。修正为按case.clientHome找到真实Runner路径，N2只重跑无模型shared消费者，不重新调用模型，原首次失败保留。消费者在未启动源进程就失败时，原清理代码把“尚未启动”标为停机不确定；改为实际检查所有源home状态及原生PID后判定安全。生产者和包输入均未变化，本次只重验受影响消费阶段，不把全局helper hash拒绝复用误当必须重跑模型。N2的producer/consumer分阶段证据在最终验收表单列，不改写失败ledger。

### T5补充：核心CI原生配置保障

核对根测试发现两个MCP配置用例会在缺Codex时跳过。普通CI先安装已验证的固定Codex工具，候选CI把工具准备前置到根测试，保留真实原生配置编辑保障。普通核心与相关集成合并在同一job，复用checkout、依赖和工具，不再在第二job重复安装；Claude仅在需要集成时准备。actionlint通过；远端执行仍未验证。

## T6 核心稳定性（其他验收继续）

根测试在三个新临时现场串行执行：247 pass/0 fail/4779断言/41文件，墙钟57.789、57.882、57.355秒，含每次真实fixture/lifecycle闭环，没有自动重试。三次与独立N3原生现场运行重叠（目录/端口/配置隔离），故只用作本轮稳定性样本，不作为无干扰性能对比；Technical已据实际安排明确该限制，避免为凑速度样本再重复三遍。相比基线255项，8个原npm用例迁移至Node，实际删/合并3个浅层测试、新增3个有故障价值的fixture测试；Beta另新增9个发布用例，不能把迁移当删除收益。

### T4V N5证据出口修正

N5的producer remote-mcp-R2VNPG与consumer remote-package-xfUR6U均退出0，success=true、cleanupErrors=[]，成果/留存/工作区清理完成且源consumed=true；总入口因只识别Evidence/Installed workspace前缀，漏读remote消费者的Installed remote-task前缀而退出1。归类为汇总接线失败，原ledger保留失败，不把它伪称首跑gate成功，也不为读取证据路径重跑模型。统一三个消费者为唯一Evidence出口，入口不保留旧前缀兼容。新增实际执行三个消费者缺失handoff的零模型用例，核对非零退出、失败证据可读与清理；6项fixture/lifecycle共47断言通过，typecheck通过。后续N6实际验证正常remote出口。

### T4V 重建专项选择纠偏

R-codex首试reconstruction-R1udSK在首轮成功、切换空原生home后失败：单runtime入口仍断言双runtime的2/4会话数量。改为严格比较实际case各轮sessionId集合；原生配置home的校验/清凭据仍覆盖两份实际创建的副本，不能随runtime筛选漏掉另一份。首轮成功且数据库证明第二轮未被接受，原生历史hash、进程退出与源配置均可核对，沿脚本已有显式恢复入口只继续第二轮，不重放首轮。首次完整失败快照另存test-backbone-plan/R-codex-first-failure.json，原ledger不改成功。typecheck通过；后续实际结果另记。

### T4V完成

- 六主链：最终N1 ivmonJ、N3 PKT4QY、N4 Iw79ls、N6 oRQ53h均完整gate通过；N2复用实际成功的O1jQvU生产结果，修正后的RLcBaa消费者通过并清理；N5实际生产/消费均成功，外层路径汇总错误由零模型契约与N6正常remote出口验证修正，没有再跑模型。原失败ledger保持失败。
- 专项：C-codex ZBHHv2、C-claude anzRhp、R-claude XLLNp0完整通过；R-codex沿已验证的首轮保留窗口继续第二轮，reconstruction-R1udSK最终通过，首次失败完整快照保留。原生JSONL确证一次新输入携带重建记忆，原历史hash不变。没有继续已接受但结果未知的任务。
- 清理：成功collaboration ownedRoot均删除；控制专项只留evidence.json；失败N2原现场已在核对所有home停机/PID消失后删除，记录t4v-failed-fixture-cleanup.json。源原生配置摘要每次核对未变。
- 并行：前四链证明独立home/端口/配置和清理后，N5/N6与独立控制/重建最多并发两条；未共享可变现场。N1最后使用最新实际生产者/历史helper完成，没有沿用失效首跑。
- 冻结：产品源码及HAPI未改；候选仍为6a7e559、source.dirty=false，测试/helper改动由各次验收提交单独绑定。脚本变化按实际生产、消费或专项依赖判定，只重验受影响阶段；不同指纹ledger不伪造为自动复用成功。

### T6完成

最终完整根测试248 pass/0 fail、4799断言、41文件，独立墙钟57.652秒；新增消费者出口回归此前在多个新现场preflight通过。最终typecheck/actionlint通过，当前候选arm64 QEMU基础检查通过。验收与verification记录七成首次完整gate通过、四次意外原生失败、分阶段修正与全部可计时尝试，未声称模型请求/token总量或显著根测试提速。packageInputs与冻结候选一致，src/HAPI无差异。成功preflight额外删除自有空目录，零模型实跑通过；此前15个空目录及首个失败preflight的专用现场已核对停机后清理完成，不因此重跑原生模型。根测试和CI专用工具无新增现场残留，失败N2清理有独立证明。

本地验收由主agent按既有授权完成；无需新的人工确认。无远端CI、expanded、Mac/arm64原生模型、物理跨机、发布或部署结果。随后同步当前验收/CI选择及命令引用Specs，归档完整Change。
- Commit：`test-backbone-slimming T6: verify reliability costs and owned fixture cleanup`。

T5最终依赖复核：非页面Hub后端（包括委派、资源和仓库）也影响storage/service，普通CI改为保守全选四组，避免只选access/web漏掉直接消费者；代表路径加入既有选择用例。最终33项Node检查通过，未改包输入或原生fixture。
