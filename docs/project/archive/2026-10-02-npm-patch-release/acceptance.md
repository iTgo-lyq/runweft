# 1.1.1 补丁发布验收

依据用户既有自动验收授权，发布、安装与官网验证均通过，无人工门禁。脱敏结果见 [verification.json](verification.json)。

| 需求 | 实际结果 |
| --- | --- |
| 稳定 tag 真实可信上传 | v1.1.1 固定绑定干净源码 36257dfb3aae2da85289539b11ba8ac857bdbb10；[原 run 36915690489](https://github.com/iTgo-lyq/runweft/actions/runs/36915690489)为 push，四平台实际安装/服务通过，五包 OIDC HTTP 201，publication success=true、五包 confirmed |
| 公开候选与匿名安装 | 五包 latest=1.1.1；元数据、精确平台依赖、实际 tarball SHA-512 匹配原索引/回执。Linux x64 执行真实 DOM 的 npm 命令，已安装两程序 hash 匹配，HAPI=0.30.7，主/平台 Skill 六文件与 README 逐字匹配冻结源码 |
| main 与官网 | main 版本输入与 tag 无差异；[CLI CI](https://github.com/iTgo-lyq/runweft/actions/runs/36919283325)与[生产 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36919283258)成功。[唯一 URL](https://25a3034a.runweft.pages.dev/)和[正式域名](https://runweft.pages.dev/)八文件摘要/MIME、正式域名三页 Playwright 通过，安装目标 1.1.1，91,064 bytes |
| 文档与保留 | CLI/Skill、发行与验收、官网当前 Specs 和维护者说明更新；历史 1.1.0 包、离线整包、归档不覆盖，未修改用户全局配置。独立工作区保留并行模块审计的文档 |

本地 typecheck/build 与 265 项根测试全部通过，5305 断言、43 文件；原 tag CI 263 pass、2 skip、0 fail、5282 断言，托管 runner 的两项原生 MCP 配置测试因缺 Codex CLI 跳过，本地已执行。网页自动验收 11 项、19 个布局、24 个子路径链接、零网页/网络错误。

慢代理安装已主动停止，在专用 HOME/prefix/配置/cache 中以直连执行相同公开 npm 命令通过；失败现场保留，不误报成功。公共 tarball 的短暂 404 缓存只等待传播，未重新上传。原候选索引/五份 manifest 采用归档范围读取，完整候选保留在原 CI，公开包逐个实际下载核对摘要。

本轮只验证发布、安装与官网，没有新候选的模型、arm64 模型、物理跨机或新离线整包验收；旧模型组合保留其原版本范围。Beta 只有已确认且评审的后续 Plan，本记录不声称已实现或发布 Beta。
