# 官网统一 npm 安装技术方案

> 来源：./requirement.md
> 状态：已确认

## 实现

复用现有静态 HTML/CSS、复制反馈、菜单和协作示意。所有平台共用 npm install -g runweft@1.1.0 --registry=https://registry.npmjs.org/ --include=optional，成功后才执行版本检查；移除平台下载切换和多份无 JS 命令。Node.js 20+ 是 npm 入口前提，HAPI 继续随包提供。

安装版本读取根 package.json，构建只依赖网站源码和当前 docs/usage.md，不依赖发行 tarball 或网络；正式上线前须确认目标版本已公开。本次版本固定现有 1.1.0，真实 npm 验收确认可安装。release.json 只记录 npm 安装方式、包名、版本和 registry，不将网页源码冒充程序候选来源。使用暂存目录和原有原子替换保留失败保护。

同步 docs/usage.md 和包内 Skill 源码的安装、PATH、升级/卸载说明。工程离线交付说明放在末尾明确的附录，官网只转义渲染此前的 npm 使用参考。公共 1.1.0 内原说明及已归档整包不覆盖；文档是下次程序发版的包输入，本次不重建或公开程序包。

首页和指南说明安装 CLI 后由 Agent 从 npm 全局包目录的 runweft/skills/runweft 接入宿主；已有 Skill 先备份/确认，MCP 仍使用显式 CLI。接入对话同时写清 npm 安装，避免要求先下载 Skill。

完整发行组装校验 npm 网站元数据的版本、方式、包名和 registry，拒绝旧 platforms/skill/source/hapi 字段或 downloads 目录；不再要求网站含平台/Skill 下载副本；离线 packages、来源归档与校验继续保留。拒绝不匹配版本和旧下载型站点，不覆盖原交付。

## 验证

根测试使用只含网站源码、package.json 和使用说明的夹具验证独立构建、无下载产物及非法版本/模板失败保护。更新既有 Playwright 验收，保留浏览器交互、布局、子路径和无 JS 覆盖，增加静态目录无归档与独立构建检查。安装命令直接取页面 DOM，清除 npm 配置及认证环境变量，使用专用 HOME/prefix/npmrc/cache 和仅含 Node/npm 的 PATH，真实执行 DOM 安装命令与 Skill 目录命令，核对命令归属、版本和 Skill 完整性；用失败 npm 夹具确认条件链不继续。不改用户配置或调用模型。

聚焦发行组装测试、根测试和 typecheck；网站构建代替无关 CLI 重编译。没有配置 Cloudflare、域名或部署凭据，不发布网站。
