# 发布证据由 GitHub Actions 留存

## 背景与目标

用户要求先解决每次发布后额外整理、提交 `docs/releases/` 的问题，后续发布排查直接使用 GitHub。现有 CI 已自动收集发布证据，本次作为 small Change 调整留存约定与文档，取消重复入库。

## 范围与行为变化

- MODIFIED：发布结果、候选摘要、验收、重试、关联官网及耗时由 CI 写入 Actions 日志与 Summary；操作手册说明入口、证据标记和保留期限。
- REMOVED：删除 1.1.5、1.1.6、1.1.7 的六份版本报告和手册中的重复数据，取消 Agent 发布后另行编写并提交版本报告的要求。已有报告仍可从 Git 历史读取。
- 历史归档中指向已删除报告的链接改为同一内容的固定 Git 提交链接，仅修复引用目标。
- 本次不梳理或清理 `.dev-smoke`，不修改发布实现、重新发布版本或补发 GitHub Release。

## 方案要点

复用现有 `summary` job：聚合各 attempt 和关联官网 run 的记录，保留缺失日志和未知时间。GitHub 仓库当前 Actions 留存为 90 天，文档明确这是有期限的排查数据；长期专项研究按具体需求另行保存。CI 无须读回本地历史报告，也无须发布后产生文档提交。

## 验收标准

- 当前源码树无版本报告，当前发行手册及 Spec 不再要求发布后补写报告。
- 手册提供 GitHub 工作流入口、Summary 与日志定位方法及 90 天保留边界。
- 从实际发布 run 读取到 CI 汇总和脱敏证据，确认可以脱离本地报告排查。
- 文档链接、工作流状态校验和差异检查通过；发布实现无变化。

## 调查依据

2026-10-14 读取 [GitHub Actions 留存说明](https://github.blog/changelog/2026-10-01-actions-retention-now-covers-checks-runs-and-statuses/)，公开仓库留存上限为 90 天；仓库 `actions/permissions/artifact-and-log-retention` API 实测返回 `days=90`、`maximum_allowed_days=90`。

同日读取 [1.1.7 的 summary job](https://github.com/iTgo-lyq/runweft/actions/runs/38395584672/job/115296990811) 原始日志，包含一个 `RUNWEFT_RELEASE_SUMMARY` 和 159 条 `RUNWEFT_RELEASE_EVIDENCE`，覆盖两个 run，缺失日志为零；汇总时自身 job 未结束，时间明确为未知。`gh run view --log` 本次未输出日志，REST job logs 接口读取成功，手册据此提供直接 API 入口。
