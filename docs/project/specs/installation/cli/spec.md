# CLI 安装与命令承载

Runweft 提供一个 `runweft` 命令，包含本机部署配置、Hub 连接、HAPI 服务管理、认证、诊断、[MCP 安装](../mcp/spec.md)和全局[机器](../../resources/machines/spec.md)/[Runtime](../../resources/runtimes/spec.md)登记，以及中心仓库关联和 [Agent 定义](../../agents/definition/spec.md)的创建、个人选择与目标检查。[任务命令](../../delegation/interface/spec.md)提供本机共享/独立 worktree 协作、收尾修复与显式清理。`runweft hapi …` 调用配套的原生 HAPI，保留参数、终端交互、退出码与信号；覆盖同一托管 Hub/Runner 的操作提示改用统一启停命令。

## 安装包

- npm 主包通过固定版本可选依赖选择 macOS arm64/x64、glibc Linux arm64/x64 平台包；需要 Node.js 20+，不需要全局 Bun 或单独安装 HAPI。
- 平台 tarball 可直接解包运行，不需要 Node；保留相邻 Runweft/HAPI 和包目录结构，可通过符号链接提供统一命令入口。Mac 产物未签名、未公证。
- Node 启动器运行配套二进制并转发信号。不支持的平台、缺少平台依赖或文件不完整时非零退出并提供诊断，不切换执行组件。
- 构建验证固定 HAPI revision、版本和干净源码；复用构建还核对二进制 hash。平台包包含 HAPI 程序、许可、NOTICE、匹配的源码归档和构建来源。
- `build` 在编译前核对已构建 HAPI 的 revision 和 hash，不混用旧程序；更换固定版本后先运行 `build:hapi`。`package --reuse-hapi` 使用相同核对规则。
- 1.1.0 主包与四个平台依赖已发布公共 npm；可用 `npm install -g runweft@1.1.0 --registry=https://registry.npmjs.org/ --include=optional` 安装，源码工程保持 private。Linux x64 的公共 npm 专用安装及程序/Skill 校验已通过，见[npm 发布验收](../../../archive/2026-10-01-npm-publication/acceptance.md)。其他 registry 仍须提供主包和平台依赖；只安装主包 tarball 不能代替完整依赖解析。
- 主包和四个平台包均附相同的完整使用说明，覆盖安装、配置、任务协作、数据留存与维护，不要求从源码启动日常命令。
- 主包和平台包同时附带[产品 Skill](../skill/spec.md)，官网统一提供 npm 安装命令，从 npm 包读取 Skill，无独立下载；安装到宿主由用户授权的 Agent 操作，不自动更改全局配置。
- 打包使用独立暂存，成功后替换旧交付；索引与校验文件绑定源码、配套 HAPI、程序和 tarball，见[发行产物](../../release/distribution/spec.md)。
- npm 卸载删除程序，保留 Runweft 数据根。包升级不搬迁用户数据，运行中的服务与已安装程序分别报告版本，按角色重启生效。

## 命令约定

全局 `--home` 与 `--json` 写在子命令前。JSON 输出用于已实现的结构化命令；HAPI 透传保留原程序输出。错误写入 stderr，并设置非零退出码。业务能力尚未实现时不提供占位命令。

安装与维护操作见[使用说明](../../../../usage.md)；配置和服务行为见[部署](../../deployment/spec.md)。

根级 machine/runtime 与 `hub --url … machine/runtime` 共用中心资源命令，包含持久接入、凭据轮换、空间关联与 runtime 分享/禁用；默认使用选中 Hub，要求相应能力，不回退旧认证。契约见 [Hub 资源归属](../../resources/ownership/spec.md)。

repository/agent 同时提供根级与 hub 域入口，使用明确 Hub 身份/空间；见[仓库关联](../../repositories/association/spec.md)与[中心 Agent](../../agents/central/spec.md)。不满足能力时明确报错，不回退旧文件。不提供旧workspace bind/list、agent init/bind、HAPI token认证或data/reset入口。已有数据格式不匹配时按[部署](../../deployment/spec.md)明确拒绝，不迁移或清理原目录。
