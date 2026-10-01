# 官网 Cloudflare Pages 自动部署

> 状态：进行中
> 规模：中型
> 更新：2026-10-02

## 目标与范围

用户确认官网使用 GitHub Actions 部署 Cloudflare Pages，使用 Technical 中的生产/预览事件规则；npm 正式发布仍独立由稳定版本标签触发。配置构建、发布前检查和生产/预览分流，并在凭证就绪后实际验证上传与在线页面。

生产以 main 为准，codex/** 推送生成预览；手动运行按选择的分支执行，不把开发分支冒充生产。只上传 npm 安装静态站点，不携带程序包、源码或用户配置。Pages 项目默认 runweft，已有项目可由用户指定；不更改仓库可见性、默认分支或既有 npm 发布规则，不在本 Change 自动合入整个产品到 main。

工程方案、逐任务提交、iclaude Plan 评审和本地自动验收沿用 AGENTS.md 持续授权。Cloudflare Token 由用户保存到 GitHub Secrets，聊天和文档不记录秘密值。

## 行为变化

### ADDED

- `website/product` — 自动部署：官网相关源码变更触发独立构建与发布检查，main 部署生产，codex/** 部署分支预览；PR 仅检查。
- `website/product` — npm 就绪检查：发布前确认对应版本五个公共 npm 包、tarball 可访问及主包的平台依赖一致；缺少或错误版本不上传。
- `website/product` — Pages 接入：凭证来自 GitHub Secrets；使用专用 Pages 项目，校验生产分支，公开部署结果有明确 URL 并自动核对三页与安装元数据。

### MODIFIED

- `website/product` — 部署说明：从手工复制静态目录增加 CI 配置、凭证要求、触发/恢复步骤和实际验证范围。

## 验收标准

- [ ] 事件路由与 YAML 覆盖 main/codex/**、手动、PR、tag 和未知分支；本轮实际触发只验证当前 codex 分支，main/手动/PR 待合码后实测。
- [ ] npm 缺包、版本/依赖不一致、网络异常、静态输出异常在上传前停止；缺凭证明确说明未部署。
- [ ] Pages 项目只在不存在时创建，已有非 main 生产分支明确拒绝；上传来源/分支明确，凭证不进入日志或产物。
- [ ] 本地聚焦测试、构建、真实公共 npm 检查及托管 runner 检查通过；凭证就绪后实际预览部署与在线页面校验通过，生产和未合码边界如实记录。
- [ ] 操作说明与已验证 Specs 同步，逐任务提交并推送；外部条件未就绪时保留未完成任务，不冒充已上线。

## 协作资源

- [Cloudflare CI 直接上传](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)（2026-10-02）：官方支持 GitHub Actions + Wrangler，Token 权限为 Account/Cloudflare Pages/Edit。
- [Wrangler Action](https://github.com/cloudflare/wrangler-action)（2026-10-02）：支持显式 branch、Pages URL 输出及 npm packageManager；v4 当前指向 953926a2e2182532811c01a25e53647d93bf07c0。
- [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)（2026-10-02）：项目生产分支由项目配置决定，非生产分支为预览；本轮不切换 Git Integration。
