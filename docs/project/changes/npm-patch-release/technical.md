# 1.1.1 补丁发布技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-10-02

## 方案与就绪性

使用现有 npm-publish.yml、cli-install.yml 与 website-pages.yml。五包 OIDC 绑定已由真实 main 预演验证；Cloudflare Repository secrets 已完成生产上传。根工程版本驱动 CLI、五包和官网，HAPI 仍固定 0.30.7 / 3ac8b08b2aead13e9eaae459de62d9a5d5df7395。

将根版本与常规使用说明改为 1.1.1，更新根 README 的安装目标；离线工程附录继续明确对应历史 1.1.0 整包。当前 Skill 源码已使用 npm，随新候选发布，不更改模型、MCP 或用户全局配置。

## 发布顺序

本地 main 从已推送基线形成干净版本提交，先只推送其不可变 v1.1.1 tag。标签触发原工作流：四平台构建/包内容与实际安装通过后，用 GitHub OIDC 顺序上传四个平台并确认公开，最后上传主包。main 的版本推送暂缓至五包公开与匿名安装验证完成，避免官网在 npm 尚未公开时按既定检查失败。

发布验收读取同一 run 的候选索引、五包 manifest/tarball 和 publication/OIDC 回执；匿名下载到专用 .dev-smoke 目录，逐包流式 SHA-512 核对，不修改或覆盖旧 dist/packages。Linux x64 以独立 HOME/npm prefix/config/cache 安装公共 npm 主包，检查真实入口、版本、二进制摘要、Skill 和 README；已有网站 Playwright 验收可复用其 DOM 安装链路，不运行模型。

tag 之后只更新非包输入的项目记录、根 README、开发/官网说明和 Specs；推送 main 与最终归档前分别按 scripts/fixtures/release-inputs.mjs 的 packageInputs 检查与 v1.1.1 无差异。使用说明和 Skill 若发现需修正，进入后续版本，不混入已冻结 1.1.1。

包确认公开后快进推送 main，触发既有生产 Pages 与 CLI CI；取得 production 回执，校验唯一 URL、正式域名八文件 MIME/SHA-256 和三页浏览器行为。验收后更新当前 Specs 与文档并归档。

## 失败与恢复

标签与公共版本不覆盖、不删除、不重打。上传结果未知时先检查该 run 回执及公共 registry，不重发未知包；明确失败后的恢复只重跑原 run 的失败 job，复用原候选。正式标签失败不重建同版本后覆盖；存在真实实现缺口时先定位并更新方案。包未公开或安装失败时不推送 main 版本、不部署指向不可用版本的官网。

重跑可恢复上传前失败、已 accepted 的处理等待，或 registry 已公开且完整性相同的包。uploading 状态且处理窗口后仍无法公开确认时保留 tag/回执，T2 不判成功，不清回执强行补发；先定位并更新后续版本方案。部分平台 latest 可能已改变，主包精确依赖使现有主包仍引用其原版本。

## 验证与范围

版本准备执行类型检查、根 ./test 与轻量构建；正式 tag CI 完成四平台打包和安装。当前专用公共 npm/网页验收使用新的 1.1.1，与源码/候选摘要对应；旧 1.1.0 模型、物理远端、离线整包证据独立保留。凭证只由 GitHub Actions 注入，不读取秘密值，不将 token 或原生日志写入验收记录。
