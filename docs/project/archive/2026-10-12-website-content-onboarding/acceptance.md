# 官网内容与上手路径验收

2026-10-12，按用户授权自动完成验收。官网改写文案由 iclaude 编写，主 Agent 核对事实、原样集成并验证；既有样式、已发布程序和 Skill 保持不变。

## 需求对应

| 要求 | 交付与证据 |
| --- | --- |
| 一眼看懂用途 | 首屏说明 Codex/Claude Code 的任务委派，展示评审、实现、测试及报告/代码/附件；桌面、手机主入口可见 |
| 具体场景与一致入口 | 三个场景；首页和指南接入提示逐字一致，浏览器身份确认、已有配置保护与重开提醒保留 |
| 容易开始 | 五步区分用户和 Agent 的动作，每步有完成标志；重开后单独复制共享目录只读评审，读回报告才算完成 |
| 概念与边界准确 | 手动命令折叠，工作区/成果/部署/维护为进阶；Runner online、身份返回、Git 取回、Skill 授权与续接条件已核对源码 |
| 保留框架与可用性 | CSS 未改；三页五种宽度、24 个本地链接/锚点、复制成功/拒绝、键盘、切换、无 JS、reduced motion 全部通过 |
| 全部改写文案由 iclaude 完成 | 三页 HTML 与其最终成稿逐字节一致，示意与复制提示直接使用其 JSON；两次写作会话及 SHA-256 见 verification.json |

## 自动验证与发布

- 本地：网站构建、15 项发布检查、Playwright `--browser-only`、九种宽度首页检查、原有模板 ID/命令比对及冻结包输入核对通过。已检查桌面/手机截图。
- [main 核心 CI](https://github.com/iTgo-lyq/runweft/actions/runs/38159759143)与[Pages CI](https://github.com/iTgo-lyq/runweft/actions/runs/38159759169)通过，部署源码 `a80bb169b136bb4c9c667a0d82c74a6b986f73f2`。
- [正式官网](https://runweft.pages.dev/)与[唯一部署](https://9417cc0a.runweft.pages.dev/)分别通过八文件 SHA-256/MIME 及三页真实浏览器检查；静态文件合计 102,120 字节。CI 和本地重建摘要一致。
- 公开 npm 五包仍为 1.1.3；未发布新程序或改动标签，Pages 没有 Actions artifact。发布和浏览器证据见 [verification.json](verification.json)。

## 范围

本次为官网内容与交互验收，不增加真实模型、物理跨机或平台安装证明；`--browser-only` 明确跳过重复 npm 安装，现有 1.1.3 发行证据继续有效。线上浏览器使用会话代理并忽略其证书错误，独立 HTTP 校验正常核对全部字节/MIME，具体传输设置已记录。可读性未经外部用户测试。

原始 iclaude 成稿、日志、截图和本地检查位于 `.dev-smoke/website-content-onboarding/`；可长期复核的来源、摘要和结果已收录本归档。
