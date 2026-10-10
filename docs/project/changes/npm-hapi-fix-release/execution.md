# 1.1.2 发布执行记录

## Plan 评审

iclaude 在当前工作区完成一次无工具、无持久会话评审：退出0、is_error=false、199881ms。正常路径无硬阻塞。采纳首次远端 CI 事实、tag/main 祖先断言、冻结输入/最终文档路径限制、公开失败停止部署、候选上传前与部分上传恢复区分、长期保存摘要及 npm 包内 Skill 来源。当前 run 预期产物少于30个，不为假设分页问题改工作流；已有专用 HOME/npm配置和原生重启说明继续复用。拒绝把历史数据兼容设为补丁发布门禁：用户已明确首次部署基线和无其他机器部署，旧格式拒绝行为已单独验收，不新增迁移。

## T1 准备版本输入并推送 HAPI

HAPI main 从86c88df9快进到8f774b9413fd483bc163cc06425d7646f10a7c92并正常推送，根gitlink/固定revision一致，CLI仍为0.30.7。未创建HAPI发布tag。根版本和常规README/使用说明为1.1.2，历史离线1.1.0保留。五包1.1.2均404、远端v1.1.2不存在。

类型检查、248项根 ./test（41文件、4798断言、0失败）、33项Node检查、本机build通过，程序报告1.1.2，官网八文件静态校验通过。相比v1.1.1，CI增加按diff普通检查、正式候选一次构建全无模型集成，npm工作流移除分支上传预演、增加Beta通道规则；OIDC绑定文件名/无environment保持一致，首次远端执行在本次tag确认。

- Commit：`npm-hapi-fix-release T1: prepare verified 1.1.2 release inputs`

## T2 可信发布及匿名安装

v1.1.2为annotated tag，固定源码ee66fe08c549908e1a49555c2ec0cc842b63d6c8；push run 38041451856执行了本次新版CI。远端248项根测试、33项Node检查、四平台构建、access/storage/web/service-package全部通过（Linux候选集成09:31:13Z–09:39:41Z）。失败发生在两个upload-artifact步骤：Artifact storage quota has been hit；候选和29份证据未能上传，Mac/arm64安装与publish被跳过。不能把这些未执行步骤记为成功。

公共五包1.1.2不存在，未产生上传或回执，原tag不移动；按用户明确要求先推送Runweft main，生产官网部署仍等待公共包。远端24个历史产物共约1.778GiB，其中四个npm-candidate约477MB/份，完整备份和ZIP/hash核验正在进行；远端删除未执行。清理远端产物超出此前仅当前机器历史环境清理的授权，需要明确范围。GitHub额度统计可能6–12小时更新，更新后可按本方案恢复未上传候选。原失败日志保存在.dev-smoke/npm-hapi-fix-release/ci-build.log。

## T3 推送 Runweft main 与官网验收

首轮发布失败仅为产物上传额度，产品和Linux全部集成已通过。按用户要求先正常推送main；官网公共npm门禁将阻止1.1.2部署，正式站点保留上一版本。T3的部署/整体验收尚未完成。

- Commit：`npm-hapi-fix-release T2: record artifact quota blocker and main handoff`

## T4 同步 Specs 并归档

待执行。
