# 官网截图紧凑布局执行概况

## T1 合并布局和精简文案

- 结果：文案与双图合成一个会话介绍块，删除原说明和来源。两图最大 180×240px，800px 及以下落在文案下方并继续并排，普通链接打开完整原图。
- iclaude：会话 `af38d350-983f-4f17-ac20-ed4114908fc8` 完成 Plan 评审和全部新文案；主 Agent 采纳局部样式、精简左栏、响应式比例、焦点与深链建议。未触发额度降级。
- 验证：15 项 `node --test ./website/publish.test.mjs` 通过；构建与 `website/verify.mjs --browser-only` 三页六宽度、27 个子路径链接、无 JS/键盘原图、复制和安装失败短路通过；发行输入冻结校验通过。
- 视觉：Playwright 前后实测桌面 1376.03→375.73px、390px 手机 2417.13→633.52px；六宽度首屏边界相同，另一成果区逐像素相同。两图 SHA-256 不变；深链标题不被吸顶导航遮挡，3px/5px 焦点框可见。已查看桌面/手机截图。
- 范围：仅官网内容与样式，本轮不重新安装已发布 npm 二进制。数据见 [verification.json](verification.json)，原始截图/脚本在 `.dev-smoke/website-compact-session-preview/`。
- Commit：`website-compact-session-preview T1: integrate compact session previews`

## T2 发布与归档

- 结果：main Pages 已发布紧凑布局；正式域名和唯一 URL 内容一致。Specs 与文档入口同步，验收和归档完成。
- 验证：核心 CI、Pages CI 通过；线上十文件摘要/MIME、三页浏览器、首页六宽度并排/尺寸、图片解码与导航通过；零 Actions artifact。正式域名首轮导航即时断言失败，增加目标可见等待后重跑通过；保留首轮记录。
- Commit：`website-compact-session-preview T2: verify deployment and archive layout update`
