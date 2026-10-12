# CLI 安装与命令承载

Runweft 提供一个 `runweft` 命令，包含本机部署配置、完整卸载、Hub 连接、HAPI 服务管理、认证、诊断、[MCP 安装](../mcp/spec.md)和全局[机器](../../resources/machines/spec.md)/[Runtime](../../resources/runtimes/spec.md)登记，以及中心仓库关联和 [Agent 定义](../../agents/definition/spec.md)的创建、个人选择与目标检查。[任务命令](../../delegation/interface/spec.md)提供本机共享/独立 worktree 协作、收尾修复与显式清理。`runweft hapi …` 调用配套的原生 HAPI，保留参数、终端交互、退出码与信号；覆盖同一托管 Hub/Runner 的操作提示改用统一启停命令。

## 安装包

- npm 主包通过固定版本可选依赖选择 macOS arm64/x64、glibc Linux arm64/x64 平台包；需要 Node.js 20+，不需要全局 Bun 或单独安装 HAPI。
- 平台 tarball 可直接解包运行，不需要 Node；保留相邻 Runweft/HAPI 和包目录结构，可通过符号链接提供统一命令入口。Mac 产物未签名、未公证。
- Node 启动器运行配套二进制并转发信号。不支持的平台、缺少平台依赖或文件不完整时非零退出并提供诊断，不切换执行组件。
- 构建验证固定 HAPI revision、版本和干净源码；复用构建还核对二进制 hash。平台包包含 HAPI 程序、许可、NOTICE、匹配的源码归档和构建来源。
- `build` 在编译前核对已构建 HAPI 的 revision 和 hash，不混用旧程序；更换固定版本后先运行 `build:hapi`。`package --reuse-hapi` 使用相同核对规则。
- 1.1.3 主包与四个平台依赖已发布公共 npm；可用 `npm install -g runweft@1.1.3 --registry=https://registry.npmjs.org/ --include=optional` 安装，源码工程保持 private。四平台托管公共npm安装与服务验收、Linux x64匿名程序/Skill核对已通过，见[1.1.3发布验收](../../../archive/2026-10-11-npm-hapi-fix-release/acceptance.md)。其他 registry 仍须提供主包和平台依赖；只安装主包 tarball 不能代替完整依赖解析。
- 主包和四个平台包均附相同的完整使用说明，覆盖安装、配置、任务协作、数据留存与维护，不要求从源码启动日常命令。
- 主包和平台包同时附带[产品 Skill](../skill/spec.md)，官网统一提供 npm 安装命令，从 npm 包读取 Skill，无独立下载；安装到宿主由用户授权的 Agent 操作，不自动更改全局配置。
- 打包使用独立暂存，成功后替换旧交付；索引与校验文件绑定源码、配套 HAPI、程序和 tarball，见[发行产物](../../release/distribution/spec.md)。
- npm 卸载删除程序，保留 Runweft 数据根。包升级不搬迁用户数据，运行中的服务与已安装程序分别报告版本，按角色重启生效。

## 完整卸载

根级 `uninstall` 默认只预览，`--yes` 执行完整删除，`--dry-run` 始终预览；全局 `--home` 与 `--json` 位于子命令前。范围为当前安装与选定本机 Runweft 数据根，不扫描其他账号、数据根或远端 Hub，不清理全局 npm 缓存。源码已实现并通过 Linux x64 隔离自动验收，公共 npm 1.1.3 尚不包含此命令，见[验收](../../../archive/2026-10-12-complete-uninstall/acceptance.md)。

支持可确认归属的 npm 全局包与完整独立平台包。预检安装、路径、所有权、权限、原生接入、Skill、进程与 Git 元数据；拒绝源码/项目依赖、未知包、危险数据根、未知内容、同程序其他 home 占用、无法验证的进程和被用户改写的任务 Git 引用。预览不停止进程、不打开业务库、不写文件或备份。

执行先停止该 home 的 Hub、全部连接 Runner、当前及恢复记录中的登记会话和本 home 的 MCP 服务；检查残留后，用无持久备份的配置编辑移除自身 MCP/hook，清理已确认的 Skill 与确切受管 worktree/refs，再删除程序和整个数据根（含配置、连接凭据、数据库、日志、缓存、工作区副本及备份）。保留其他软件配置、模型凭据、原生历史、独立 HAPI、用户源项目、用户分支和其他工作树；子符号链接只移除链接。卸载不得在将被停止的受管祖先进程内运行。

npm 程序删除禁用生命周期脚本、忽略 npm_config 环境污染并核对入口/主包/平台程序已消失。失败非零，程序删除失败保留数据并可重试；程序已删而数据删除失败时报告准确剩余路径，不提示调用已删除 CLI。停止或删除已完成的部分不制造虚假恢复。

## 命令约定

全局 `--home` 与 `--json` 写在子命令前。JSON 输出用于已实现的结构化命令；HAPI 透传保留原程序输出。错误写入 stderr，并设置非零退出码。业务能力尚未实现时不提供占位命令。

安装与维护操作见[使用说明](../../../../usage.md)；配置和服务行为见[部署](../../deployment/spec.md)。

根级 machine/runtime 与 `hub --url … machine/runtime` 共用中心资源命令，包含持久接入、凭据轮换、空间关联与 runtime 分享/禁用；默认使用选中 Hub，要求相应能力，不回退旧认证。契约见 [Hub 资源归属](../../resources/ownership/spec.md)。

repository/agent 同时提供根级与 hub 域入口，使用明确 Hub 身份/空间；见[仓库关联](../../repositories/association/spec.md)与[中心 Agent](../../agents/central/spec.md)。不满足能力时明确报错，不回退旧文件。不提供旧workspace bind/list、agent init/bind、HAPI token认证或data/reset入口。已有数据格式不匹配时按[部署](../../deployment/spec.md)明确拒绝，不迁移或清理原目录。
