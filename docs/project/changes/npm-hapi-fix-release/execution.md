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
