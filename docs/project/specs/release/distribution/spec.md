# 发行产物

> 现有官网/四平台发行包仍对应旧认证与配置。Hub 集中委派已在当前源码和 Linux 编译 CLI 验收，尚未生成包含这些行为的同版四平台发行包；旧产物证据不证明新接口已发布。

Runweft 1.0.0 提供统一入口、完整协作和内嵌看板；执行基础随包附带固定 HAPI，运行时不依赖开发 checkout。支持 macOS arm64/x64 和 glibc Linux arm64/x64，平台范围不等于各平台均已通过原生协作验收，实际范围见[发行验收](../acceptance/spec.md)。

## 包与安装

五个同版本 npm 包为 `runweft`、`runweft-darwin-arm64`、`runweft-darwin-x64`、`runweft-linux-arm64` 和 `runweft-linux-x64`。主包固定四个平台可选依赖，生成 manifest 不含 `private: true`；源码工程保持 private。打包不会执行公开发布、push 或创建 PR，当前交付未上传公共 npm。

平台包包含相邻的 Runweft/HAPI 可执行程序、使用说明、HAPI 许可证、NOTICE、配套工具许可、匹配源码归档及来源说明。直接解包并保留其目录布局即可运行，无需全局 Bun、Node 或另装 HAPI；npm 主入口需要 Node.js 20+ 和可解析所有平台依赖的 registry，见 [CLI 安装](../../installation/cli/spec.md)。Mac 程序未签名、未公证。

主包与全部平台包携带同一份[使用说明](../../../../usage.md)，覆盖直接安装、MCP、配置、两种部署模式、资源登记、协作、成果和维护。完整交付归档另集中保存五个 tarball、manifest、使用说明、索引和校验清单，不包含开发验证现场、原生配置或凭据。

## 构建与校验

HAPI 固定版本和协议见[执行兼容](../../execution/compatibility/spec.md)。构建检查 HAPI revision、干净源码和已有程序 hash；干净源码须先安装 root/HAPI 两处 frozen 依赖，再执行类型检查、根测试和配套构建。

打包在独立暂存目录生成全部产物，成功后替换交付目录；失败保留上一次交付并清理暂存，不混入旧版本 tarball。`index.json` 记录 Runweft 源码 revision/dirty、Bun 版本、HAPI pin、各平台程序 SHA-256 和 tarball SHA-512；`SHA256SUMS` 覆盖五个 tarball 及索引本身。

`test:packages` 检查包集合、版本、平台/架构、程序执行位、许可与匹配源码、README 和 hash，并在原生平台直接解包运行服务。模型验收绑定已安装程序的 hash；包和程序不同不能沿用旧证据。仅验收脚本及未打入包的项目文档变化不改变候选程序。

## 升级与保留

升级不移动用户数据，已安装程序与仍运行的服务分别报告版本；`doctor` 明确提示版本不一致，重启对应角色后生效。当前源码 schema 18，不转换旧试验历史；备份及显式重置边界见[部署](../../deployment/spec.md)，不承诺跨版本回退。npm 卸载保留数据根，MCP 配置由显式命令安装或卸载。
