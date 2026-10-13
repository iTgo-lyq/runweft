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

候选公开安装、打包及主分支集成的实际结果在对应步骤完成后记录，不提前认定成功。
