# 发行产物

Runweft 1.1.0 提供明确 Hub、独立身份/空间、中心配置、完整资源后台、Agent 接入 Skill 和协作能力；执行基础随包附带固定 HAPI，运行时不依赖开发 checkout。支持 macOS arm64/x64 和 glibc Linux arm64/x64，平台范围不等于各平台均已通过原生协作验收，实际范围见[发行验收](../acceptance/spec.md)。

## 包与安装

五个同版本 npm 包为 `runweft`、`runweft-darwin-arm64`、`runweft-darwin-x64`、`runweft-linux-arm64` 和 `runweft-linux-x64`。主包固定四个平台可选依赖，生成 manifest 不含 `private: true`；源码工程保持 private。五包 1.1.0 已公开发布到 npm，全部 latest=1.1.0，公开元数据/下载完整性及 Linux x64 专用安装通过；见[npm 发布验收](../../../archive/2026-10-01-npm-publication/acceptance.md)。本地打包命令仍不执行公开发布、push 或创建 PR。

平台包包含相邻的 Runweft/HAPI 可执行程序、使用说明、产品 Skill、HAPI 许可证、NOTICE、配套工具许可、匹配源码归档及来源说明；匹配源码保留固定 Git revision 的全部源码、许可与当前平台的两份构建工具压缩包，省略其他平台的八份工具压缩包。SOURCES.txt 说明归档范围、当前平台重建步骤和完整 Git 来源；生成 manifest 的 repository 指向 Runweft 仓库。直接解包并保留其目录布局即可运行，无需全局 Bun、Node 或另装 HAPI；npm 主入口需要 Node.js 20+ 和可解析所有平台依赖的 registry，见 [CLI 安装](../../installation/cli/spec.md)。Mac 程序未签名、未公证。

主包与全部平台包携带同一份[使用说明](../../../../usage.md)，覆盖直接安装、MCP、配置、两种部署角色、资源登记、协作、成果和维护。完整交付 `dist/runweft-1.1.0-release/` 及同名 `.tar.gz` 集中保存五包/独立 Skill、原始索引、静态官网、使用说明、对应两仓库源码归档与离线 Git bundle、脱敏验收说明和证据索引。manifest 在各包内；不包含开发验证现场、原生配置或凭据。整包旁置 `.sha256`，内部 `SHA256SUMS` 校验全部交付文件。原离线整包与网站副本仍绑定候选 `657550f20d44d1a65a48b232ef13f3ca5160e8cd`；公共 npm 候选绑定 `bfa2df88531a2f997038817c901d89ca9cab491e`，四平台程序/Skill 相同，包内 README、源码归档范围和 repository 元数据不同。各自来源以自身索引为准，未重新组装或覆盖原整包。

## 构建与校验

HAPI 固定版本和协议见[执行兼容](../../execution/compatibility/spec.md)。构建检查 HAPI revision、干净源码和已有程序 hash；干净源码须先安装 root/HAPI 两处 frozen 依赖，再执行类型检查、根测试和配套构建。

打包在独立暂存目录生成全部产物，成功后替换交付目录；失败保留上一次交付并清理暂存，不混入旧版本 tarball。`index.json` 使用 `product: hub-console-v1`，记录 Runweft 源码 revision/dirty、Bun 版本、HAPI pin、各平台程序 SHA-256、tarball SHA-512 和独立 Skill 的 SHA-256/SHA-512；`SHA256SUMS` 覆盖五个包、Skill tarball 及索引本身。

包验证检查集合、版本、平台/架构、程序执行位、许可、匹配源码文件集和每个 Git blob、README、Skill 和 hash。`test:packages` 直接运行本机平台的默认 Hub/相邻 HAPI 服务；`test:install` 通过专用 registry 验证安装/重装/卸载、数据和原生 MCP 配置保留，不公开发布。模型与网页验收记录实际安装平台程序及相邻 HAPI 的 realpath/hash，不用源码 gateway 替代默认服务。

正式候选必须 `source.dirty=false`。冻结后按 `scripts/fixtures/release-inputs.mjs` 的固定包输入检查已跟踪与未跟踪变化；源码、Skill、包内使用说明、package/lock/HAPI及指定构建脚本变化即重建。仅验收脚本和未打入包的项目记录变化可保留同候选，程序源码归档仍取索引revision，后续验收提交独立记录。

`release:assemble` 核对冻结候选、网站来源和hash，接收经过筛选的验收说明/证据索引，拒绝覆盖已有交付。离线Git bundle恢复原Runweft revision及HAPI子模块，重建不依赖远端Git，依赖与构建工具下载仍需网络；普通源码tar包含对应文件，不伪造Git身份。

## 升级与保留

升级不移动用户数据，已安装程序与仍运行的服务分别报告版本；`doctor` 明确提示版本不一致，重启对应角色后生效。当前源码 schema 18，不转换旧试验历史；备份及显式重置边界见[部署](../../deployment/spec.md)，不承诺跨版本回退。npm 卸载保留数据根，MCP 配置由显式命令安装或卸载。
