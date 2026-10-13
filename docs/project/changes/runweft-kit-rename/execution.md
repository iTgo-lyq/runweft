# Runweft Kit 改名执行证据

## T1：统一身份和分发

源码与分发目录、frontmatter、宿主 UI 提示、安装和维护命令、包内目录及 tarball 名称、卸载识别、CI 文件与专用 secret 全部使用新身份。程序包、CLI 和 MCP 名称仍为 Runweft。官网从公开 Kit 仓库安装，已发布的程序无需升级才能使用新 Skill；独立安装的 Skill 若未进入旧程序卸载预览，按来源和目录单独核对清理。

GitHub 原仓库已重命名为 `iTgo-lyq/runweft-kit`，repo ID 仍为 `1417403387`，保持公开。新 deploy key 为目标仓库专用可写密钥，私钥上传到源 Actions 的 `RUNWEFT_KIT_SYNC_SSH_KEY` 后已删除本地临时文件。旧凭据在主分支同步验收后移除。

公开候选分支 `codex/kit-rename-validation` 包含完整新名称 Skill 和 README，供合入前隔离安装验收。主分支集成后由 CI 写入公开新目录，再清除公开旧目录与临时分支，公开 main 的最终证据留在 Git / CI。

已执行：

- `bun run typecheck` 通过；根测试 264 项通过、0 失败。
- Node 脚本与官网发布测试 75 项通过、0 失败；包含同步真实 Git 推送、内容一致、脏目标拒绝、错误元数据/越界引用拒绝、推送失败。
- 产品 Skill 结构和 quick_validate 通过；文档 337 文件、860 本地链接无错误，51 个 Change 校验通过；shellcheck、actionlint 和 diff 检查通过。
- 独立 Agent 只读验收三个场景通过：旧程序配合新公开 Kit、已有工程 Skill 与带用户修改的旧全局副本、卸载预览遗漏独立 Kit。该验收不冒充实际远端安装或程序执行。
- 官网浏览器验收通过。原校验禁止所有 GitHub 链接，误判新的公开 Kit 地址；已修为禁止源码仓库链接并定向复验。页面核对新安装命令及复制、两页提示一致、移动/桌面尺寸、子路径和无 JavaScript 行为。

候选公开安装使用 `iTgo-lyq/runweft-kit#codex/kit-rename-validation`，在独立 HOME、CODEX_HOME、CLAUDE_CONFIG_DIR 和 npm cache 执行真实 skills CLI 的 Codex 全局 copy 安装。只发现 `runweft-kit`，六个文件与源码完全相同。首次使用 `/tree/codex/kit-rename-validation` 被 CLI 解析成分支 `codex`，clone 明确失败；核对已安装 CLI 的 ref 解析后改用其支持的 `#ref`，成功后未重复安装。

从干净提交 `77c17822f73ef4f7f9acbfd4a694abfc886adec1` 执行 Linux x64 `bun run package --platform linux-x64 --reuse-hapi` 通过，复用 HAPI 固定 revision 与 hash。主包、平台包的 `skills/runweft-kit/` 及 `runweft-kit-1.1.7.tgz` 的 `runweft-kit/` 六个文件全部逐字节匹配，冻结输入校验通过，产物中无旧 Skill 目录。

`smoke-install.mjs` 真实 npm 安装通过；`smoke-uninstall.mjs` 完整卸载通过，覆盖新名称宿主 Skill 清理及其他配置、项目和未知用户内容保护。此次仅本地 Linux x64 候选验收，未发布新的 npm 版本，也不增加四平台或模型覆盖。官网分支预览 CI `38437667582` 成功。

主分支集成后的自动同步真实推送、公开 main 安装、清除旧身份及重复同步验收，按合码流程在 Git / CI 留最终证据，不回写关闭的归档。
