# 公开分发 Runweft Skill 并自动同步

## 背景与目标

Runweft 源码后续不直接公开，产品 Skill 需要独立的公开 GitHub 安装来源。工程内同一份 Skill 也供后续 Agent 使用，避免分别维护工程副本、npm 副本和公开副本。

用户已明确要求独立建立 GitHub 仓库、参考 open-folio 的 SpecTrail CI 自动同步，并将当前 Skill 移到 `.agents/skills/`。按 small 推进：仅新增局部分发逻辑；打包输入与校验调用为路径适配，不改变运行、数据或 MCP 契约。

## 范围与行为变化

- ADDED：公开 `iTgo-lyq/runweft-skill`，提供 `skills/runweft` 和安装说明；用户可通过 skills CLI 安装，后续收录由 skills.sh 的安装遥测和索引决定。
- ADDED：main 上产品 Skill 或同步入口变化时，CI 将已提交的目录单向同步到公开仓库；也支持手动触发。采用专用可写 deploy key，源码仓库保留只读 checkout 权限。
- MODIFIED：工程唯一源码目录为 `.agents/skills/runweft`，同步适配打包、发行冻结输入、卸载夹具、官网验收与当前文档。npm 包及 Skill tarball 中的路径仍为 `skills/runweft` / `runweft`。
- 不改变当前源码仓库可见性、不发行新 npm 版本、不安装到开发者全局。公开仓库不带源码、工程工作流文档或 SpecTrail。

## 方案要点

沿用 open-folio 的 Git archive 导出和串行 CI：读取最新 main 的确定提交，验证导出的完整 Skill，再仅更新公开仓库的 `skills/runweft`；删除其中失效文件，保留公开仓库 README 等其他内容。分发 checkout 必须干净且位于 main；相同内容不创建提交；同步提交记录来源 SHA。

公开仓库只作为分发目标，不回写工程。首次发布在 Change 分支提交完整实现并通过本地验收后进行。为后续自动同步配置目标仓库 deploy key 和源码仓库 Actions secret；跨仓库自动同步在工作流合入 main 后生效。

## 验收标准

- 工程可直接发现 `.agents/skills/runweft/SKILL.md`，原 `skills/runweft` 源码目录不再存在；打包和当前校验读取新目录，包内路径保持原约定。
- 公开 GitHub 仓库可匿名读取并由 skills CLI 唯一识别为 `runweft`，完整五份 Skill 文件与已提交源码一致。
- 同步夹具通过：只发布已提交 Skill，忽略未提交及目录外内容，删除失效文件，保留分发说明，重复同步无新提交；脏目标、错误分支、损坏 Skill 均不推送。
- 同步 workflow 语法校验通过，使用仅限公开目标的 deploy key；运行现有相关检查和独立 Agent 的 Skill 场景验收。
- 明确区分公开仓库已创建、同步脚本已实测、CI 是否已在 main 启用及 skills.sh 是否实际收录。

## 协作资源

- [open-folio 同步 workflow](https://github.com/iTgo-lyq/open-folio/blob/main/.github/workflows/sync-spec-trail.yml) 与 `scripts/sync-spec-trail.sh`：2026-10-13 读取本地对应源码，已确认其使用已提交目录导出、目标 deploy key 和幂等提交；本 Change 采用同样的分发方式。
- [skills.sh 收录说明](https://skills.sh/docs/faq)：2026-10-13 已读取，平台通过 skills CLI 安装遥测收录；不将公开仓库或本地扫描成功等同于搜索收录。
