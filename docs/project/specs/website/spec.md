# 产品官网与安装

Runweft 官网是独立静态站点，不与业务看板或 HAPI 服务混用。首页明确 Codex/Claude Code 的任务委派用途，按评审、独立实现、远端测试/构建介绍场景及报告、代码、附件。主入口引导 Agent 接入，npm 手动安装为次入口；首页与指南提供相同的完整接入提示，包含安装与首次只读评审授权。官网导航链接到公开 npm。

委派必须连接 Hub；local 仅表示可托管本机 Hub，不是离线 Agent 模式。本机/远端图是交互示意：本机评审用共享目录、实现用独立 worktree；远端从已提交版本准备独立 worktree。

首页 `#native-experience` 解释 HAPI 驱动原生 Codex/Claude 的执行方式：采用执行机器已有的登录、项目指令、Skill 和其他 MCP，权限沿原生规则，会话和目录跨轮保留。HAPI 会话网页提供消息/工具历史、待审批处理及在线会话文件和 Git 暂存/未暂存差异；新增入口链接到指南的具体步骤。手机使用浏览器，须能访问 Hub 并选择本人身份/空间；不承诺全部 HAPI 客户端或功能已接通。

首页 `#session-screenshots` 将会话/文件预览融入 HAPI 会话介绍块，不显示截图来源或版本免责声明。桌面文案在左、双图在右，800px 及以下文案在上，双图始终并排。预览最大 180×240px，窄屏等比例缩小；CSS 裁切展示主要内容，普通链接打开完整 946×2048 WebP 原图，字节保持不变。图片懒加载并标注固有尺寸，键盘焦点可见，无 JavaScript 可用。

## npm 安装

所有支持的平台使用同一条固定版本 npm 命令，注明 Node.js 20+、npm、任务所需 Git 与原生工具。npm 自动选择 macOS arm64/x64、glibc Linux arm64/x64 平台依赖，随包提供 HAPI 和 Skill。安装成功后才检查版本；失败不继续运行已有程序。PATH 说明以 npm 全局 prefix 的 bin 为准。

官网不提供平台包、独立 Skill、校验文件或 Markdown 下载，无平台切换解包命令和下载目录。Agent 对话用 npm 安装和升级，完整删除使用 runweft uninstall（先预览，确认范围后 --yes）；Skill 从 npm 全局包目录读取，再按授权接入宿主，已有内容先备份和确认。

## 静态交付

website/build.mjs 读取根 package.json 的稳定版本、网站源码和当前使用说明，不依赖 dist/packages 或构建网络。输出仅包含三页 HTML、资源和 release.json；元数据为 version、installation=npm、package=runweft 和公开 registry，不冒充程序候选来源。普通部署前须确认五包 latest 均为目标版本，公开元数据/完整性与精确平台依赖可安装；只有 beta 的稳定候选停止普通部署。绑定正式发行的显式并行模式允许官网先于 npm 可安装状态，最终发布仍等待两端验收通过。

暂存全部成功后才替换旧输出；非法版本、未知模板占位符失败保留旧站点并清理暂存。参考页转义完整使用说明。站内页面和资源均使用相对路径，支持根路径和子路径部署。

website/serve.mjs 提供 loopback GET/HEAD 预览，只能读取站点目录。生产可使用常规静态托管；构建和部署说明见[官网说明](../../../../website/README.md)。站点不含账号系统、遥测或第三方脚本/字体请求。

移动菜单、键盘焦点和 reduced motion 可用。复制失败选中命令并提示手动复制；禁用 JavaScript 后同一 npm 命令和指南仍可读取。

## Cloudflare Pages 自动部署

website-pages.yml 复用规范版本识别，稳定版本使用托管 runner 构建、按入口检查 npm 就绪或正式发行来源，并上传 Direct Upload 项目；main 的官网相关推送部署 production，codex 分支部署 preview，action 返回环境须与请求模式匹配。生产部署先确认 run 的 SHA 为 main 当前提交，拒绝旧提交覆盖官网。仅 codex/** push/dispatch 的 Beta 在聚焦检查后明确跳过构建、准备/上传与静态产物；main 或 PR 的 Beta 版本失败，显式部署复验也拒绝 Beta，真实构建器仍只接受稳定版本。

普通 push 的稳定版本尚未全部晋级时保留静态检查，标记等待发布并跳过上传；普通 PR、手动入口仍要求五包 latest 已晋级。稳定正式发行与 npm 流程并行 dispatch main，显式并行模式核对预期版本、同仓库正在运行的 npm-publish 及来源 run/attempt；push 来源绑定版本 tag，手动来源绑定 main、正式发行模式和版本。仅该模式将 npm 就绪校验留给父流程，允许网站暂时展示尚不可安装的目标版本。发布端绑定实际官网 run 并限时等待完成，最终要求 npm 和官网都成功；任一端失败如实保留，不自动回滚网站。上传前再次确认 main 未推进，拒绝旧版本任务覆盖新网站；已晋级版本的独立官网变更仍可部署。

准备步骤和官方上传 action 使用 Repository secrets 的 CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN；凭证不写入静态站点或验收 JSON。普通上线检查主包/四平台包的公开版本、SHA-512 字段、精确可选依赖和 tarball HEAD；五包 latest 必须与站点版本一致，不下载程序、不调用 npm 发布。静态输出为十文件白名单，拒绝链接、隐藏文件、归档和未知文件。

校验前保存唯一 URL 与实际环境回执，在约三分钟窗口内重试暂时不可达请求与 HTTP 200 的短暂旧内容，最终仍要求精确摘要，错误只记录有限网络错误码及摘要。在线验证跟随项目域内 HTML 重定向，核对三个页面、release.json、六个资源的 MIME 与 SHA-256；生产部署在唯一 URL 通过后还须验证正式域名。随后自动运行三页 1440/390px 的浏览器检查，核对版本、标题、布局、可见图片与页面错误。固定构建验收使用唯一 URL，正式域名失败不得报告整个部署已验证。

手动 verify-run-id 可仅复验已上传部署，跳过 Pages 准备和上传。来源必须为同仓库、同分支 push/workflow_dispatch 的已完成官网 run，实际上传步骤成功且日志保存完整静态检查与上传回执；拒绝 PR/fork、仅复验 run 或当前 Pages 项目不符。当前源码可变化，但版本与全部静态文件须与原部署一致；唯一 URL、环境、正式域名及浏览器检查保留。复验回执标记 uploaded=false/verificationOnly=true，分别记录本次控制源码和原上传 run/attempt/部署源码，不改写原失败记录。

官网使用 Cloudflare Direct Upload，不依赖 Actions artifact；脱敏部署回执、十文件摘要与 URL 保存在日志/summary，专项验收结论另记对应 Change，静态输出按对应提交重建核对。发布/复验使用显式工作目录与报告列表；`.dev-smoke/website-pages/...` 只保留为既有日志恢复标识，不作为物理目录依赖。缺失、格式错误或冲突回执明确失败，不推断成功或盲目重传。

官网内容改动可使用 `node website/verify.mjs --browser-only --report <文件>` 验证三页桌面/手机布局、首屏入口、两页提示一致性及既有交互；证据明确标注跳过 npm 安装。默认模式从实际 DOM 取命令，在独立环境执行公共 npm 安装并核对配对程序、冻结包内使用说明与 Skill；公开 Kit 的独立安装/分发验证归其正式流程，不在官网重复。

## 官网使用指南

`guide.html` 提供 Agent 辅助接入：发送完整接入提示 → Agent 检查安装与 Hub → 浏览器一页注册/登录并连接 → Agent 自动配置资源并用 CLI 完成首项共享目录只读评审 → 按需重载 MCP。每步标出由谁操作和完成标志；用户不必自行敲 CLI，手动命令放在折叠参考。工作目录、成果续接、Hub 部署和维护放在进阶部分。

首页与指南使用逐字一致的完整接入提示。浏览器确认后 Agent 自动继续配置与首项任务，无需用户复述确认或另发体验提示；新 MCP 需要重载时再说明，不阻塞 CLI 首次任务。评审共享目录以便看到未提交改动，没改动时评审最近提交，非 Git 项目先明确范围。只读是任务要求；主 Agent 读回报告后首次协作才完成，握手成功不能替代真实任务。

指南区分正在对话的宿主与执行目标：机器/runtime 分别全局登记，Agent 为中心空间/仓库配置，本人选择独立。runtime register 明确指定实际机器 ID，不把名字当作 ID，不将握手/机器在线解释成模型已成功运行。

接入使用真实 begin/complete 确认即激活协议和本地待连接记录，不要求向模型发送 token；MCP 安装保留其他原生配置。无仓库 Runweft YAML、旧 root 认证或离线委派路径。固定 Git 基线、未提交内容不随基线传输、主 Agent 决定合入和保留 worktree 的边界明确。

首页和指南给出相同 npm 安装命令。指南提供从公开 `iTgo-lyq/runweft-kit` 安装 `runweft-kit` 的命令，说明 npm prefix/PATH、宿主 Skill 备份与 MCP 的独立接入；维护用 npm 安装目标版本；完整删除使用 runweft uninstall（默认预览，--yes执行），npm uninstall仅删除程序并保留数据。

`manual.html` 转义展示完整使用说明；无 Markdown 下载。参考页不执行命令或 HTML。参考导读说明适用人群和页内搜索，接入提示指向上手指南。

本地配置、数据位置、MCP 备份、模型登录、服务版本、排错和清理入口有具体说明。指南中的未知任务/runtime ID 和示例域名需要使用者替换，网站不自行执行这些命令或修改用户配置。

指南 `#native-session` 从“任务 → 查看任务详情”说明“打开原生详情 / 审批”和“打开原生文件”，支持目录及首页链接。审批是否出现沿原生配置，同意后执行相应操作，拒绝可能结束本轮。文件/diff 需要原生会话在线，完成后的代码通过 Runweft 取回；任务追加/续接仍回到主 Agent。手机访问需网络可达的 Hub 地址与同一身份/空间，localhost 仅本机，公网部署沿现有 HTTPS 代理说明。

操作与部署方式见[官网说明](../../../../website/README.md)。
