# 1.1.2 HAPI 修复正式发布

> 状态：进行中
> 规模：中型
> 更新：2026-10-11

## 目标与授权

用户要求“推送合入main触发发布吧”。将当前已验收源码及配套 HAPI 修复推送各自 main，沿用稳定 tag/OIDC 发布 Runweft 1.1.2，更新正式官网。既有授权覆盖方案、Plan 工程决策、逐任务提交与自动验收；Plan 在当前工作区完成一次 iclaude 评审，不重复人工门禁。

## 行为变化

### MODIFIED

- `release/distribution`：五个公共 npm 包 latest 从 1.1.1 更新为同候选 1.1.2，包含当前源码、数据格式基线及 HAPI 8f774b9413fd483bc163cc06425d7646f10a7c92。
- `installation/cli`、`installation/skill`：公开安装 1.1.2，配套当前 Skill、使用说明和 HAPI 0.30.7。
- `website/product`：正式官网安装命令、Agent 对话和指南指向已公开的 1.1.2。

## 验收标准

- [x] HAPI main 包含固定修复 revision；Runweft main 包含当前全部已验收提交与 1.1.2 输入，推送后远端与本地一致。
- [ ] v1.1.2 触发四平台候选和实际安装验证、五包可信上传；原候选和回执可追溯。
- [ ] 公共五包 latest=1.1.2，公开 tarball 完整性匹配原候选；专用 Linux x64 匿名 npm 安装、版本、Skill、配套 HAPI 检查通过。
- [ ] main CI、生产 Pages 和正式域名三页/资源自动验收通过，Specs 与发行事实同步并归档。

## 依据与范围

远端 Runweft main 可快进到当前本地 main（46 个待推送提交）；HAPI main 可快进到固定 revision（20 个提交）。公共五包 latest 均为 1.1.1，远端仅有 v1.1.1。Claude 长路径、Runner 正常/失联/撤权退出及真实两轮已在前一 Change 验收；本轮验证发布与安装，不重复模型调用，不生成新离线整包，不修改用户原生配置。物理跨机、Mac 模型与 arm64 模型范围仍以各原验收为准。
