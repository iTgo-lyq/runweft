# 官网 Cloudflare Pages 验收

2026-10-02 按 AGENTS.md 的持续授权完成自动验收；本轮预览配置与上线通过。一次只读 iclaude Plan 评审已完成，任务实现与修正均独立提交；脱敏事实见 [verification.json](verification.json)，过程与精确验证范围见 [execution.md](execution.md)。

| 标准 | 实际证据 |
| --- | --- |
| 事件和部署范围 | 真实 codex 分支 push 触发独立官网工作流并部署 preview；main/手动/PR/tag/未知分支路由由 13 项聚焦测试与 YAML 覆盖，真实触发仅验证当前 codex 分支 |
| npm 与静态输出 | 公共 1.1.0 五包元数据、SHA-512 字段、精确平台依赖、tarball HEAD 成功；静态八文件 91,064 bytes，无程序归档、未知文件或用户配置 |
| Secrets 与项目 | Repository secrets 两名称齐全；真实 API 不存在后创建 Direct Upload runweft，生产分支 main；再次读取不创建。非 main/Git 项目拒绝和权限异常为夹具测试。Token 不入静态文件/验收 JSON |
| 真实部署 | [run 36909619770](https://github.com/iTgo-lyq/runweft/actions/runs/36909619770) 整体 success，源 9d22f23c712ba2ba509db8f06517ce98f366986a；action environment 与 preview 请求模式比较通过；三页、release.json、四资源 MIME/SHA-256 全部一致 |
| 公开页面 | 唯一 URL [4c68856f.runweft.pages.dev](https://4c68856f.runweft.pages.dev/)；分支别名 [codex-cli-foundation.runweft.pages.dev](https://codex-cli-foundation.runweft.pages.dev/)随后续预览变化。Chromium 153.0.8010.12 独立导航三页均 200，HTML 规范化重定向正常、CSS 加载、首页/指南固定 npm 命令、无下载入口，零页面/请求错误 |
| 失败与恢复 | 首次上传成功后网络校验失败，保留原 URL 并独立 HTTP 核对八文件通过，再推送重试/回执修正；默认 36 次和约三分钟窗口，校验前保存已上传 URL/实际环境，修正后 CI 全部通过 |
| 文档与规格 | README、官网与开发/项目入口、website/product Spec 已同步；完整 Change 归档，凭证和临时原生日志不提交 |

本地验证：Node 聚焦测试先 11 后 13 pass，actionlint 1.7.12、typecheck、根测试 265 pass/0 fail、官网 build 与真实公共 npm 检查通过。新增公开浏览器验证仅测试导航/加载，不重复此前完整交互和 135 MB CLI 安装；同内容完整交互与真实 npm 安装证据见 [前次验收](../2026-10-02-website-npm-installation/acceptance.md)。源码与最终静态文件摘要匹配；浏览器已关闭。

当前仅发布分支预览。main 尚无产品代码与工作流，生产、手动及 PR 的真实触发未执行，需后续合码；root runweft.pages.dev 尚无生产内容。本轮未合码、修改默认分支/仓库可见性或 npm 发布规则，未覆盖公开 1.1.0/原离线候选，未更新在线 Hub 或用户宿主配置。Pages 的 GitHub 配置和运行证据不代表程序平台/模型/物理远端验收扩大。
