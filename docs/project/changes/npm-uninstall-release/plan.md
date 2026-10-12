# 1.1.4 发布计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 状态：执行中
> 执行模式：逐任务提交

## 交付目标

完整卸载代码全部合入 main，1.1.4 经 beta/四平台实际完整卸载/latest 发布，官网与当前事实同步。每个 Plan 形成后在当前工作区交由 iclaude 评审一次，主 agent 独立判断落实；沿用自动验收授权。

## 任务

### T1 准备并验证 1.1.4 输入

- 状态：已完成
- 交付：版本/说明/Skill/官网文案；让已有 uninstall smoke 接受公共下载候选并接入四平台矩阵；一次 iclaude Plan 评审。
- 依赖：已归档 complete-uninstall
- 验收：保护边界与已验证行为保持，包源码一致，本地工作区可冻结。
- 验证：typecheck、根 ./test、Node 发布检查、build、Linux 专用完整卸载、官网构建/Playwright、diff。

### T2 合入主干并正式发布

- 状态：进行中
- 交付：main 完整快进、不可变 v1.1.4、真实 beta/四平台安装与完整卸载/latest。
- 依赖：T1
- 验收：四平台新命令通过才晋级；五包公开元数据/摘要匹配，Linux 匿名安装/Skill一致。
- 验证：远端祖先/提交、原 CI 输出、匿名 npm 查询与下载；未知/部分上传不重发。

### T3 官网部署、同步 Specs 与归档

- 状态：待开始
- 交付：生产官网 1.1.4、验收与脱敏证据、当前 Specs、完整归档。
- 依赖：T2
- 验收：Pages、正式域名文件/三页验证通过；本地/远端 main 一致、工作区干净。
- 验证：最新 main CI、官网回执/HTTP/Playwright、文档结构/链接、packageInputs 与原 tag 一致。
