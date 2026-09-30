# 完整发行执行概况

## Plan 评审

唯一一次 iclaude 只读评审在当前工作区完成，session `f9107373-19ce-4d6e-ac1f-a9956a75b81d`，2026-09-30 13:22（Asia/Shanghai）开始，exit 0、result success、is_error=false。使用专用 Claude 配置副本、Read/Glob/Grep，无新增 reviewer、模型执行实验或用户配置修改。原件 `.dev-smoke/reviews/integrated-release/review.md`。

| 意见 | 主 agent 判断 |
| --- | --- |
| 保存旧版包，防止新目录混入旧 tarball；升级须从旧程序数据开始 | 采纳。保留 C11 最终 0.1.0 产物与索引，新增版本从独立暂存打包；旧数据验证升级，新数据补充兼容回退。 |
| 包内说明在 T1 定稿，T4 修改会改变包 hash | 采纳。开发说明不进入用户入口；确需修改包内内容时重做打包/安装，程序 hash 相同的模型证据可复用。 |
| 当前最终候选缺少 MCP 卸载/恢复明确断言 | 采纳。增加已安装 CLI、预置其他 MCP 的专用配置验收，保持无模型和用户配置不变。此前 C3 验证仍有效，但不冒充最终候选证据。 |
| CI install jobs 也缺 smoke 的 SDK 依赖 | 采纳，源码确认 smoke-install 直接 import MCP SDK。build/install 两处依赖顺序一起修正；未 push/触发 CI 时不声明当前工作流通过。 |
| Linux arm64 运行证据不能由格式检查替代 | 采纳。寻找可自动执行的本地仿真，分别记录编译、仿真和原生结果。 |
| 限制清单及许可证决策 | 采纳事实记录：固定 HAPI 的一个环境性测试失败、Mac/物理远端/CI/Nginx 实测范围如实披露。保留包内 HAPI 原始许可证和匹配源码，不代选 Runweft 开源许可证；这影响未来公开发布安排，不新增本地产物交付确认门禁。 |
| 简化矩阵并提供校验文件 | 采纳明确脚本分工与二进制 hash；20 组核心协作加独立附件/控制验证，输出 SHA256SUMS。Mac 给单一平台包安装入口，说明未签名/公证事实。 |

四个任务保持独立；C11 已验收归档。用户明确接手 Mac 实机验证，Playwright 环境已通过真实运行，原阻塞解除。
