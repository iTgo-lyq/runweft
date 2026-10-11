# 1.1.2 发布执行记录

## Plan 评审

iclaude 在当前工作区完成一次无工具、无持久会话评审：退出0、is_error=false、199881ms。正常路径无硬阻塞。采纳首次远端 CI 事实、tag/main 祖先断言、冻结输入/最终文档路径限制、公开失败停止部署、候选上传前与部分上传恢复区分、长期保存摘要及 npm 包内 Skill 来源。当前 run 预期产物少于30个，不为假设分页问题改工作流；已有专用 HOME/npm配置和原生重启说明继续复用。拒绝把历史数据兼容设为补丁发布门禁：用户已明确首次部署基线和无其他机器部署，旧格式拒绝行为已单独验收，不新增迁移。

## T1 准备版本输入并推送 HAPI

HAPI main 从86c88df9快进到8f774b9413fd483bc163cc06425d7646f10a7c92并正常推送，根gitlink/固定revision一致，CLI仍为0.30.7。未创建HAPI发布tag。根版本和常规README/使用说明为1.1.2，历史离线1.1.0保留。五包1.1.2均404、远端v1.1.2不存在。

类型检查、248项根 ./test（41文件、4798断言、0失败）、33项Node检查、本机build通过，程序报告1.1.2，官网八文件静态校验通过。相比v1.1.1，CI增加按diff普通检查、正式候选一次构建全无模型集成，npm工作流移除分支上传预演、增加Beta通道规则；OIDC绑定文件名/无environment保持一致，首次远端执行在本次tag确认。

- Commit：`npm-hapi-fix-release T1: prepare verified 1.1.2 release inputs`

## T2 可信发布及匿名安装

v1.1.2为annotated tag，固定源码ee66fe08c549908e1a49555c2ec0cc842b63d6c8；push run 38041451856执行了本次新版CI。远端248项根测试、33项Node检查、四平台构建、access/storage/web/service-package全部通过（Linux候选集成09:31:13Z–09:39:41Z）。失败发生在两个upload-artifact步骤：Artifact storage quota has been hit；候选和29份证据未能上传，Mac/arm64安装与publish被跳过。不能把这些未执行步骤记为成功。

公共五包1.1.2不存在，未产生上传或回执，原tag不移动；按用户明确要求先推送Runweft main，生产官网部署仍等待公共包。远端24个历史产物共约1.778GiB，其中四个npm-candidate约477MB/份，24份产物已完整备份并通过ZIP CRC/SHA256核验，索引位于.dev-smoke/npm-hapi-fix-release/artifact-backup/index.json。用户明确批准后，仅删除四份旧候选（11192755285、11189578573、11186938671、11163910053）；20份回执/证据41521字节继续远端保留，npm包未动。清理回执位于artifact-cleanup.json。原run无候选/上传、registry五包均404，清理后恢复原tag完整run，记录新attempt和候选，不移动tag。GitHub额度统计可能6–12小时更新，更新后可按本方案恢复未上传候选。原失败日志保存在.dev-smoke/npm-hapi-fix-release/ci-build.log。

第二次执行仍仅两个upload-artifact步骤失败，四平台构建及四组Linux集成再次通过，其他平台安装/publish仍被跳过；五包latest保持1.1.1、1.1.2均404。清理后GitHub仍报额度不足，当前远端仅20份小产物41521字节。不再立即重建：等待平台额度更新或账号侧调整，按下面条件恢复。程序没有公开发布，T2/T3保持阻塞，Specs不写入1.1.2已发布，Change不归档。

- Commit：`npm-hapi-fix-release T2: preserve quota recovery evidence`

2026-10-11距清理超过24小时，重新fetch确认两个main/固定HAPI及v1.1.2包输入未变，原run无产物、五包1.1.2均不存在，再执行原run attempt3。build job114444727984的类型检查、248项根测试（4801断言、41文件、86.11秒）、33项Node检查、四平台构建和四组Linux集成全部通过；集成10:12:22Z–10:22:04Z。两个upload-artifact步骤仍分别在10:22:04Z/10:22:06Z报Artifact storage quota has been hit；install job114447184896和publish job114447185478被跳过。10:22:44Z公共五包latest=1.1.1、1.1.2均404，远端仍20份41521字节，原run没有任何候选或发布回执。原日志保存在.dev-smoke/npm-hapi-fix-release/ci-build-third.log。

[GitHub计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)区分当前占用和按小时累计的周期用量：删除产物不扣除已累计用量，产物与GitHub Packages共用额度，付款方式或阻断预算也可能限制新增存储。6–12小时仅为统计刷新说明，不能保证删除后恢复。账单API需要现有凭据缺少的user scope，未取得账户累计用量、付款方式或预算明细；这些原因仍属待核查，不能把推断写成已确认根因。等待一天后的实际上传仍失败，恢复前需账户侧确认允许新增Actions产物，不再无条件重复完整构建。

- Commit：`npm-hapi-fix-release T2: record persistent quota failure after daily recheck`

该记录推送b5fed93后，main run38131900480/core job114447777444出现一次准备释放测试失败：247项通过、1项失败，release返回409/preparation_pending。类型检查通过，后续Node/集成未执行；保留首次失败日志.dev-smoke/npm-hapi-fix-release/ci-main-recheck.log，不把它当作额度故障或直接重跑掩盖。

定位到WorkspacePreparations.view会在底层snapshot失败时先返回派生failed，而实际preparation记录下一轮才更新；release检查实际记录。专用现场延后preparation推进、继续snapshot推进，确定复现“view failed/record preparing → release409”；推进记录后释放及source/pin清理成功。只将现有test/remote.test.ts等待条件改为实际preparation记录failed，保留未决和外人保护断言，生产代码与packageInputs未改。修改前该单测本地20次通过，仅有上述真实CI失败，不能声称本地随机复现；定向调度现场为独立因果证据。

修正后该文件11项测试连续20次共220项通过（3720断言、0失败、53.30秒），类型检查通过，完整根测试248项通过（4798断言、41文件、62.41秒）。包输入冻结及Change结构检查通过；再次正常推送测试修正并核查新main CI，正式tag仍为ee66fe08，公开发布继续等待账户额度恢复。

- Commit：`npm-hapi-fix-release T2: wait for completed preparation in release test`

修正提交cfd813b570203ad8b297029d52fe8b6c4950ef9c的main run38132424780/core job114449324442成功：类型、完整根测试、Node和actionlint均通过；仅测试/文档变化，四组生产集成未重复。本提交仅保存该CI结果，T2/T3仍因发布额度阻塞。

- Commit：`npm-hapi-fix-release T2: preserve successful timing-fix CI evidence`

新beta流程run38136994670在上传前停止：类型/248项根测试/42项Node/四平台构建通过，access/storage/web全部成功，service-package的服务检查通过，但verify-packages仍读取控制目录dist/packages/index.json，独立原tag构建实际在.dev-smoke/release-source/dist/packages。日志确认ENOENT，两个包检查尚未执行；OIDC/上传/四平台公共安装/晋级均被跳过。公共五包1.1.2仍不存在，无已上传或未知候选。

在工作流集成步骤显式设置既有RUNWEFT_SMOKE_PACKAGES指向原tag候选目录，并在现有拓扑检查中绑定checkout目录、安装包目录与CLI路径。Node42项、actionlint、冻结包输入及diff检查通过；产品与tag不变。用户已在本机浏览器完成五包dist-tag权限设置，实际OIDC标签操作仍待远端核验。新main完整Development checks run38136970052/core114462725972已通过类型/根/Node/actionlint/构建与全部四组集成，无artifact依赖。

- Commit：`npm-hapi-fix-release T2: point package validation at immutable source output`

目录修正后run38144335853在web组出现独立验收断言失败：推进原生页面时钟后，所有观察标签的/api/auth请求计数9而非8；access/storage成功，service-package和上传未执行。Playwright实现确认Page.clock引用BrowserContext.clock，同一上下文其他标签也受推进影响。原测试把其他标签的认证计入被测原生页，不能证明该页重建身份。

将既有请求观察按Page计数，保留原生JWT重载不延寿、过期清除/跳转及被测页面无新认证断言。专用真实Hub/Runner/Chromium的正常16组检查成功；受控另一标签真实认证复现旧断言退出1（全局8→9，被测4→4），新断言及完整16组检查退出0。类型检查、冻结包输入和Change结构通过。只修正验收计数，产品源码/HAPI/tag不变，未调用模型或修改用户配置；当前五包1.1.2仍未上传。

- Commit：`npm-hapi-fix-release T2: scope native expiry authentication check to its page`

run38145808969的基础/四平台打包/完整Linux集成及OIDC检查成功；五包实际beta上传并全部公开，latest保持1.1.1。Linux x64/arm64公共安装与服务通过；两个macOS平台均在首次Hub start失败，版本/help/MCP目录及配对程序hash已通过，promote被跳过。所有五包完整公开、原候选描述可从成功beta日志取得，因此后续使用source-run-id=38145808969恢复原包，不重新构建或上传。

失败服务日志未进入原CI报告，暂不能定位Mac启动根因。增加专用smoke-service失败报告中的service.log/hapi-hub.log尾部，先读取现场身份/机器/HAPI凭据并脱敏，再限制每份8192字符；不收集模型日志。受控本地检查保留两份启动诊断、遮盖六种凭据、保留原异常并限制长度；Node语法、冻结包输入与Change结构检查通过。修正只增验收诊断，继续以原公共候选验证，尚不声称Mac问题已解决。

- Commit：`npm-hapi-fix-release T2: retain sanitized installed service startup diagnostics`

恢复run38147983143在prepare读取原beta job日志时被新版gh的终端转义字符过滤拒绝，矩阵与晋级未执行。改用GitHub REST的302日志下载接口：凭据只发给api.github.com，签名下载不携带授权；日志仅作为原描述解析输入，不打印完整日志或签名URL。带ANSI的受控日志验证原候选解析、授权隔离与403明确拒绝；43项Node检查通过。真实原run日志恢复在本机成功，选择existing并核验五包公开摘要，未构建或上传。仍需四平台原包验收，不将恢复成功记为Mac服务成功。

- Commit：`npm-hapi-fix-release T2: recover source logs through the GitHub REST download`

REST恢复run38148688849读取原描述并核验公共五包成功，跳过构建和上传。四平台实际原包重验仍为Linux两平台成功、Mac两平台失败、晋级跳过。Mac脱敏日志证实HAPI Hub ready且health=200，随后Runweft报unable to open database file并关闭HAPI；不是原生工具路径或npm权限错误。增加两个Mac原生SQLite诊断job定位创建/重开/只读验证；首次run38148938055因诊断checkout未带HAPI shared源码提前失败，补齐固定submodule后再执行。该诊断不上传npm或推进标签。

- Commit：`npm-hapi-fix-release T2: diagnose database creation on native macOS`
- Commit：`npm-hapi-fix-release T2: include pinned HAPI types in native diagnosis`

实际发布run38149709526使用v1.1.3固定源码dab91e089c63a64a4d275a81b7b793354d86200b和固定HAPI8f774b94；四平台构建及完整Linux集成通过后，五包以beta上传。Linux x64/arm64、macOS x64/arm64四个托管job从公共npm读取精确1.1.3、核验摘要并安装，配对程序/MCP目录/无Bun服务/信号/重装/缺依赖/卸载保留均成功。晋级job实际OIDC更新五包latest，平台先、主包后；用户配置的dist-tag权限由本次真实写入确认。发布与安装均无artifact。

匿名实际下载全部五包并核验SHA-512、manifest/HAPI与原日志描述一致，latest/beta均为1.1.3。Linux x64专用HOME/prefix/cache从网站DOM执行npm安装，Playwright三页/320–1440px/复制与失败/无JS/子路径通过；配对程序hash、六Skill文件和两份README逐字匹配冻结候选。1.1.3候选的249项根测试、43项Node与类型检查及四组Linux集成通过；本机同候选版本构建和两Mac原生数据库8项回归通过。完整记录见verification.json；本次未调用模型或物理跨机验收。

- Commit：`npm-hapi-fix-release T2: verify public beta installs and latest promotion`

首次本机DOM复验误读未重建的dist/website（1.1.2）；额外程序hash核对明确拒绝，未记作1.1.3验收。重新build1.1.3并核验八文件摘要后，独立DOM场景website-roIFKN安装实际1.1.3成功，配对程序/Skill/README匹配候选。验证记录保留版本误配与纠正结果。

## T3 推送 Runweft main 与官网验收

首轮发布失败仅为产物上传额度，产品和Linux全部集成已通过。Runweft main=7b7b17c7d0ff80ad88cfd28266e8078ae1e517d4已正常推送，远端/本地一致，v1.1.2为main祖先。Development checks run38042661930的类型/根/Node/actionlint/构建及全部选中集成通过，仅上传24份验收产物因额度失败；Pages run38042661938因npm版本404和产物额度失败，未运行生产上传。生产域名release.json本轮普通和直连读取均被403拒绝，当前在线版本未确认；历史最后验证为1.1.1，不将它记作本轮在线成功。T3的部署/整体验收尚未完成。

- Commit：`npm-hapi-fix-release T3: record main CI and pending production deployment`

本次复查确认main=c306d0d535ce5e5aaee95e02c64123b97499deaa与远端一致，Development checks run38043993010成功。它是项目记录改动的核心检查，不重跑四组Linux集成；完整候选集成证据来自上述tag attempt3。1.1.2仍未公开，本次没有触发生产官网部署或匿名安装，T3继续阻塞。

## T4 同步 Specs 并归档

待执行。

## 恢复入口

用户已授权替换artifact发布路径。旧run38041451856不再重跑；更新流程经本地验证推送main后，以显式release-tag=v1.1.2恢复原tag。五包beta/四平台公共安装/晋级通过后，从最新main运行官网。需要修正工作流恢复已全部公开版本时，提供source-run-id读取原日志描述；部分公开或未知上传停止，不重建重发。

## T5 改造beta验收及latest晋级

更新Plan在当前工作区完成一次iclaude无工具/无持久会话评审（退出0、is_error=false、293001ms）。采纳控制提交测试/原tag打包、固定包输入/工具链/gitlink、beta与latest不倒退、官网五包latest门禁、矩阵结果门禁、原日志描述和main显式source-run-id恢复、幂等部分晋级及权限报错。拒绝将Cloudflare直接上传误认为GitHub Pages artifact部署，拒绝未知上传自动重试，私有仓库无provenance不作为恢复前提。

发布/安装/核心/官网四个工作流已取消全部artifact步骤。构建与beta上传同job；四平台从公共npm校验tarball并安装精确版本，全部成功后平台先、主包后晋级latest。main显式release-tag可构建不可变原tag；source-run-id/原attempt日志支持完整已公开候选恢复，partial/未知上传停止。旧直接latest的CLI入口移除；官网要求五包latest等于站点版本。

验证：类型检查通过；根248项/0失败/4799断言/41文件/62.42s；Node42项/0失败；actionlint通过；v1.1.2 packageInputs冻结、Change结构及diff检查通过。显式main恢复入口在本机解析tag/source为ee66fe08、当前五包1.1.2不存在并选择build，未上传。

等价真实公共安装：从原1.1.1候选恢复五包manifest/摘要，匿名核验全部五包，实际下载主包与Linux x64 tarball并验SHA-512，再从公共npm安装到专用prefix/cache。程序/HAPI hash与原候选一致，MCP目录、无Bun服务/信号、身份/机器配置、重装、缺依赖诊断与卸载/数据保留均通过。证据为.dev-smoke/npm-hapi-fix-release/public-install/install-wBNjrR/evidence.json；这是1.1.1的新链路等价验证，不能替代1.1.2或Mac/arm64验收。

- Commit：`npm-hapi-fix-release T5: validate beta packages before promoting latest without artifacts`

公开1.1.2尚未上传；接下来推送main并启动新dispatch，T2的真实beta/四平台/latest与T3官网结果另行记录。

## T6 修复原生macOS数据库校验并准备新补丁

原生诊断run38149037317的Mac arm64确认磁盘/内存创建及普通只读拷贝均成功，source openState成功后validateState在PRAGMA user_version查询抛SQLITE_CANTOPEN/errno14；无需改动新建方式。进一步在私有副本比较只读/读写并增加新鲜空WAL保留骨干回归。已公开1.1.2不能覆盖，下一候选为1.1.3；数据库schema19/client1/config1不变。

- Commit：`npm-hapi-fix-release T6: reproduce validation of empty WAL on macOS`

run38149256050的两个Mac均确定复现：新建并关闭的数据库处于WAL模式，原目录仅state.sqlite、无WAL/SHM；同一主文件的只读副本PRAGMA查询SQLITE_CANTOPEN/14，读写副本返回schema19。新增骨干回归两平台均失败，其余7项成功；Linux原实现8项均通过。修正只将私有验证副本用readwrite/create:false打开，允许SQLite在临时副本目录创建边文件，原数据不写入；本机8项与类型检查通过。1.1.3五包和tag均不存在，README/usage/package版本更新，下一步验证新源码与原生Mac回归。

修正后完整249项根测试/0失败/4801断言/41文件/62.68秒、类型、43项Node和本机build通过，编译程序报告1.1.3。新建策略和数据库结构不改，未知/损坏原目录拒绝和字节保留、并发新建与CLI入口骨干继续通过。尚待两Mac原生修正回归，不把Linux结果代替Mac。

- Commit：`npm-hapi-fix-release T6: validate private WAL copies across platforms for 1.1.3`

修正源码de14c0a的原生run38149534513，两Mac均确认source validateState成功，各8项回归/0失败/93断言，覆盖新鲜无边文件WAL、Hub/client格式、原目录字节保留、旧/损坏拒绝、并发新建和CLI入口。临时state-diagnosis.yml删除；长期骨干保留在test/state.test.ts，正式四平台公共安装仍由T2执行。1.1.3五包和tag尚不存在，固定HAPI/工具链不改。

- Commit：`npm-hapi-fix-release T6: complete native database validation and freeze 1.1.3`
