# 接入调查

## 已确认事实

- 原始 Runweft 基线为 `23ca1d4`。39 个 archive 均有 Requirement、Technical、Plan、Execution，原 Requirement 和任务均记录已完成；另有 release-throughput 方案草稿，用户已明确搁置。
- 历史特殊任务为 task-artifact-delivery 的 T4b/T5b、unified-cli-and-deployment 的 T4.1、website-cloudflare-pages 的 T3.1、test-backbone-slimming 的 T4V。部分 Plan 任务书写顺序与编号不同，需保留原依赖，而非按数字重新解释历史。
- hub-host-cleanup 的原验收明确“无需同步 Specs”，应迁为 not_needed。所有历史验证限制继续以原 Acceptance/Execution 为准。
- GitHub API 返回默认分支 main、protected=false；目前没有本地 core.hooksPath。SpecTrail setup 检查为 ready，hook 为 unverified，后者需要实际提交验证。
- SpecTrail 本地分发与公开远端 HEAD 均为 `67984848b4b3248cddc1dd0258dfba55d1a2ff6f`。原样分发的 setup 测试 10/10 通过。
- Runweft 产品源码未改时的基础检查：typecheck、260 项根测试（4890 断言）和 build 均通过。测试只运行 `./test`，未执行 HAPI 测试或真实模型。

## 原型与托管

当前 Hub 使用原生 DOM 组件和单独 CSS，已有任务、机器、Runtime、Agent、仓库、个人选择与成员视图。原型可独立保存页面代码快照并替换数据入口，无需引入 React 或复制后端。

open-folio 的 R2 适配器使用条件创建、既有字节对比、公开读取验证和固定 requestId 目录；截图工具在 allow-scripts iframe 中运行。其包内相对 skill 路径需按 Runweft 目录校正。

本机已有 `~/.config/open-folio/r2.env`，通过 SDK 注入而未打印秘密值。HeadBucket 实测通过；查询生命周期配置返回 403 AccessDenied，因此不能确认管理员是否设置自动删除策略。Runweft 发布器只在 `runweft/` 前缀新增不可变对象，不删除或覆盖历史。当前原型托管选择为 custom/R2，未将开发机 OpenFolio 服务地址推断为稳定工作台地址。

## 评审执行限制

首次 iclaude Plan 评审启动后，模型服务连续返回 503 `No available accounts`，退出 1，未产生评审意见。错误没有明确说明额度耗尽。2026-10-12 用户在当前会话明确回复“允许本次改用独立 subagent（推荐）”，本次 Plan 及最终独立复核采用该例外，不改写全局评审规则，不将失败请求记为评审通过。
