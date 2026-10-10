# 1.1.2 发布技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-10-10

## 发布路径

本地输入核对、编译检查完成后，将独立 HAPI 仓库 main 快进到 8f774b9413fd483bc163cc06425d7646f10a7c92 并推送，确保 Runweft CI 能取得固定子模块。不发布 HAPI 独立版本；Runweft 继续附带固定 HAPI 0.30.7。

根工程版本、README 常规安装和使用说明统一为 1.1.2，历史 1.1.0 离线附录保留。执行类型检查、根 ./test、Node 检查和本机编译；正式候选由现有 npm-publish.yml 复用 cli-install.yml 一次构建，完成四平台安装和全部无模型集成。

沿用上次正式发布顺序：先推送不可变 v1.1.2 tag，原工作流通过后使用 GitHub OIDC 上传四个平台并确认公开，再上传主包。公共 npm 验收后推送 Runweft main，避免官网在包未公开时失败。发布前确认目标版本五包不存在、远端 tag 不存在。

读取同一 run 的候选索引、manifest、publication/OIDC 回执，匿名下载校验 SHA-512。使用现有网站 Playwright 自动验收执行真实 DOM 命令，安装到专用 npm prefix/config/cache，核对版本、程序/HAPI 摘要与原候选、当前 Skill。main 推送后取得生产 Pages 回执及静态文件，验证唯一部署 URL、正式域名八文件 MIME/SHA-256 与三页浏览器行为。

## 冻结与失败处理

tag 后保持 scripts/fixtures/release-inputs.mjs 的 packageInputs 与原候选无差异，只提交未打入包的验收记录和 Specs。tag、公共版本和原候选不覆盖。上传未知时先核查原回执及 registry，明确可恢复后只重跑原 run 的失败 job；不重跑整个 run 重建同版本。实现缺口先定位，不能通过降低验收条件发布。

HAPI 与 Runweft main 使用正常快进，不 force push；推送前再次 fetch 核对祖先关系。CI/匿名安装仅使用专用数据和配置，凭据由托管工作流注入，不读取或记录其值。当前格式基线沿用已验收规格，不新增历史迁移。

## 评审后的执行边界

两个 main 若不可快进，先保留 tag 和现场并重新调查，不 rebase、force push 或纳入未验证内容。最终记录只改 docs/project 和 docs/README.md，避免重触发 Pages；推送后断言 v1.1.2 为 origin/main 祖先。当前 46 个提交包含首次远端执行的 CI 瘦身流程，发布绑定仍为 npm-publish.yml/无 environment，本次实际 tag run 才是其远端发布证据。

未产生任何上传的候选基础设施瞬时失败可在确认 registry 五包版本不存在、原回执无上传后重跑构建，记录新 attempt/候选；一旦上传只能恢复原 publish job。包输入缺陷使用下一版本，不移动已推送 tag。公开后安装失败不推 main，保留回执并调查；不擅自回退 dist-tags。

数据格式兼容不增加为本轮前提：用户已确认尚无其他部署、以当前格式作为首次部署基线，历史格式明确拒绝并保留原文件；使用说明已经要求先结束任务、重启对应角色。Runweft 版本从 1.1.1 升至 1.1.2，运行期版本诊断可以提示旧服务；HAPI 版本相同不能代替修订/摘要核验。匿名 DOM 安装读取 tag 对应本地站点，Skill 来自 npm 包内；最终公开记录保存实际完整性和部署摘要，不只引用短期产物链接。
