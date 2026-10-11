# 1.1.2 正式发布计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 状态：执行中
> 执行模式：逐任务提交

## 交付目标

两个仓库 main 推送、v1.1.2 四平台候选和五包上传、匿名安装及生产官网验收完成，记录实际来源与范围。

2026-10-11更新：先发布beta，从公共npm做四平台验收后晋级latest；原tag不移动，发布/官网不依赖artifact。T1已完成记录保留，先执行新增T5，再恢复T2/T3/T4。

## 决策与风险

两个main与不可变tag已推送。更新后的main工作流显式恢复原tag，beta上传同job构建的候选；四平台从公共npm安装精确版本后才晋级latest。不重发未知或部分上传；日志、任务输出与仓库摘要保留证据，不使用artifact；本轮不继承旧版本模型或物理跨机证据。更新Plan完成一次iclaude评审，由主agent判断落实。

## 任务

### T1 准备版本输入并推送 HAPI

- 状态：已完成
- 交付：HAPI main 可取得固定 revision；版本/常规说明统一 1.1.2，保留历史离线附录，Plan 评审完成。
- 依赖：无
- 验收：远端 HAPI main 等于固定 revision，版本五包及 tag 尚不存在，提交后源码干净。
- 验证：远端祖先关系；类型检查、根 ./test、Node 检查、本机 build/版本与官网 build；git diff。

### T2 可信发布及匿名安装

- 状态：进行中
- 交付：不可变v1.1.2、更新工作流dispatch的候选日志描述、五包beta/四平台公共安装/latest晋级和匿名安装证据。
- 依赖：T1、T5
- 验收：四平台矩阵和晋级job成功，五包latest/元数据/SHA-512与beta候选相同；Linux x64安装、Skill、配套HAPI校验通过。
- 验证：tag/source与控制提交映射、候选日志、匿名registry下载/安装、Playwright DOM命令、冻结源码检查；不覆盖旧dist/packages。不再重跑旧artifact发布run38041451856。

### T3 推送 Runweft main 与官网验收

- 状态：已阻塞
- 交付：main 已快进推送，生产官网指向 1.1.2。
- 依赖：main推送按明确授权先完成；官网部署仍依赖T2
- 验收：main CI 和 Pages 成功，production 回执、唯一 URL/正式域名八文件与三页浏览器检查通过。
- 验证：fetch/正常推送，packageInputs与tag无差异；最新main工作流日志、对应源码静态构建、HTTP摘要和Playwright。

### T4 同步 Specs 并归档

- 状态：待开始
- 交付：当前发行事实、验收记录、脱敏证据及完整归档。
- 依赖：T3
- 验收：需求映射真实证据，远端本地 main 一致，工作区干净。
- 验证：Change 结构、链接、git diff 与冻结包输入；最终文档提交推送及其必要 CI。

### T5 改造beta验收及latest晋级

- 状态：已完成
- 交付：原tag恢复入口、同job构建/beta上传、公共npm四平台安装矩阵、OIDC晋级、无artifact的CI/Pages证据。
- 依赖：T1
- 验收：源码/tag/五包摘要绑定，安装失败不晋级；partial/未知上传不重建重发，标签授权错误可操作；工作流无安装包/回执artifact依赖。
- 验证：当前工作区一次iclaude更新Plan评审；发布/恢复/晋级/摘要冲突与矩阵门禁的Node检查、actionlint、类型/根测试；专用公共npm安装等价验收，然后真实工作流恢复v1.1.2。任务实现提交后继续T2实际发行，不把本地夹具当真实发布结果。

## 整体验证

发布、安装、官网均由 agent 自动验收，只有实际成功结果写入 Specs；未执行范围继续明确记录。
