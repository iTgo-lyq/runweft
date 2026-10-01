# 官网 Cloudflare Pages 技术方案

> 来源：./requirement.md
> 状态：已确认

## 端到端方案

新增独立 website-pages.yml，push main/codex/** 按 website、package.json、docs/usage.md、本次 website/publish.mjs、website/publish.test.mjs、scripts/npm-publish.mjs 和工作流过滤；pull_request 仅检查；workflow_dispatch 按所选允许分支部署。生产分支固定 main，开发分支显式传入原分支名。并发同分支串行，不在上传中途取消；不运行 npm 发布或 HAPI 构建。

Node 24 复用既有固定 action SHA。官网构建后使用无第三方依赖的脚本验证 npm 安装元数据、输出不含归档/源码，以及公共 registry 的五包版本、完整性字段和主包精确可选依赖。缺包或异常明确失败。五个 tarball 用 HEAD 验证公开可访问，不下载程序。官网新版本先于 npm 时停止；发布后对最新分支运行，生产上传前确认工作流 SHA 仍是 main 当前头。

GitHub Secrets 引用 CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN；CLOUDFLARE_PAGES_PROJECT 可用仓库变量覆盖，默认 runweft。凭证缺失时检查仍执行、上传明确跳过，job summary 标记未部署和缺失名称。配置只记录引用，不记录秘密值。

上传前直接读取 Cloudflare Pages 项目。只有明确不存在才创建 Direct Upload 项目，production_branch=main；已存在项目须为 Direct Upload 且生产分支相同，拒绝自动修改现有项目或默认分支。创建响应未知时抛错，不盲目重发。同一 job 构建、检查并上传同一目录，权限只有 contents:read；不传 gitHubToken。使用官方 wrangler-action 固定 SHA，Wrangler 固定公开 4.146.0，显式 packageManager=npm，在 RUNNER_TEMP 下建立自有 private package.json 的专用工具目录，上传绝对 dist/website 路径并传入实际 branch/commit。凭证仅进入 Pages 准备步骤环境与 action 输入。

部署 URL 只使用 Pages 返回值，后续 HTTP 自动验证 release.json 与本次本地元数据一致、三页可访问/无下载入口/首页含 npm 命令，并核对全部输出文件摘要及 MIME；跟随同一 Pages 域内规范化重定向，GET 传播等待有界，不重新上传，写入无秘密验收记录及 job summary。采用唯一部署 URL，核对 action 返回的 preview/production；托管 runner 验证与实际 Cloudflare 上传分别记录；不由本地伪服务代替外部验收。

## 外部前置条件

用户负责将两个 Cloudflare 凭证写入本仓库 Actions Secrets，并回复就绪；Agent 已提出具体填写方式并继续本地工作。项目名可以用户覆盖，账户权限按真实响应核对。凭证缺失不影响代码实现和本地检查，影响真实上传。main 当前尚无产品源码与工作流；生产自动部署/手动入口在后续合码后生效，本轮不合入整个产品。

## 验证

Node 标准测试覆盖事件分流、npm HTTP 成功/缺包/不一致/异常、输出拒绝、Pages 读/新建/权限错误/已有分支不一致以及在线页面检查。复用 buildSite 在专用夹具构建，错误检查不得写入部署输出。工作流 YAML/权限检查，typecheck、根测试、官网 build 和真实公共 registry 检查；页面无改动，不重复下载 CLI 或重跑既有网页交互验收。

## 评审后决策

2026-10-02 同一次 iclaude 会话评审完成。采纳凭证步骤隔离、单 job、临时目录自有 package.json、静态白名单、tarball HEAD、在线传播/重定向/MIME 和 main 当前头检查，以及托管检查/真实上传拆任务。测试使用 Node 内置 runner 放在 website 下：无需增加 Bun 安装，仍在 Pages CI 执行，避免无关四平台发行流水线。复用 npm 常量；既有 metadata 是私有上传实现，不为网站修改该模块，网站另有 HEAD 就绪语义。只按明确 HTTP 404 创建，不猜测官方文档未给出的错误码；真实 API 响应需 T3 核对。
