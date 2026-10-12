# 缩短正常发布与失败恢复时间

> 状态：草稿
> 规模：中型
> 更新：2026-10-12

## 搁置记录

2026-10-12 用户要求提交现有调研与时间预估，暂缓此 Change。当前停留在方案草稿，未开始实施，也未形成正式 Plan；保留在 changes/，不按完成或取消归档。恢复需用户明确提出，再核对当时的发布实现与耗时基线。

## 目标与范围

用户要求先给优化方案。本轮只调查、形成方案并请 iclaude 评审，不修改发布实现、不触发发布。后续实施覆盖 npm 发布、无模型集成、四平台安装/卸载、官网接续和发布证据汇总。

在保留完整验收范围、不可变候选和四平台门禁的前提下，通过并行、下载重试和自动接续降低耗时。继续使用 npm 传递安装包、日志/summary 保存回执，不使用 Actions artifact 交接。

## 行为变化

### MODIFIED

- `release/distribution`：稳定版正式发布保留核心检查、构建及 service-package 检查在上传前，将 access/storage/web 移到 beta 后，与四平台安装/完整卸载并行，全部通过才晋级 latest。稳定版本的 beta 标签因而是等待完整验收的公开候选。空参数预检和 X.Y.Z-beta.N 预发行仍在上传前跑四组。
- `release/acceptance`：当前 tarball 临时 404 会立即使平台 job 失败；建议对已绑定原候选的公共读取进行有截止时间的重试，完整下载后继续校验原 SHA-512；失败只恢复相应 job。
- `website/product`：当前版本提交会提前触发官网，npm 未晋级时失败，晋级后需补跑；建议晋级成功自动接续官网部署及正式域名验收。main 版本已经晋级时，普通官网修改仍可独立部署；否则明确等待发布。
- `release/acceptance`：当前部分公开下载、浏览器和证据整理由 agent 在 CI 结束后串行补做；建议将现有检查结果和耗时自动汇总，正式发布记录引用对应 job 的证据。

## 验收标准

- [ ] 任一必需集成组、平台安装或卸载失败/取消/跳过时，latest 不更新。
- [ ] 所有安装和运行测试绑定原 tag、五包摘要及配对二进制；测试组之间使用独立现场。
- [ ] 已公开 beta 的失败恢复只下载原包；不重新构建上传，也不绕过新增集成门禁。
- [ ] 空参数预检和 X.Y.Z-beta.N 预发行仍执行全部四组，不因缺少公共候选或跳过新 job 少测。
- [ ] 临时下载 404 可恢复；鉴权失败、摘要不符及确定性测试失败直接失败；等待有总截止时间。
- [ ] 官网只发布已经晋级的稳定版本，旧任务不会覆盖更新的 main；正式域名文件和浏览器检查自动执行。
- [ ] 同类真实发布记录各阶段耗时、排队、重试与 runner 使用量；预计目标和实测结果分开记录。

## 依据

当前实现与实测耗时见 [Research](research.md)，推荐方案见 [Technical](technical.md)。现有授权允许主 agent 制定工程细节；本轮以用户“先给方案”的范围为限，实施未开始。

## 协作资源

- [1.1.4 发布流水线](https://github.com/iTgo-lyq/runweft/actions/runs/38241538144)（2026-10-12）：成功链路 31 分 15 秒，包含一次平台下载失败后的恢复；本地归档保存原始证据。
- [GitHub 可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)（2026-10-12）：调用方上下文会影响 tag 与 main 部署；评审后选择复用现有 main dispatch 入口。
- [GITHUB_TOKEN 触发规则](https://docs.github.com/en/actions/concepts/security/github_token)（2026-10-12）：允许以仓库 token 触发 workflow_dispatch，无需增加长期 PAT。
- [GitHub 重跑规则](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)（2026-10-12）：失败 job 可单独重跑；仍使用原事件 SHA/ref，更新验证脚本后的恢复继续走现有 main 手动入口。
