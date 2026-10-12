# 执行证据

## T1 工作流与历史记录

完整引入 SpecTrail 上游 `67984848`，目录逐文件比较一致，移除旧技能入口，登记 main 守护分支；共享 `.githooks/pre-commit` 已通过仓库本地 core.hooksPath 启用。CI 运行全库状态检查，独立原型和工作流文件不触发 HAPI 运行集成，产品路径的触发规则保留。

迁移 39 个已归档 Change、163 个任务和一个暂停 Change。`migration.json` 记录原文提交、原提交时间、原 Markdown 摘要和任务映射；at 为本次登记时间。hub-host-cleanup 明确记 specs.not_needed。旧 T4b/T5b/T4.1/T3.1/T4V 映射为合法编号；原提交标题、日志与命令中的旧编号保持。两次发布故障触发的返修按最终完成依赖展开，原失败证据保留，避免制造任务依赖环。

依赖仅来自明确前置及 Hub 七阶段交付；组合/下游链接不转为依赖。47 处失效相对链接已修正到现存归档或实际存在的历史源码提交，归档相对链接检查无缺失。

验证：上游 setup 测试 10/10；完整 Workflow/41 个 Change 的共享 schema、编号/标题、任务 DAG、Change DAG 和归档路径一致。独立临时 Git 仓库执行本仓库共享 hook，非法 protectedBranches 提交退出非零，修正后提交成功；不是仅检查脚本文字。特殊任务的原始行内证据字符串已和基线比较保留。临时脚本、原始日志与 hook 回执在 `.dev-smoke/spec-trail-adoption/`。

Runweft 产品源码未改变；本次基线 typecheck、260 根测试/4890 断言、build 通过。后续对工作流和原型执行针对性验证，不把这些基线检查当成尚未完成的原型测试。

## T2 独立交互原型

`packages/prototype` 独立安装与构建，根包依赖和产品源码不变。从基线 Hub 抽取 6 个页面/共享模块、样式与骨架；身份/空间/成员壳使用虚构数据，其他页面复用主体渲染和事件。八个清单入口均有桌面、平板、手机视口，自包含 IIFE HTML 无模块、字体或服务网络依赖。Agent/仓库创建改为内存请求，无 sessionStorage。新增演示场景与重置，真实 HAPI 会话入口展示示例对话框。

浏览器首次验证发现 allow-scripts iframe 阻止原生 form submit，已加入本地表单事件适配，保留 reportValidity、按钮和 Enter 键行为；没有放宽 iframe 权限。测试覆盖身份创建/导入、空间创建、任务筛选/分页/详情/轮次/报告、机器改名/登记、Runtime 登记/探测、Agent 创建/编辑/版本/分享、仓库创建/别名、个人选择保存/解析/离线拒绝、成员角色/移除/邀请及加载失败恢复。

构建静态检查通过；Playwright 1.61.0 + Chromium 1228 在 24 个不透明 iframe 视口流程全部通过，明确验证存储不可访问、就绪握手、无横向页面溢出、无外部请求和浏览器错误；截图检查了桌面身份入口。原始日志在 `.dev-smoke/spec-trail-adoption/prototype-t2.log`。CI 增加独立 prototype job，不依赖 HAPI 编译。

## T3 发布适配与源码检查点

R2 适配器沿用 open-folio 固定提交的条件写入、重复版本字节校验和全量匿名验证，使用独立 runweft 前缀；10 项成功/重试/冲突/部分失败/凭据脱敏/公开读取错误/截图登记测试通过。28 项项目脚本测试、actionlint、全库 Workflow 校验通过。T2 远端 core 通过，prototype 因 Ubuntu runner 的 user namespace 限制无法启动 Chromium 进程沙箱而失败；仅 CI 模式关闭进程沙箱，iframe 仍保持 allow-scripts，修正后本地 CI 模式 24 组通过。

独立交付评审的 R4/R5 已修正：补齐原 Plan 的明确跨 Change 前置，并让原型机器/Runtime 在空间间共享同一内存资源、分别计算关联/分享/停用。历史修正仍属于本次用户明确授权的迁移，不更改原验证结论或时间。真实发布使用后续干净源码检查点，登记完成后补充实际版本与摘要。

R5 补充链路在三设备全部通过：机器关联第二空间、共享 Runtime、切换空间读取、空间停用相互隔离、撤回关联同时撤回分享。全套仍为 24 组页面/设备流程，原始日志 `prototype-cross-space.log`。
