# Agent 定义依据

> 调查：2026-09-29；固定 HAPI `56ec77f19322619a429304e7a948ba2c46eaca4d`

## 现有能力

- 全局资源已[验收归档](../../archive/2026-09-29-execution-resource-registry/execution.md)。ResourceClient 可查询登记与解析新目标，包含 local 本机限制；Runtime ID 属于所连中心 namespace。Agent 定义不需要新增资源注册或改 HAPI。
- 全局 YAML、注释保留、Zod 严格校验、原子写入及集中 client.sqlite 已存在。工作区绑定保存 realpath 与 Git 根，但创建 agent 不能隐式绑定工作区；可复用同一只读 Git 查询方式，保留调用 cwd 与项目根两个事实。
- [HAPI spawn schema](../../../../hapi/shared/src/apiTypes.ts) 接受 model、effort、modelReasoningEffort，字段均可省略。[Runner](../../../../hapi/cli/src/runner/run.ts) 向 Claude 传 --effort，向 Codex 传 --model-reasoning-effort；共享 Codex launcher 及 Claude 原生参数路径已经存在。
- Codex 的 reasoningEffort 解析器和 Claude effort 规范化均接受非空字符串；HAPI 没有可用于静态证明所有模型/推理组合有效的固定清单。不建立第二份模型目录，保留原生最终校验。空值不发覆盖，定义层不能把未测试的字符串称为已支持。
- 两种 runtime 的真实 cwd、项目说明/skill、原生模型配置继承已经由[执行基础](../../archive/2026-09-29-hapi-subagent-foundation/execution.md)验证。逐执行禁用 Runweft MCP 及停止后续接见[宿主规格](../../specs/host-mcp/spec.md)。本 Change 不改 launcher、不重跑模型来验证纯定义读取。

## Multica 参考

2026-09-29 重新读取 [Create and configure an agent](https://multica.ai/docs/agents-create)：职责说明用于列表，指令用于执行；runtime 决定机器与工具，可选模型参数留空沿默认。采用该分工；不采用其集中权限、skills/MCP、自定义环境或控制台机制。全局/项目文件及个人绑定是 Runweft 的本机产品设计，不声称来自 Multica。

## 配置与范围推导

每个定义一个 YAML，文件名承担稳定标识，中文展示名称独立；多行 instructions 无需额外模板引擎或任意文件包含。项目同标识整体覆盖，避免不明显的指令/模型合并。

项目可提交不带 runtime 的职责；个人引用按来源文件、连接地址和认证 namespace 放入现有 client.sqlite。绑定不保存资源元数据或复制中心登记，检查时仍请求中心。离线展示只读文件与本机已有绑定，明确还未认证选择；在线解析才确定有效绑定。这样无需让每位协作者改写共享文件，也不制造项目级 runtime 注册。

Git worktree 根可通过现有 Git 查询确定；非 Git 工作区仍允许共享 cwd，向上只寻找最近项目定义目录，排除 Runweft 自己的全局 agents 目录。解析保留 cwd，不把 Git 根误传成执行目录。子执行使用已解析内容快照，后续目录准备决定启动位置。
