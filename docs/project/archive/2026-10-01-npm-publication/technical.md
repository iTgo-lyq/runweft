# npm 首次公开发布技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-10-01

## 现状与方案

真实发布在额外认证通过后返回 E413，Linux x64 压缩包 207306850 字节未被接受；该次失败后没有成功发布的包。调查发现每包的 HAPI 源码归档含约 99 MB 的十份、五平台 ripgrep/difftastic 预编译压缩包。HAPI 构建仅检查所选平台的两份工具，Bun 的 HAPI_TARGET feature 选择对应嵌入分支。

修正打包：从固定 Git revision 列出所有文件，仅省略其他平台的工具 `.tar.gz`，保留全部源码、许可证及当前平台两份预编译工具；每平台生成自己的 `hapi-source.tar.gz`。SOURCES.txt 写明范围、当前平台重建方式与完整 Git 来源。包生成 manifest 增加既有 Runweft 仓库 URL，为 npm 产品页与后续可信发布提供正确来源。新增归档脚本纳入冻结输入。

验证源码归档的文件集合和每个 Git blob 与 pin 一致，并从缩减归档真实交叉编译四个平台 CLI（无 Web 资产的构建验证不冒充整包运行验收）；发布候选仍使用原缓存 HAPI，四平台 Runweft/HAPI/Skill 必须与原验收 hash 一致。修正属于既有需求内的打包工程决定，按持续授权确认；不重复 Plan 评审。

包内 `docs/usage.md` 原有“当前不公开 npm 发布”与目标矛盾。先补公共 npm 安装方式并提交，再在干净源码上用现有 `package --all --reuse-hapi` 重建五包，重新运行 `test:packages`、`test:install` 和 dry-run。对比四平台 Runweft/HAPI 程序 hash，只有与既有候选逐字节一致时才能沿用既有模型验收；发生程序变化时补做受影响的原生验收。原离线整包保留原候选与验收事实，本次发布使用新的 `dist/packages/index.json` 和对应绝对 tarball 路径。

源码工程的 `private: true` 不变，直接发布生成包。产品 Skill 已在主包和平台包内，不新增独立 npm 包或安装副作用。每条 npm 命令显式带 `--registry=https://registry.npmjs.org/`，同时使用专用 userconfig、空 globalconfig，清除 `npm_config_*` 环境变量；先记录实际 registry。发布标签为 `latest`。

准备阶段调用 `assertFrozenCandidate`，核对 SHA256SUMS、五个包的 SHA-512、tarball 内 manifest 与 Skill，并对实际 tarball 执行 `npm publish --dry-run --ignore-scripts --json`。预演不证明 registry 会接受包大小或授予名称。

登录写入 `.dev-smoke/npm-publication/npmrc`（权限 0600），不写用户默认 npm 配置，不记录凭据。用户在官方 npm 页面完成认证；登录后通过 `npm whoami` 确定实际发布账号。用户在发布期间需在线完成可能的额外 2FA，使用 CLI 提供的官方流程，不能绕过。完成后清理本次专用登录凭据。

先按 Linux x64、Linux arm64、macOS x64、macOS arm64 顺序发布平台包，逐个读取公共版本的 `dist.integrity` 并与索引比较。npm 返回成功但提示后台处理中时保存已接受回执、不重传，可继续上传其他平台包；主包前有界轮询处理中的依赖，四个依赖均公开确认后才发布主包。体积最大的包先验证 registry 接受情况；发生 413 时停止并重新评估压缩/打包，不将预演当上传成功。

## 失败与恢复

每次上传前重新核对本地 sha512 并查询确切版本：404 才执行发布；已存在且完整性一致时复核发布事实；存在但完整性不同则停止。网络中断或 E403 先读取 registry 版本与完整性，不盲目重发。读取新版本使用 prefer-online 或无缓存 HTTP，并有界等待公共可见。2026-07-28 官方说明 npm 会先扫描后开放安装，通常约五分钟，大包可能十五分钟或更长；一次成功上传不等于公开确认，处理中出现 404 不触发重传。任一平台失败时保留已发布事实，主包暂不发布；主包被拒也保留已发布平台包，不自动 unpublish，不改版本掩盖失败。

## 验证

上传后核对五个 `latest`、版本、`dist.integrity`、主包精确可选依赖及无认证可下载的 tarball hash。专用空 npmrc、cache、prefix 从公共 registry 安装 `runweft@1.1.0`，核对 CLI `--version`、相邻 Runweft/HAPI 程序 hash、Skill 文件和 MCP 命令帮助；不重跑已有完整模型验收。将证据保存到 `.dev-smoke/`，发布事实写入本 Change。

## 外部前置条件

- npm 登录；负责人：用户；官方浏览器授权已完成，专用 npm 配置的 `npm whoami` 为 itgo-lyq；发布时额外认证按实际 CLI 提示处理。
- 发布验证；负责人：agent；registry 拒绝名称、权限、认证或包大小时记录具体错误，保留实际未完成状态。

后台处理依据：[npm 发布扫描公告](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)（读取 2026-10-01）。
