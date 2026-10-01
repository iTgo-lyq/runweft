# 官网统一 npm 安装验收

2026-10-02 按 AGENTS.md 的持续授权完成自动本地验收；结果通过。实现提交 `420591b1fd39c590b2c8a7a0e1f5ad747a3244d4`，Plan 已经一次只读 iclaude 评审。脱敏事实见 [verification.json](verification.json)，原始临时证据路径见 [执行记录](execution.md)。

| 标准 | 实际结果 |
| --- | --- |
| 三页统一 npm，无下载入口或归档 | 首页与指南给出相同 npm 命令，参考页仅展示 npm 使用部分；8 文件、91,064 字节、0 归档，无 downloads 目录和 a[download] |
| 不依赖发行包，构建失败保护 | 独立根夹具只含 website/package.json/docs，成功构建；非法版本、未知占位符不改变旧首页 hash，无残余暂存 |
| 完整发行兼容 | 组装夹具校验 npm 元数据，错误版本/方式/包名/registry、旧字段/下载目录明确拒绝；成功整包校验及两仓库 Git 身份恢复通过 |
| 浏览器交互、布局及 npm 真实安装 | Chromium 153.0.8010.12，11 项检查通过，19 个布局检查无溢出；复制成功/拒绝、键盘菜单与焦点、FAQ、MCP/runtime 切换、无 JS、reduced motion、24 个子路径本地链接通过 |
| npm 命令与包内 Skill | 从最终 DOM 取得两条命令，专用 HOME/prefix/npmrc/cache 实际安装 runweft@1.1.0；入口属于专用 bin，五份 Skill 文档齐全。失败 npm 不继续调用旧程序 |
| 文档、规格与配置边界 | 同步官网/指南、安装与 Skill、发行组装 Specs；完整 Change 归档。未写入用户宿主配置或 Skill，未调用模型；测试浏览器/服务已关闭，原预览保留 |

基础检查：bun run typecheck 通过，bun run test 265 通过/0 失败（43 文件、5,304 断言），聚焦网站与组装 2 通过，skill-creator 结构校验通过。构建采用 node website/build.mjs；本次未修改运行时代码，不重建 CLI 或原冻结程序候选。

官网尚未部署到 Cloudflare 或其他公开服务。已发布 npm 1.1.0 与原离线整包未覆盖；本次说明及 Skill 源码改变发行输入，需要下次程序发版重新冻结。公共 1.1.0 内 Skill 仍保留旧下载指引，官网接入对话明确安装/升级/卸载使用 npm。本次 npm 安装实测仅 Linux x64；历史其他平台、模型与物理远端边界保持原记录。
