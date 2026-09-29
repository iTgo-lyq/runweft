# CLI 安装与命令承载

Runweft 提供一个 `runweft` 命令，包含配置、工作区绑定、HAPI 服务管理、认证、诊断、[MCP 安装](../mcp/spec.md)和全局[机器](../../resources/machines/spec.md)/[Runtime](../../resources/runtimes/spec.md)登记。`runweft hapi …` 调用配套的原生 HAPI，保留参数、终端交互、退出码与信号；覆盖同一托管 Hub/Runner 的操作提示改用统一启停命令。

## 安装包

- npm 主包通过固定版本可选依赖选择 macOS arm64/x64、glibc Linux arm64/x64 平台包；需要 Node.js 20+，不需要全局 Bun 或单独安装 HAPI。
- Node 启动器运行配套二进制并转发信号。不支持的平台、缺少平台依赖或文件不完整时非零退出并提供诊断，不切换执行组件。
- 构建验证固定 HAPI revision、版本和干净源码；复用构建还核对二进制 hash。平台包包含 HAPI 程序、许可、NOTICE、匹配的源码归档和构建来源。
- `build` 在编译前核对已构建 HAPI 的 revision 和 hash，不混用旧程序；更换固定版本后先运行 `build:hapi`。`package --reuse-hapi` 使用相同核对规则。
- 当前版本是 private 候选包，未发布公共 npm。候选 registry 必须同时提供主包和平台依赖；只安装主包 tarball 不能代替完整依赖解析。
- npm 卸载删除程序，保留 Runweft 数据根。包升级不搬迁用户数据，运行中的服务与已安装程序分别报告版本，按角色重启生效。

## 命令约定

全局 `--home` 与 `--json` 写在子命令前。JSON 输出用于已实现的结构化命令；HAPI 透传保留原程序输出。错误写入 stderr，并设置非零退出码。业务能力尚未实现时不提供占位命令。

安装与维护操作见[使用说明](../../../../usage.md)；配置和服务行为见[部署](../../deployment/spec.md)。
