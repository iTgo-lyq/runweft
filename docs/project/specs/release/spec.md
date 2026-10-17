# 发行产物

Runweft 提供明确 Hub、独立身份/空间、中心配置、完整资源后台、Agent 接入 Skill 和协作能力；执行基础随包附带固定 HAPI，运行时不依赖开发 checkout。支持 macOS arm64/x64 和 glibc Linux arm64/x64，平台范围不等于各平台均已通过原生协作验收，实际验收范围见[发行操作](../../../release.md#实测边界)。

## 包与安装

五个同版本 npm 包为 `runweft`、`runweft-darwin-arm64`、`runweft-darwin-x64`、`runweft-linux-arm64` 和 `runweft-linux-x64`。主包固定四个平台可选依赖，生成 manifest 不含 `private: true`；源码工程保持 private。本地打包命令仍不执行公开发布、push 或创建 PR。

平台包包含相邻的 Runweft/HAPI 可执行程序、使用说明、产品 Skill、HAPI 许可证、NOTICE、配套工具许可、匹配源码归档及来源说明；匹配源码保留固定 Git revision 的全部源码、许可与当前平台的两份构建工具压缩包，省略其他平台的八份工具压缩包。SOURCES.txt 说明归档范围、当前平台重建步骤和完整 Git 来源；生成 manifest 的 repository 指向 Runweft 仓库。直接解包并保留其目录布局即可运行，无需全局 Bun、Node 或另装 HAPI；npm 主入口需要 Node.js 20+ 和可解析所有平台依赖的 registry，见 [CLI 安装](../installation/spec.md)。Mac 程序未签名、未公证。

主包与全部平台包携带同一份[使用说明](../../../usage.md)，覆盖直接安装、MCP、配置、两种部署角色、资源登记、协作、成果和维护。

## 构建与校验

HAPI 固定版本和协议见[执行兼容](../execution/spec.md)。构建检查 HAPI revision、干净源码和已有程序 hash；干净源码须先安装 root/HAPI 两处 frozen 依赖，再执行类型检查、根测试和配套构建。

打包在独立暂存目录生成全部产物，成功后替换交付目录；失败保留上一次交付并清理暂存，不混入旧版本 tarball。`index.json` 使用 `product: hub-console-v1`，记录 Runweft 源码 revision/dirty、Bun 版本、HAPI pin、各平台程序 SHA-256、tarball SHA-512 和独立 Skill 的 SHA-256/SHA-512；`SHA256SUMS` 覆盖五个包、Skill tarball 及索引本身。

包验证检查集合、版本、平台/架构、程序执行位、许可、匹配源码文件集和每个 Git blob、README、Skill 和 hash。`test:packages` 直接运行本机平台的默认 Hub/相邻 HAPI 服务；`test:install` 通过专用 registry 验证安装/重装/卸载、数据和原生 MCP 配置保留，不公开发布。模型与网页验收记录实际安装平台程序及相邻 HAPI 的 realpath/hash，不用源码 gateway 替代默认服务。

普通CI共用一次checkout/依赖/工具，核心保留实际Codex配置检查；按真实Git差异选择access/storage/web/本机service，未知路径、新分支或缺少base保守全选；已有base的Git差异读取失败则报错。正式发布完整执行根/Node/四组无模型验证和四平台安装及完整卸载，不按diff跳过。

正式候选必须 `source.dirty=false`。冻结后按 `scripts/release-inputs.mjs` 的固定包输入检查已跟踪与未跟踪变化；源码、Skill、包内使用说明、package/lock/HAPI及指定构建脚本变化即重建。仅验收脚本和未打入包的项目记录变化可保留同候选，程序源码归档仍取索引revision，后续验收提交独立记录。

当前独立官网仅包含页面、资源与 npm 元数据，无包或 Skill 下载副本；见[官网安装](../website/spec.md)。

## 公开 Skill 同步

产品 Skill 在源码仓库 `.agents/skills/runweft-kit/` 维护，CI 单向分发到 `iTgo-lyq/runweft-kit` 的 `skills/runweft-kit/`；不导出程序源码、SpecTrail 或工程文档。main 上 Skill、同步入口或相关依赖变化触发 `sync-runweft-kit.yml`，也支持 main 手动触发；串行且不中途取消，每次读取最新 main 的确定提交，避免队列中的旧事件覆盖新内容。

源码 checkout 不保留写凭据；公开目标使用专用可写 deploy key，私钥保存在源 Actions secret `RUNWEFT_KIT_SYNC_SSH_KEY`，不保存到仓库或日志。同步只从 `git archive <revision>:.agents/skills/runweft-kit` 导出已提交目录。校验 Skill 元数据、完整引用和符号链接边界后，要求干净且在 main 的分发 checkout，仅更新 `skills/runweft-kit/`，删除失效文件并保留 README 等目标其他内容。内容一致不创建提交，变化提交记录源 revision；推送失败保留本地提交并报告失败，不推断公开目标已更新。

公开 Skill 与 npm 程序分别更新，消费端实际操作按已安装 CLI 版本核对。公开仓库和安装验收不等同于 skills.sh 收录；平台索引与安装遥测结果需另行实际查询。操作及凭据入口见[产品 Skill 分发](../../../release.md#产品-skill-分发)。

## npm 可信发布

五包绑定GitHub仓库 `iTgo-lyq/runweft` 的 `npm-publish.yml`，environment留空，同时允许npm publish与Allow npm dist-tag。托管runner使用Node24/npm11.21.0、id-token:write及npm audience `npm:registry.npmjs.org`，不保存长期npm token；OIDC token不打印或持久化。私有仓库支持发布，当前无自动provenance。

版本入口接受规范不可变tag：稳定 `vX.Y.Z`、预发行 `vX.Y.Z-beta.N`，整数无前导零且N非负，源码版本必须匹配。main/codex普通推送不发布npm；手动参数全部留空只预演，main显式输入已有tag可恢复原源码。当前控制提交运行检查，独立checkout原tag及固定HAPI构建一次；固定packageInputs与tag必须一致。

稳定正式发布在基础检查、四平台构建/包内容及 service-package 通过后，同一 beta job 以 --tag=beta 依次上传四平台和主包；主包等待四平台公开确认。access/storage/web 从公共 npm 下载同一候选，按固定用例分片在独立 Linux job 中与四平台安装并行，原有用例必须恰好覆盖一次，全部成功后才晋级。空参数预检和 X.Y.Z-beta.N 预发行构建仍在上传前完成四组，预检不上传。上传前输出原候选描述，绑定 tag/source、HAPI、完整 manifest、五包 SHA-512 和程序 SHA-256，并记录 latestBefore。已有 beta 不得倒退，上传期间 latest 须保持基线。稳定版本的 beta 是等待完整验收的公开候选；精确版本可以安装，失败不能覆盖同版本。

Linux x64/arm64、macOS x64/arm64均必须完成公共安装和完整卸载，两项可在独立托管job运行，各托管job重新读取五包公共元数据，下载主包与本平台tarball并核验SHA-512。公共安装从npm安装精确版本到专用prefix/cache，核对Runweft/HAPI程序SHA-256，验证MCP目录、无Bun服务与信号、重装、缺依赖诊断、npm卸载保留。每个平台还用原平台tarball验证8组完整卸载：Hub/双连接Runner/登记会话停止、预览与拒绝、删除失败保留及重试、Skill/MCP/数据/备份删除和其他配置/凭据/项目保留、独立包/PATH链接自删除。控制程序在第一次安装前另存整包，测试PATH不含模型客户端；会话为登记到真实HAPI的控制测试进程。稳定版 Linux x64 同时运行真实网页 DOM 精确版本安装，核对配对程序、README 和五份 Skill 的内容。工作流与晋级脚本均要求 beta、四平台安装及所需公共集成整体成功；失败、取消或非预期跳过均阻止晋级。稳定版本复查五包后先更新平台latest、最后主包latest，X.Y.Z-beta.N保持beta。部分晋级可幂等续跑，不倒退或改动外部推进的标签。

公共候选下载的五包元数据与主包/平台 tarball 共享十分钟预算，单请求及完整流受剩余时间限制。传播 404、408、429、5xx 和明确网络中断可重试并尊重 Retry-After；鉴权、410、地址、manifest 和摘要错误直接失败。完整 SHA-512 校验后才接纳临时下载，失败清理部分文件；确定性验收不循环重跑。

手动 `verify-run-id` 可在验收分支只读复验原公开候选，与发布/恢复参数互斥。必须取得同仓库原发行run的候选描述和成功上传前证据，当前固定包输入仍一致，并复核全部公开摘要；运行全部公共集成分片、四平台双路径及稳定版网页安装，跳过构建、上传、晋级和官网部署。工作流条件与上传/晋级入口均拒绝验证模式的写操作，不将验证run当作原上传证据。

工作流串行且不中途取消。集成、安装或晋级失败只重跑失败 job，复用原成功 beta 输出与 npm 原包。beta job 失败但五包全部公开时，从原 attempt 日志取原候选描述、上传及成功的上传前检查证据，不重新打包；所有已有候选恢复（含预发行）重新运行三组公共集成和四平台安装。修正后工作流可从 main 填写 release-tag 和原 source-run-id 恢复，包输入仍须等于原 tag。部分公开、未知上传、无法取得原日志直接停止，使用新版本处理；仅无公开版本且此前未开始上传可重建。

稳定正式发行从不可变 tag 选择版本，独立 dispatch main 官网，与 npm 构建、上传、公开等待及验收并行。显式并行入口绑定精确版本及同仓库正在进行的发行 run/attempt；手动来源还绑定正式发行模式与版本，预检、只读验证和预发行不部署官网。官网允许暂时先于 npm 可安装状态，npm 的验收与晋级门禁保持完整；最终发布必须同时满足 npm 和真实官网子 run 成功，失败、取消或缺失必需结果不能报告成功。

官网失败或状态未知只处理官网，不重发 npm；已有上传且静态产物未变时可仅复验原部署。npm 失败不自动回滚已上线官网，不一致持续到定向处理完成。发布摘要收集各 attempt 及全部关联官网运行的候选、验收、重试和实际 job 排队/运行时间，继承成功 job 不重复计时；未知字段与日志缺失明确保留，不推断计费额度。

发布、安装、普通CI和官网均不上传或下载Actions artifact；候选描述与脱敏验收由 CI 自动保存在 Actions 任务日志/summary，发布排查以对应运行及关联官网证据为准。记录遵循仓库 Actions 保留期限，查询入口与留存边界见[发布证据与排查](../../../release.md#发布证据与排查)。日常发布不生成仓库内的版本报告，也不要求发布后另行整理或提交摘要；专项开发的验收结论按对应 Change 记录。

## 升级与保留

升级不移动用户数据，已安装程序与仍运行的服务分别报告版本；`doctor` 明确提示版本不一致，重启对应角色后生效。当前业务格式为Hub schema19/client schema1；只支持完整同格式库重开，旧版、未知或结构不符明确拒绝，原目录保持不变。备份与格式边界见[部署](../deployment/spec.md)，不提供数据迁移、历史清理或跨格式回退。npm 卸载保留数据根，MCP 配置由显式命令安装或卸载。
