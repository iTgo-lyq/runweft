# 删除旧工程归档的执行证据

## T1 删除旧归档并补注失效引用

2026-10-14 核对 GitHub 目标为 `iTgo-lyq/runweft-archive`，ID `1377135554`，私有且已归档。删除请求返回 HTTP 403；当前 GitHub CLI 凭据范围为 `gist, read:org, repo, workflow`，缺少 `delete_repo`。用户选择在 GitHub 设置页手动删除并通知 Agent，目前远端删除等待完成后复核。

本地目标 `/home/tiger/workspace/runweft-archive` 的 origin 与远端一致，工作区干净，仅注册自身 worktree。删除前复查真实路径、设备与 inode 身份、挂载点和 `/proc` 中的 cwd/exe/fd，无占用后删除；随后确认原路径不存在。未创建备份，未改写 Git 历史。

五个指定历史文件已标注引用失效日期与原因，并保留原始调查事实；Research 同时覆盖旧提交、三个 review 分支的 GitHub 存档和本地试验副本。verification.json 使用独立的 `invalidatedReferences` 补注，逐字段比对确认原始验收数据完全不变。

验证：`node scripts/check-docs.mjs` 检查 339 个文档、860 个本地链接，零错误；`node scripts/check-workflow.mjs` 校验 52 个 Change 通过；`git diff --check` 通过。五文件均包含失效标记和日期，本地旧路径不存在。当前 Runweft 与公开 Runweft Kit 的 GitHub 元数据读取正常，原同步 CI 的目标仍为 `iTgo-lyq/runweft-kit`。本次仅为外部清理和文档补注，未运行产品全套测试。
