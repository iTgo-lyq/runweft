# 发行产物

Runweft 提供明确 Hub、独立身份/空间、中心配置、完整资源后台、Agent 接入 Skill 和协作能力；执行基础随包附带固定 HAPI，运行时不依赖开发 checkout。支持 macOS arm64/x64 和 glibc Linux arm64/x64，平台范围不等于各平台均已通过原生协作验收，实际范围见[发行验收](../acceptance/spec.md)。

## 包与安装

五个同版本 npm 包为 `runweft`、`runweft-darwin-arm64`、`runweft-darwin-x64`、`runweft-linux-arm64` 和 `runweft-linux-x64`。主包固定四个平台可选依赖，生成 manifest 不含 `private: true`；源码工程保持 private。五包1.1.4已先上传beta，四平台从公共npm安装并完整卸载验收后以OIDC晋级，全部latest/beta=1.1.4；来源、公开摘要与匿名安装见[1.1.4发布验收](../../../archive/2026-10-12-npm-uninstall-release/acceptance.md)。本地打包命令仍不执行公开发布、push 或创建 PR。

平台包包含相邻的 Runweft/HAPI 可执行程序、使用说明、产品 Skill、HAPI 许可证、NOTICE、配套工具许可、匹配源码归档及来源说明；匹配源码保留固定 Git revision 的全部源码、许可与当前平台的两份构建工具压缩包，省略其他平台的八份工具压缩包。SOURCES.txt 说明归档范围、当前平台重建步骤和完整 Git 来源；生成 manifest 的 repository 指向 Runweft 仓库。直接解包并保留其目录布局即可运行，无需全局 Bun、Node 或另装 HAPI；npm 主入口需要 Node.js 20+ 和可解析所有平台依赖的 registry，见 [CLI 安装](../../installation/cli/spec.md)。Mac 程序未签名、未公证。

主包与全部平台包携带同一份[使用说明](../../../../usage.md)，覆盖直接安装、MCP、配置、两种部署角色、资源登记、协作、成果和维护。完整交付 `dist/runweft-1.1.0-release/` 及同名 `.tar.gz` 集中保存五包/独立 Skill、原始索引、静态官网、使用说明、对应两仓库源码归档与离线 Git bundle、脱敏验收说明和证据索引。manifest 在各包内；不包含开发验证现场、原生配置或凭据。整包旁置 `.sha256`，内部 `SHA256SUMS` 校验全部交付文件。原离线整包与网站副本仍绑定候选 `657550f20d44d1a65a48b232ef13f3ca5160e8cd`；首次公共 npm 1.1.0 候选绑定 `bfa2df88531a2f997038817c901d89ca9cab491e`，四平台程序/Skill 相同，包内 README、源码归档范围和 repository 元数据不同。各自来源以自身索引为准，未重新组装或覆盖原整包。

## 构建与校验

HAPI 固定版本和协议见[执行兼容](../../execution/compatibility/spec.md)。构建检查 HAPI revision、干净源码和已有程序 hash；干净源码须先安装 root/HAPI 两处 frozen 依赖，再执行类型检查、根测试和配套构建。

打包在独立暂存目录生成全部产物，成功后替换交付目录；失败保留上一次交付并清理暂存，不混入旧版本 tarball。`index.json` 使用 `product: hub-console-v1`，记录 Runweft 源码 revision/dirty、Bun 版本、HAPI pin、各平台程序 SHA-256、tarball SHA-512 和独立 Skill 的 SHA-256/SHA-512；`SHA256SUMS` 覆盖五个包、Skill tarball 及索引本身。

包验证检查集合、版本、平台/架构、程序执行位、许可、匹配源码文件集和每个 Git blob、README、Skill 和 hash。`test:packages` 直接运行本机平台的默认 Hub/相邻 HAPI 服务；`test:install` 通过专用 registry 验证安装/重装/卸载、数据和原生 MCP 配置保留，不公开发布。模型与网页验收记录实际安装平台程序及相邻 HAPI 的 realpath/hash，不用源码 gateway 替代默认服务。

普通CI共用一次checkout/依赖/工具，核心保留实际Codex配置检查；按真实Git差异选择access/storage/web/本机service，未知路径、新分支或缺少base保守全选；已有base的Git差异读取失败则报错。tag/手动候选完整执行根/Node/四组无模型验证和四平台安装及完整卸载，不按diff跳过；当前main核心与1.1.4完整发布流程已远端通过，结果见[验收范围](../acceptance/spec.md)。发布构建job先移除未用的预装Android/.NET/GHC，为四平台候选和验收现场释放磁盘空间，各组结束记录剩余空间。

正式候选必须 `source.dirty=false`。冻结后按 `scripts/fixtures/release-inputs.mjs` 的固定包输入检查已跟踪与未跟踪变化；源码、Skill、包内使用说明、package/lock/HAPI及指定构建脚本变化即重建。仅验收脚本和未打入包的项目记录变化可保留同候选，程序源码归档仍取索引revision，后续验收提交独立记录。

当前独立官网仅包含页面、资源与 npm 元数据，无包或 Skill 下载副本；历史离线整包内的网站不覆盖，见[官网安装](../../website/product/spec.md)。

`release:assemble` 核对冻结候选及包 hash，校验网站版本等于候选、installation=npm、package=runweft 和公开 registry，拒绝旧下载/源码字段及 downloads 目录；网页来源不绑定程序提交。它接收经过筛选的验收说明/证据索引，拒绝覆盖已有交付。离线Git bundle恢复原Runweft revision及HAPI子模块，重建不依赖远端Git，依赖与构建工具下载仍需网络；普通源码tar包含对应文件，不伪造Git身份。

## npm 可信发布

五包绑定GitHub仓库 `iTgo-lyq/runweft` 的 `npm-publish.yml`，environment留空，同时允许npm publish与Allow npm dist-tag。托管runner使用Node24/npm11.21.0、id-token:write及npm audience `npm:registry.npmjs.org`，不保存长期npm token；OIDC token不打印或持久化。私有仓库支持发布，当前无自动provenance。上传和标签权限均已由1.1.4真实写入验证。

版本入口接受规范不可变tag：稳定 `vX.Y.Z`、预发行 `vX.Y.Z-beta.N`，整数无前导零且N非负，源码版本必须匹配。main/codex普通推送不发布npm；手动release-tag留空只预演，main显式输入已有tag可恢复原源码。当前控制提交运行检查，独立checkout原tag及固定HAPI构建一次；固定packageInputs与tag必须一致。

稳定正式发布在基础检查、四平台构建/包内容及 service-package 通过后，同一 beta job 以 --tag=beta 依次上传四平台和主包；主包等待四平台公开确认。access/storage/web 从公共 npm 下载同一候选，在三个独立 Linux job 中与四平台安装并行，全部成功后才晋级。空参数预检和 X.Y.Z-beta.N 预发行构建仍在上传前完成四组，预检不上传。上传前输出原候选描述，绑定 tag/source、HAPI、完整 manifest、五包 SHA-512 和程序 SHA-256，并记录 latestBefore。已有 beta 不得倒退，上传期间 latest 须保持基线。稳定版本的 beta 是等待完整验收的公开候选；精确版本可以安装，失败不能覆盖同版本。

Linux x64/arm64、macOS x64/arm64四个托管job重新读取五包公共元数据，下载主包与本平台tarball并核验SHA-512，从公共npm安装精确版本到专用prefix/cache；核对Runweft/HAPI程序SHA-256，验证MCP目录、无Bun服务与信号、重装、缺依赖诊断、npm卸载保留。每个job还用原平台tarball验证8组完整卸载：Hub/双连接Runner/登记会话停止、预览与拒绝、删除失败保留及重试、Skill/MCP/数据/备份删除和其他配置/凭据/项目保留、独立包/PATH链接自删除。控制程序在第一次安装前另存整包，测试PATH不含模型客户端；会话为登记到真实HAPI的控制测试进程。稳定版 Linux x64 同时运行真实网页 DOM 精确版本安装，核对配对程序、README 和五份 Skill 的内容。工作流与晋级脚本均要求 beta、四平台安装及所需公共集成整体成功；失败、取消或非预期跳过均阻止晋级。稳定版本复查五包后先更新平台latest、最后主包latest，X.Y.Z-beta.N保持beta。部分晋级可幂等续跑，不倒退或改动外部推进的标签。

公共候选下载的五包元数据与主包/平台 tarball 共享十分钟预算，单请求及完整流受剩余时间限制。传播 404、408、429、5xx 和明确网络中断可重试并尊重 Retry-After；鉴权、410、地址、manifest 和摘要错误直接失败。完整 SHA-512 校验后才接纳临时下载，失败清理部分文件；确定性验收不循环重跑。

工作流串行且不中途取消。集成、安装或晋级失败只重跑失败 job，复用原成功 beta 输出与 npm 原包。beta job 失败但五包全部公开时，从原 attempt 日志取原候选描述、上传及成功的上传前检查证据，不重新打包；所有已有候选恢复（含预发行）重新运行三组公共集成和四平台安装。修正后工作流可从 main 填写 release-tag 和原 source-run-id 恢复，包输入仍须等于原 tag。部分公开、未知上传、无法取得原日志直接停止，使用新版本处理；仅无公开版本且此前未开始上传可重建。旧 artifact 发布 run38041451856 不再重跑。

稳定晋级后自动 dispatch main 官网，关联来源 run/attempt 和精确版本，等待真实结果；预发行不部署。官网失败或状态未知只处理官网，不重发 npm。发布摘要收集各 attempt 及全部关联官网运行的候选、验收、重试和实际 job 排队/运行时间，继承成功 job 不重复计时；未知字段与日志缺失明确保留，不推断计费额度。新并行流水线的四平台远端运行与实际耗时尚待授权发行验证，现有本地验证范围见[提速验收](../../../archive/2026-10-13-release-throughput/acceptance.md)。

发布、安装、普通CI和官网均不上传或下载Actions artifact；候选描述与脱敏验收保存在任务日志/summary，最终摘要写入仓库归档。公开候选1.1.4绑定源码 `3f873788b11926d2e51c9ccf9f3f661dc239ab6a` 与HAPI `8f774b9413fd483bc163cc06425d7646f10a7c92`；原离线1.1.0交付保留，不继承其他候选的模型组合证据。

## 升级与保留

升级不移动用户数据，已安装程序与仍运行的服务分别报告版本；`doctor` 明确提示版本不一致，重启对应角色后生效。当前业务格式为Hub schema19/client schema1；只支持完整同格式库重开，旧版、未知或结构不符明确拒绝，原目录保持不变。备份与格式边界见[部署](../../deployment/spec.md)，不提供数据迁移、历史清理或跨格式回退。npm 卸载保留数据根，MCP 配置由显式命令安装或卸载。
