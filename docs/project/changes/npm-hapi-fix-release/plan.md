# 1.1.2 正式发布计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 状态：执行中
> 执行模式：逐任务提交

## 交付目标

两个仓库 main 推送、v1.1.2 四平台候选和五包上传、匿名安装及生产官网验收完成，记录实际来源与范围。

## 决策与风险

HAPI 先推送；Runweft 先 tag 发布、公共安装验证后推送 main。冻结同一候选，不重发未知上传；最终文档仅修改不触发 Pages 的项目记录和 Specs，推送后断言 tag 为 main 祖先；本轮不继承旧版本模型或物理跨机证据。持续授权覆盖方案和验收，Plan 完成后一次 iclaude 评审并由主 agent 判断。

## 任务

### T1 准备版本输入并推送 HAPI

- 状态：已完成
- 交付：HAPI main 可取得固定 revision；版本/常规说明统一 1.1.2，保留历史离线附录，Plan 评审完成。
- 依赖：无
- 验收：远端 HAPI main 等于固定 revision，版本五包及 tag 尚不存在，提交后源码干净。
- 验证：远端祖先关系；类型检查、根 ./test、Node 检查、本机 build/版本与官网 build；git diff。

### T2 可信发布及匿名安装

- 状态：已阻塞
- 交付：不可变 v1.1.2、成功原 run、原候选五包及公开安装证据。
- 依赖：T1
- 验收：四平台安装通过，publication success=true/五包 confirmed，公开 latest/元数据/SHA-512 与候选一致；Linux x64 安装、Skill、配套 HAPI 校验通过。
- 验证：原 tag push/SHA/候选/回执、匿名 registry 下载、现有 Playwright DOM 安装与冻结源码检查；不覆盖旧 dist/packages。复查main CI暴露的准备释放测试时序问题只修正测试等待条件，定向复现、重复验证及完整根测试后提交，packageInputs继续冻结。

### T3 推送 Runweft main 与官网验收

- 状态：已阻塞
- 交付：main 已快进推送，生产官网指向 1.1.2。
- 依赖：main推送按明确授权先完成；官网部署仍依赖T2
- 验收：main CI 和 Pages 成功，production 回执、唯一 URL/正式域名八文件与三页浏览器检查通过。
- 验证：fetch/正常推送，packageInputs 与 tag 无差异；原工作流/回执、HTTP 摘要和 Playwright。

### T4 同步 Specs 并归档

- 状态：待开始
- 交付：当前发行事实、验收记录、脱敏证据及完整归档。
- 依赖：T3
- 验收：需求映射真实证据，远端本地 main 一致，工作区干净。
- 验证：Change 结构、链接、git diff 与冻结包输入；最终文档提交推送及其必要 CI。

## 整体验证

发布、安装、官网均由 agent 自动验收，只有实际成功结果写入 Specs；未执行范围继续明确记录。
