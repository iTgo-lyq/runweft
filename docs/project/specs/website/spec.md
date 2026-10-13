# 产品官网与安装

Runweft 官网是独立静态站点，不与业务看板或 HAPI 服务混用。首页明确 Codex/Claude Code 的任务委派用途，按评审、独立实现、远端测试/构建介绍场景及报告、代码、附件。主入口引导 Agent 接入，npm 手动安装为次入口；接入提示与重开客户端后的首次任务分别可复制。官网导航链接到公开 npm。

委派必须连接 Hub；local 仅表示可托管本机 Hub，不是离线 Agent 模式。本机/远端图是交互示意：本机评审用共享目录、实现用独立 worktree；远端从已提交版本准备独立 worktree。

首页 `#native-experience` 解释 HAPI 驱动原生 Codex/Claude 的执行方式：采用执行机器已有的登录、项目指令、Skill 和其他 MCP，权限沿原生规则，会话和目录跨轮保留。HAPI 会话网页提供消息/工具历史、待审批处理及在线会话文件和 Git 暂存/未暂存差异；新增入口链接到指南的具体步骤。手机使用浏览器，须能访问 Hub 并选择本人身份/空间；不承诺全部 HAPI 客户端或功能已接通。

首页 `#session-screenshots` 将会话/文件预览融入 HAPI 会话介绍块，不显示截图来源或版本免责声明。桌面文案在左、双图在右，800px 及以下文案在上，双图始终并排。预览最大 180×240px，窄屏等比例缩小；CSS 裁切展示主要内容，普通链接打开完整 946×2048 WebP 原图，字节保持不变。图片懒加载并标注固有尺寸，键盘焦点可见，无 JavaScript 可用。

## npm 安装

所有支持的平台使用同一条固定版本 npm 命令，注明 Node.js 20+、npm、任务所需 Git 与原生工具。npm 自动选择 macOS arm64/x64、glibc Linux arm64/x64 平台依赖，随包提供 HAPI 和 Skill。安装成功后才检查版本；失败不继续运行已有程序。PATH 说明以 npm 全局 prefix 的 bin 为准。

官网不提供平台包、独立 Skill、校验文件或 Markdown 下载，无平台切换解包命令和下载目录。Agent 对话用 npm 安装和升级，完整删除使用 runweft uninstall（先预览，确认范围后 --yes）；Skill 从 npm 全局包目录读取，再按授权接入宿主，已有内容先备份和确认。

## 静态交付

website/build.mjs 读取根 package.json 的稳定版本、网站源码和当前使用说明，不依赖 dist/packages 或构建网络。输出仅包含三页 HTML、资源和 release.json；元数据为 version、installation=npm、package=runweft 和公开 registry，不冒充程序候选来源。正式部署前须确认五包latest均为目标版本，公开元数据/完整性与精确平台依赖可安装；只有beta的稳定候选停止部署。

暂存全部成功后才替换旧输出；非法版本、未知模板占位符失败保留旧站点并清理暂存。参考页转义完整使用说明。站内页面和资源均使用相对路径，支持根路径和子路径部署。

website/serve.mjs 提供 loopback GET/HEAD 预览，只能读取站点目录。生产可使用常规静态托管；构建和部署说明见[官网说明](../../../../website/README.md)。站点不含账号系统、遥测或第三方脚本/字体请求。

移动菜单、键盘焦点和 reduced motion 可用。复制失败选中命令并提示手动复制；禁用 JavaScript 后同一 npm 命令和指南仍可读取。

## Cloudflare Pages 自动部署

website-pages.yml 复用规范版本识别，稳定版本使用托管 runner 构建、检查公共 npm 版本并上传 Direct Upload 项目；main 的官网相关推送部署 production，codex 分支部署 preview，action 返回环境须与请求模式匹配。生产部署先确认 run 的 SHA 为 main 当前提交，拒绝旧提交覆盖官网。仅 codex/** push/dispatch 的 Beta 在聚焦检查后明确跳过构建、准备/上传与静态产物；main 或 PR 的 Beta 版本失败，真实构建器仍只接受稳定版本。

普通 push 的稳定版本尚未全部晋级时保留静态检查，标记等待发布并跳过上传；PR、手动及发布接续仍要求五包 latest 已晋级。稳定 npm 晋级后自动 dispatch main，核对预期版本及来源 run/attempt，发布端绑定实际官网 run 并限时等待完成；失败或未知不表示整体验收成功，只恢复官网。上传前再次确认 main 未推进，拒绝旧版本任务覆盖新网站；已晋级版本的独立官网变更仍可部署。

准备步骤和官方上传 action 使用 Repository secrets 的 CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN；凭证不写入静态站点或验收 JSON。上线检查主包/四平台包的公开版本、SHA-512 字段、精确可选依赖和 tarball HEAD；五包latest必须与站点版本一致，不下载程序、不调用npm发布。静态输出为十文件白名单，拒绝链接、隐藏文件、归档和未知文件。

校验前保存唯一 URL 与实际环境回执，在约三分钟窗口内重试暂时不可达请求，错误只记录有限网络错误码。在线验证跟随项目域内 HTML 重定向，核对三个页面、release.json、六个资源的 MIME 与 SHA-256；生产部署在唯一 URL 通过后还须验证正式域名。随后自动运行三页 1440/390px 的浏览器检查，核对版本、标题、布局、可见图片与页面错误。固定构建验收使用唯一 URL，正式域名失败不得报告整个部署已验证。

官网使用Cloudflare Direct Upload，不依赖Actions artifact；脱敏部署回执、十文件摘要与URL保存在日志/summary及仓库验收记录，静态输出按对应提交重建核对。

官网内容改动可使用 `website/verify.mjs --browser-only` 验证三页、首屏入口、两页提示一致性及既有交互；证据明确标注跳过 npm 安装。默认模式仍从实际 DOM 取命令，在独立环境执行公共 npm 安装。

## 官网使用指南

`guide.html` 提供五步 Agent 辅助接入：npm 安装与 Skill → Hub 与浏览器身份确认 → 机器、工具与评审 Agent → MCP 安装并重开客户端 → 首项共享目录只读评审。每步标出由谁操作和完成标志；用户不必自行敲 CLI，手动命令放在折叠参考。工作目录、成果续接、Hub 部署和维护放在进阶部分。

首页与指南使用逐字一致的接入提示和首项任务提示。接入提示以装好 MCP、提醒在项目目录重开结束；新会话中再发送首项任务。评审共享目录以便看到未提交改动，没改动时评审最近提交，非 Git 项目先明确范围。只读是任务要求；主 Agent 读回报告后首次协作才完成，握手成功不能替代真实任务。

指南区分正在对话的宿主与执行目标：机器/runtime 分别全局登记，Agent 为中心空间/仓库配置，本人选择独立。runtime register 明确指定实际机器 ID，不把名字当作 ID，不将握手/机器在线解释成模型已成功运行。

接入使用真实 begin/complete 加密确认，不要求向模型发送 token；MCP 安装保留其他原生配置。无仓库 Runweft YAML、旧 root 认证或离线委派路径。固定 Git 基线、未提交内容不随基线传输、主 Agent 决定合入和保留 worktree 的边界明确。

首页和指南给出相同 npm 安装命令。指南提供从 `$(npm root -g)/runweft/skills/runweft` 定位完整 Skill 的命令，说明 npm prefix/PATH、宿主 Skill 备份与 MCP 的独立接入；维护用 npm 安装目标版本；完整删除使用 runweft uninstall（默认预览，--yes执行），npm uninstall仅删除程序并保留数据。

`manual.html` 转义展示完整使用说明；无 Markdown 下载。参考页不执行命令或 HTML。参考导读说明适用人群和页内搜索，接入提示指向上手指南。

本地配置、数据位置、MCP 备份、模型登录、服务版本、排错和清理入口有具体说明。指南中的未知任务/runtime ID 和示例域名需要使用者替换，网站不自行执行这些命令或修改用户配置。

指南 `#native-session` 从“任务 → 查看任务详情”说明“打开原生详情 / 审批”和“打开原生文件”，支持目录及首页链接。审批是否出现沿原生配置，同意后执行相应操作，拒绝可能结束本轮。文件/diff 需要原生会话在线，完成后的代码通过 Runweft 取回；任务追加/续接仍回到主 Agent。手机访问需网络可达的 Hub 地址与同一身份/空间，localhost 仅本机，公网部署沿现有 HTTPS 代理说明。

操作与部署方式见[官网说明](../../../../website/README.md)。
