# 执行与验收证据

## T1：工程 Skill 与公开分发

产品 Skill 已整体移动到 `.agents/skills/runweft/`，包含主指令、四个 references 和 `agents/openai.yaml`。打包读取新目录，npm 包内仍为 `skills/runweft/`，独立 tarball 仍为 `runweft/`；发行冻结输入、卸载测试和官网包内容比对同步改用新源码路径。文档检查继续覆盖产品 Skill。历史覆盖清单的六个旧路径链接固定到迁移前提交 `64df00254894b718cf8737ab2730c6d0ea56d38d`，仅修正链接目标，保留当时的清单和结论。

增加提交导出、元数据/引用校验、幂等同步脚本与串行 main CI；公开仓库 `iTgo-lyq/runweft-skill` 已建立。源 Actions secret `RUNWEFT_SKILL_SYNC_SSH_KEY` 与目标仓库专用可写 deploy key 已配置；凭据不进入仓库和执行记录。

### 本地检查

- `bun run typecheck`：通过。
- `bun run test`：264 项通过，0 失败；含迁移后的卸载夹具、产品 Skill 新路径的候选冻结检查。
- `node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs`：75 项通过，0 失败。新增五项真实 Git 同步夹具覆盖已提交目录、私有源码与未提交文件排除、失效文件删除、分发元数据保留、重复同步、脏目标/错误分支、损坏引用/元数据和拒绝推送。
- `node scripts/check-runweft-skill.mjs` 与 skill-creator `quick_validate.py`：完整六文件结构通过。
- `node scripts/check-docs.mjs`：迁移后历史链接检查曾失败；固定旧路径链接后通过，335 文档、859 本地链接、0 错误。
- `node scripts/check-workflow.mjs`：通过。
- `shellcheck scripts/sync-runweft-skill.sh`、actionlint 1.7.12、`git diff --check`：通过。

### 独立 Agent 场景

独立 Agent 仅获得 Skill 路径和“已有工程 Skill、另一台 Claude 机器、已有个人修改、分别安装/升级 Skill 与程序”的用户场景。它正确区分公开 Skill、npm 包副本、程序与 MCP 安装，并要求保留修改及凭据；同时发现宿主自动发现与官网版本入口的歧义。已将工程读取与宿主自动发现区分，补充官方 release.json 链接，并明确更新前备份/确认个人修改。第二次只读复核确认原场景没有剩余会导致误操作的歧义；这不代替安装命令的实际执行验收。

### 实际分发与打包

- 实现提交：`408a7660847f0937c1032ef681be1c80f7f350c9`，已推送 Change 分支，源工作区在打包时干净。
- 同一同步脚本实际推送公开仓库 main，提交为 `5ec6af9525499d67a5a00bc51308f866f5069664`；GitHub 确认可见性 public、默认分支 main。再次运行同步没有新增提交。公开树仅含 README 与六份 `skills/runweft` 文件。
- 使用独立 `.dev-smoke/runweft-skill-install` 下的 HOME、CODEX_HOME、CLAUDE_CONFIG_DIR 和 npm cache，实际执行公开仓库安装命令。CLI 只发现一个 `runweft` 并成功复制；安装目录全部六文件逐字节匹配源码。未修改开发者全局安装、配置或凭据。
- `bun run package --platform linux-x64 --reuse-hapi` 实际通过，配套 HAPI revision/源码/hash 由原构建入口核对。干净源码的主包、Linux x64 平台包与独立 Skill tarball 六文件逐字节匹配，包内路径维持原约定，平台 CLI `--version` 返回 1.1.7。没有执行 npm 发布或四平台重新构建；不将单平台验证写成四平台发行验收。

自动 main 同步需要工作流合入守护分支后启用；当前不将本地脚本、目标仓库和凭据配置成功写成 CI 已运行。skills.sh 搜索安装后第一次查询为 HTTP 200、0 条；没有把安装成功写成遥测接收或搜索收录成功。
