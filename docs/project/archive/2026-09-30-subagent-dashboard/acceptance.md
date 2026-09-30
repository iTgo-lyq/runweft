# 看板验收

2026-09-30，按用户持续授权完成本地自动验收；用户明确指定 Playwright，不要求连接用户浏览器。唯一一次 iclaude Plan 评审、主 agent 采纳记录及任务检查见 [Execution](execution.md)。

| Requirement | 可观察证据 |
| --- | --- |
| 多工作区/父会话总览及 HAPI 详情 | T1 namespace 总览与筛选；T3 两份已结束原生任务、60 条测试状态和实际 HAPI 历史详情导航 |
| 执行、未知、停止与成果分别表达 | T1 HTTP/SQLite 状态投影；T3 Playwright 未知/离线/已完成、代码/附件独立状态 |
| 复用 HAPI 账号与 UI | T2 同源认证及链接；T3 JWT 续期、重新登录、原生 HAPI 详情共享登录 |
| 主宿主结束仍可查看 | T3 读取 C10 已结束原生任务，无新增 session 或模型调用 |
| 单 CLI、内嵌页面、安装后独立运行 | T2 open/--hapi 与编译服务；T3 四平台编译及 Linux 私有 npm registry 实装 |
| 筛选分页、空/错/离线反馈 | T3 Playwright 完整流程；失败保留旧记录，认证恢复后等待真实结果 |
| 纯文本、有界内容及共享目录不适用 | T1 投影及保密断言；T2 标签测试；T3 浏览器 HTML 注入样例、链接无凭据 |
| local/Hub、无 Runner 与 namespace | T1 不同 JWT scope 和只读检查；T3 独立 Hub/无 Runner 服务与看板自动验收 |

最终证据：`.dev-smoke/dashboard-3pZ7AN/evidence.json`、`.dev-smoke/install-UEzdGr/evidence.json`、内嵌 service-aXMrtx、`.dev-smoke/remote-package-dCKnXX/evidence.json` 均成功；浏览器无页面异常、无水平溢出，桌面与 375px 截图已目视核对。根测试 173 pass / 0 fail、types/build 通过。原生会话未重放，专用测试服务和浏览器已关闭。

首次浏览器失败定位出产品 fetch 接收者问题，已修复并重新构建、验收全部四平台候选。测试代理压缩及认证等待条件另在测试脚本修正，过程见 Execution。固定 HAPI 没有修改，不将旧上游完整测试中的环境失败隐藏为全绿。

Mac 最终版本实机运行由用户验证；物理跨机验证按授权保留缺口。本 Change 已满足简单只读看板的范围，不声明完整发行已经交付。
