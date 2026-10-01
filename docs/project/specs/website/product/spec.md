# 产品官网与安装

Runweft 官网是独立静态站点，不与业务看板或 HAPI 服务混用。首页以“交给 Agent 完成接入”为主入口，提供可复制对话，介绍 Codex/Claude Code、任务委派、独立工作区、会话留存和 Git/附件回收。委派必须连接 Hub；local 仅表示可托管本机 Hub，不是离线 Agent 模式。本地/远端协作图是明确标注的交互示意。

## npm 安装

所有支持的平台使用同一条固定版本 npm 命令，注明 Node.js 20+、npm、任务所需 Git 与原生工具。npm 自动选择 macOS arm64/x64、glibc Linux arm64/x64 平台依赖，随包提供 HAPI 和 Skill。安装成功后才检查版本；失败不继续运行已有程序。PATH 说明以 npm 全局 prefix 的 bin 为准。

官网不提供平台包、独立 Skill、校验文件或 Markdown 下载，无平台切换解包命令和下载目录。Agent 对话明确程序安装、升级和卸载使用 npm；Skill 从 npm 全局包目录读取，再按授权接入宿主，已有内容先备份和确认。

## 静态交付

website/build.mjs 读取根 package.json 的稳定版本、网站源码和当前使用说明，不依赖 dist/packages 或构建网络。输出仅包含三页 HTML、资源和 release.json；元数据为 version、installation=npm、package=runweft 和公开 registry，不冒充程序候选来源。正式部署前须确认目标版本已公开且可安装。

暂存全部成功后才替换旧输出；非法版本、未知模板占位符失败保留旧站点并清理暂存。参考页转义使用说明，在明确的离线工程附录之前截取。站内页面和资源均使用相对路径，支持根路径和子路径部署。

website/serve.mjs 提供 loopback GET/HEAD 预览，只能读取站点目录。生产可使用常规静态托管；构建和部署说明见[官网说明](../../../../../website/README.md)。站点不含账号系统、遥测或第三方脚本/字体请求。

移动菜单、键盘焦点和 reduced motion 可用。复制失败选中命令并提示手动复制；禁用 JavaScript 后同一 npm 命令和指南仍可读取。Linux x64 已从实际 DOM 执行公共 npm 安装与 Skill 目录命令，三个页面、320–1440px、子路径、复制及失败链路通过，见[npm 安装验收](../../../archive/2026-10-02-website-npm-installation/acceptance.md)。历史下载型网站副本仍保存在原离线整包中。

## Cloudflare Pages 自动部署

website-pages.yml 使用托管 runner 构建、检查公共 npm 版本并上传 Direct Upload 项目；main 的官网相关推送部署 production，codex 分支部署 preview，action 返回环境须与请求模式匹配。生产部署先确认 run 的 SHA 为 main 当前提交，拒绝旧提交覆盖官网。

[正式官网](https://runweft.pages.dev/)已通过[真实 main 推送 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36919283258)，唯一 URL 为 [25a3034a.runweft.pages.dev](https://25a3034a.runweft.pages.dev/)；唯一 URL 与正式域名八文件摘要/MIME、正式域名三个页面的 Playwright 检查通过，静态产物为 91,064 字节，安装版本为 npm 1.1.1。[codex 分支预览](https://codex-cli-foundation.runweft.pages.dev/)的项目创建、后续复用和实际预览证据另见[Pages 验收](../../../archive/2026-10-02-website-cloudflare-pages/acceptance.md)。

准备步骤和官方上传 action 使用 Repository secrets 的 CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN；凭证不写入静态站点或验收 JSON。主包/四平台包的公开版本、SHA-512 字段、精确可选依赖和 tarball HEAD 均通过；不下载程序、不调用 npm 发布。静态输出为八文件白名单，拒绝链接、隐藏文件、归档和未知文件。

校验前保存唯一 URL 与实际环境回执，在约三分钟窗口内重试暂时不可达请求，错误只记录有限网络错误码。在线验证跟随项目域内 HTML 重定向，核对三个页面、release.json、四个资源的 MIME 与 SHA-256；固定构建验收使用唯一 URL。

部署脚本的路由、未公开 npm/错误依赖、Pages 权限/已有配置拒绝、缺凭证与失败回执通过 13 项聚焦测试。PR 只检查，手动入口按分支路由；这两个入口已配置，真实触发尚未实测。
