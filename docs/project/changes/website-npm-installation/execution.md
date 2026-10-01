# 执行记录

## Plan 评审

2026-10-02 在当前工作区执行一次只读 iclaude 评审，session `12845f5f-b54a-477c-9e7f-989c6a828f02`，正常完成。证据在 `.dev-smoke/reviews/website-npm-installation/`。

采纳：同步包内 Skill 源码；网站接入对话明确全程 npm；独立构建夹具；严格校验网站 npm 元数据与旧下载目录；npm 验收隔离配置、认证和 PATH；离线交付附录不渲染到官网。已发布 1.1.0 和原离线交付保持既有字节，新文档与 Skill 源码属于下次发行输入。

## T1

已完成实现和自动本地验收。

- node website/build.mjs：8 文件、91,064 字节、0 归档，无 downloads 目录；本机原预览仍返回新版 npm 页面。
- 聚焦网站/组装测试：2 通过；无 dist/packages 构建与非法版本/模板失败保留旧输出，错误 npm 元数据和旧下载目录拒绝，离线 bundle 的真实 Git 身份/校验仍通过。
- bun run typecheck：通过。bun run test：265 通过、0 失败，43 文件，5,304 断言。
- skill-creator quick_validate：通过；仅修改接入/维护安装来源，无新 Skill 或触发规则变更。
- Playwright：Chromium 153.0.8010.12，11 项检查通过；3 页 × 5 宽度、子路径/无 JS 共 19 个布局检查无溢出，24 个本地链接/锚点通过，页面与网络错误均为零。截图人工核对安装区桌面与指南手机布局。
- 从最终 DOM 原样取得 npm 安装和 Skill 目录命令，在专用 prefix 实际安装公共 runweft@1.1.0；程序归属专用 bin，五份 Skill 文档齐全，失败 npm 夹具不调用旧程序。未修改用户 MCP/Skill，不调用模型。
- 浏览器原始证据：`.dev-smoke/website-V4WZLg/evidence.json`；测试日志：`.dev-smoke/website-npm-tests.log`。本次测试服务和浏览器已关闭，原预览保留。
