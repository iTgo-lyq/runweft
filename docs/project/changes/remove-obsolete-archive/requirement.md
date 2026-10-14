# 删除旧工程归档并标记失效引用

## 背景与目标

用户明确要求删除 GitHub 上的 `iTgo-lyq/runweft-archive` 和本地 `/home/tiger/workspace/runweft-archive`，将已核对的五个文件中的相关引用标记为已失效，保留现有 Git 历史。旧工程已停止开发，当前产品和 Skill 同步 CI 不依赖它。

## 范围与方案

本次为 small：一次旧归档清理和历史文档补注，无产品行为变化。删除前核对 GitHub 仓库 ID `1377135554`、私有及归档状态、本地目录真实路径和 Git 归属，确认无额外 worktree、挂载点或进程占用，再执行已授权删除。

在 `hapi-subagent-foundation` 的 Research、Requirement，`host-mcp-adapter` 的 Requirement，以及 `current-data-baseline` 的 Technical、verification.json 中追加日期、失效原因和适用范围；保留原始调查与验收事实。JSON 的原始删除清单不改类型，以单独的引用状态补注说明失效。用户本次指令授权这些只读历史文档的最小修正。新旧仓库的 Git 提交历史均不改写，不另建旧仓库备份。

## 验收

- GitHub 删除请求成功，随后已认证查询确认目标仓库不存在；当前 Runweft 与 Runweft Kit 仍可正常读取。
- 本地旧仓库路径不存在，当前工作区正常且未误删其他目录。
- 五个文件均明确标注相关引用已失效，结构和文档校验通过，原始历史记录保留。
- 改动提交推送，按本会话已有直接合入 main 的交付选择集成。

## 授权与核对

2026-10-14 用户原话：“直接删掉 GitHub 上的 runweft-archive 和本地旧仓库，5 个文件里的相关引用标记为已失效，Git 历史不用改写。”已认证 GitHub 查询和本地 Git 检查确认目标身份；远端有 main 和三个 review 分支，无标签、Release、Issue 或 PR。
