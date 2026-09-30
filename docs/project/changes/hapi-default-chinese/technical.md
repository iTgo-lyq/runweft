# HAPI 默认简体中文技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-09-30

## 方案

已核对 HAPI 0.30.7 的 web/src/lib/i18n-context.tsx：语言来自 localStorage 的 hapi-lang，只有 en / zh-CN 有效，空值或无效值目前回退 en。现有中文词典和设置入口足够，只将初始化的默认值改为 zh-CN；保留持久化键、已保存选择和翻译缺失时的英文回退。

修改在独立 HAPI 子模块仓库提交，再更新 Runweft 的 gitlink 和 package.json 固定 revision 并提交，之后才重建发行产物。HTML 初始 lang 同步为 zh-CN。既有英文 UI 测试显式选择 en；Vitest 公共 setup 建立英文夹具，使用真实 I18nProvider 且清空存储的测试在 clear 后重新选择 en，Playwright 夹具通过 storageState 选择 en；不改 Storage 语义或增加产品配置。

## 影响

- 只影响 HAPI Web/PWA 初始语言，无数据库迁移、协议、原生 agent 配置或凭据修改。
- build:hapi 要求固定且干净的 HAPI 源码；更新 pin 后重新构建四平台 HAPI、Runweft 及安装包。官网本地下载目录随包重建，不发布远端。
- 回退方式为恢复原 HAPI pin 并重新构建；本次不修改用户浏览器存储或运行中的服务。

## 验证

- HAPI 的 bun run typecheck:web、bun run test:web 和两套离线 Playwright；真实 Hub 会话 e2e 按原有条件跳过，不启动模型。Runweft 类型检查、./test 测试、构建及发行包校验，node website/build.mjs 重建本地下载。
- Playwright 使用专用浏览器和数据目录启动配套程序，覆盖空/无效/en/zh-CN 存储、设置切换及刷新。临时脚本和证据只放 .dev-smoke/。

## Plan 评审

2026-09-30 在当前工作区用 iclaude 评审，达到读取轮数上限后续接同一会话完成结论，原文在 .dev-smoke/reviews/hapi-default-chinese/review.md。采纳英文夹具、两套离线 e2e、HTML lang 和先提交 pin 再打包的建议。默认值用配套二进制的独立 Playwright 覆盖，不为这一可逆默认值增加重复单测。推送/发布不在本次授权中；源码归档随包保留，新 HAPI commit 的远端可获取性本次不验证。
