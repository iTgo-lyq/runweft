# npm 首次公开发布

> 状态：进行中
> 规模：中型
> 更新：2026-10-01

## 目标与范围

用户要求将安装包发布到 npm，优先使用 `runweft`。发布 1.1.0 主包和四个平台依赖，使用户能通过公共 npm 安装 CLI，并取得随包的产品 Skill。本次补齐随包 npm 安装说明、发布和公共 registry 安装验证；官网托管继续独立处理。

需求与工程方案按 AGENTS.md 的持续授权确认；用户本轮明确授权公开 npm 发布。公开包内容取已验收发行，不修改当前用户的原生配置或模型凭据。

## 行为变化

### MODIFIED

- `release/distribution`、`installation/cli`：当前只有本地可发布的五个 1.1.0 包；目标为公共 npm 的同名同版本包，支持 `npm install -g runweft@1.1.0`，四个平台依赖均可解析。

## 验收标准

- [ ] 五个包的公共版本、完整性和主包依赖与发行索引一致。
- [ ] 专用目录从公共 npm 安装，CLI 版本、配套程序 hash 与 Skill 内容正确；不改用户全局安装或配置。
- [ ] 记录实际发布账号、版本和验证证据，更新当前发行事实。

## 可行性与依赖

2026-10-01 对五个完整包名的 registry 查询均返回 404，当前未收录；名称能否首次发布仍以认证后的 registry 结果为准。既有候选来自干净源码 `657550f20d44d1a65a48b232ef13f3ca5160e8cd`；随包说明仍指向私有 registry，需要在首次发布前更正并重建候选。本机 `npm whoami` 返回 ENEEDAUTH；用户须完成官方网页登录，认证成功后 agent 继续发布。

## 协作资源

- [npm 公开包发布](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)（读取 2026-10-01）：无 scope 包公开发布；发布需要账户认证与相应 2FA 验证。
- [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)（读取 2026-10-01）：支持发布已有 tarball、dry-run；同名同版本不能覆盖。
- [npm login](https://docs.npmjs.com/cli/v11/commands/npm-login/)（读取 2026-10-01）：通过官方浏览器流程取得 CLI 登录授权。
