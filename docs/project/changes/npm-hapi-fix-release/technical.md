# 1.1.2 发布技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-10-11

## 发布输入与范围

独立HAPI main已推送8f774b9413fd483bc163cc06425d7646f10a7c92，Runweft main为当前已验收产品及1.1.2输入。v1.1.2不可变，精确commit为ee66fe08c549908e1a49555c2ec0cc842b63d6c8；基线格式、配套HAPI0.30.7与模型/物理跨机范围保持前一Change验收边界。不重复模型调用，不生成离线整包，不修改用户原生配置。

本轮旧artifact上传三次因存储额度失败，均未上传npm。四份旧候选已按授权完整备份并删除；用户明确改造发布以解除artifact依赖，不再等待账户存储额度。历史失败/清理与评审记录保存在execution.md及verification.json。

## 已确认的beta验收与晋级方案

npm-publish.yml保留tag入口；空手动输入只预演，main上的显式release-tag输入可恢复已推送且包输入未改变的tag，本次为v1.1.2。控制工作流使用当前提交；独立checkout原tag精确commit及固定HAPI构建一次，保持原tag不变。当前控制提交与原tag的packageInputs必须相同。

构建与beta上传同一job运行，基础检查和Linux四组集成先通过。五包统一--tag=beta，按四平台先、主包后上传；记录源revision、HAPI、完整manifest、SHA-512和程序SHA-256的紧凑描述，在首个上传前输出到日志，成功后通过job output传给四平台矩阵。禁止输出OIDC/token；不上传候选或回执artifact。

矩阵包含Linux x64/arm64、Mac x64/arm64。各job核验五包公开manifest/完整性，下载主包与本平台tarball并验摘要，然后在专用prefix/cache从公共npm安装精确版本，复用smoke-install的版本、配对程序摘要、MCP目录、服务/信号、重装/卸载保障。每个job输出脱敏验收JSON，矩阵整体success是晋级的前提；不用beta浮动标签下载。

晋级job只接受同一run成功的beta输出和四平台矩阵结果，重新核验五包及其完整性后以OIDC修改dist-tags；平台latest先、主包latest最后。稳定版本晋级latest，原有X.Y.Z-beta.N保持beta不晋级，版本号与标签不混淆。并发发布不取消；禁止倒退标签或改动与候选无关版本。beta公开意味着可显式安装，失败不覆盖同名版本，使用新版本修复。

失败重跑优先复用原成功beta job输出。若beta job本身失败但五包均已公开，读取原attempt日志中的候选描述、逐包核验后恢复，不重新打包；部分公开或上传结果未知直接停止，保留日志并使用新版本处理，禁止盲目重发。无公开版本且上次尚未开始上传可重建。日志不可取得时停止，不猜测候选摘要。

npm CLI固定11.21.0，五包publisher需同时允许npm publish和Allow npm dist-tag；既有上传授权不证明标签授权。不扩展npm token或用户配置。缺权限时完成本地实现/验证并给出五包设置链接、需启用的选项。核心检查与Pages同样取消artifact步骤，脱敏证据输出日志/摘要；网站静态文件按对应commit在本机重建并与部署文件摘要核对。

控制提交执行当前测试，原tag仅构建/打包；源码相等与固定Bun1.4.2/HAPI gitlink在构建前断言。上传检查beta不得倒退，官网公共检查须五包latest等于官网版本。main的显式source-run-id支持用修正后工作流读取旧run日志恢复完整公开候选；验证来源workflow、tag/source与全部摘要，不要求私有仓库不提供的provenance。旧run38041451856仍含原artifact/直接latest工作流，不再重跑。Cloudflare Pages为现有直接上传，与GitHub Pages部署artifact无关；不接受评审提出的GitHub Pages额度前提或未知上传重试建议。

## macOS实际安装缺口与新补丁

完整原包恢复run38148688849确认两Linux安装成功、两Mac启动失败；HAPI Hub ready后Runweft数据库报SQLITE_CANTOPEN。原生诊断run38149037317确认新建数据库成功，随后validateState的私有副本查询失败。原1.1.2不可覆盖；定位并修正副本验证后使用1.1.3和新tag，现有schema19/client1/config1不变。格式校验仍不得修改原数据库、WAL、SHM或身份；旧/未知/损坏格式拒绝行为和并发新建保障继续验证。run38149256050在两Mac均确认WAL模式数据库关闭后只有主文件，私有只读副本查询errno14、读写副本查询schema19成功；新增回归原实现两平台均失败（其余7项通过）。仅将验证副本改为readwrite/create:false，使SQLite在专用临时目录建立边文件；原数据库/WAL/SHM仍只被复制，格式拒绝和新建逻辑不改。
