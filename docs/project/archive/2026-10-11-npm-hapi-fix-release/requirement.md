# HAPI 修复与 macOS 数据库校验正式发布

> 更新：2026-10-11

## 目标与授权

用户要求“推送合入main触发发布吧”。将当前已验收源码及配套 HAPI 修复推送各自 main，沿用稳定 tag/OIDC 发布 Runweft 1.1.2，更新正式官网。既有授权覆盖方案、Plan 工程决策、逐任务提交与自动验收；Plan 在当前工作区完成一次 iclaude 评审，不重复人工门禁。

2026-10-11用户确认改为先上传beta、从公共npm做四平台自动验收，通过后再切latest；发布不再依赖Actions安装包或回执artifact。继续本次1.1.2发布，需要额外npm权限时提供准确的账户操作。

2026-10-11原1.1.2五包beta已公开，Mac原生安装暴露数据库校验失败；保留不可变tag/包和全部失败证据，用新补丁1.1.3完成修复后发行。现有数据格式19/1和配置1不变，不引入迁移。工程修正与新版本沿用用户既有授权。

## 行为变化

### MODIFIED

- `release/distribution`：五个公共 npm 包 latest 从 1.1.1 更新为修正候选 1.1.3，包含当前源码、数据格式基线及 HAPI 8f774b9413fd483bc163cc06425d7646f10a7c92。
- `installation/cli`、`installation/skill`：公开安装 1.1.3，配套当前 Skill、使用说明和 HAPI 0.30.7。
- `website/product`：正式官网安装命令、Agent 对话和指南指向验收通过的 1.1.3。

- `deployment`：私有数据库验证副本支持macOS无边文件WAL；原数据库、身份与当前格式不变。

## 验收标准

- HAPI main 包含固定修复 revision；Runweft main 包含当前全部已验收提交与 1.1.2 输入，推送后远端与本地一致。
- 不改动v1.1.2；修复macOS数据库副本校验后，可信工作流构建新的v1.1.3固定源码，五包先上传beta，四平台从公共npm安装精确版本、验证完整性/二进制/服务后才能更新latest。
- 发布与官网流程不上传或下载Actions artifact；来源、五包摘要、验收与标签结果在任务日志/摘要及仓库验收记录中可追溯。
- 公共五包 latest=1.1.3，公开 tarball 完整性匹配原候选；专用 Linux x64 匿名 npm 安装、版本、Skill、配套 HAPI 检查通过。
- main CI、生产 Pages 和正式域名三页/资源自动验收通过，Specs 与发行事实同步并归档。

## 依据与范围

远端 Runweft main 可快进到当前本地 main（46 个待推送提交）；HAPI main 可快进到固定 revision（20 个提交）。公共五包 latest 均为 1.1.1，远端仅有 v1.1.1。Claude 长路径、Runner 正常/失联/撤权退出及真实两轮已在前一 Change 验收；本轮验证发布与安装，不重复模型调用，不生成新离线整包，不修改用户原生配置。物理跨机、Mac 模型与 arm64 模型范围仍以各原验收为准。
