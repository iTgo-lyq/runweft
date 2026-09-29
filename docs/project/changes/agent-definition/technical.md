# 轻量 Agent 定义技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md)
> 状态：已确认
> 更新：2026-09-29
> 确认方式：用户授权自主落实细节；一次 iclaude Plan 评审后实施，主 agent 独立采纳。

## 定义格式与位置

全局定义为 `<home>/agents/<id>.yaml`，项目定义为 `<project>/.runweft/agents/<id>.yaml`。id 满足 `^[a-z][a-z0-9-]{0,63}$`；稳定标识取文件名，不另存第二个 id 字段。读取 `.yaml` 文件与符号链接，来源保留目录内路径并显示链接目标；任何 `.yml` 都报错并提示改名，不递归扫描任意文件。

```yaml
schemaVersion: 1
name: 代码评审
description: 检查变更正确性、回归和验证缺口
instructions: |
  阅读项目约定和相关变更，按严重性报告有依据的问题。
runtime: null # 共享定义可留空；用 agent bind 绑定当前中心的 runtime
flavor: null # 配置 model 或 reasoningEffort 时必须指定 codex 或 claude
model: null
reasoningEffort: null
```

schemaVersion 默认 1，name 默认文件标识，description/instructions 默认空字符串；runtime 为 UUID 或空。model/reasoningEffort 省略、null 或空白字符串均表示不覆盖，非空保留原生含义；不虚构模型/推理目录。非空 model/reasoningEffort 要求显式 flavor；只要声明了 flavor，绑定与检查的目标就必须匹配，不自动清除覆盖参数。严格拒绝机器注册、URL、权限、环境变量、skill/MCP、任意启动命令等未知字段。使用现有 YAML/Zod，重复键与格式错误带文件和字段位置；不自动修改错误文件。

项目同标识整体替换全局项，空值不继承被遮蔽项；show 显示生效来源与被遮蔽路径。list/validate 列出有效项与错误项，有错误时非零退出；show/check 只解析指定 id 的生效来源，无关坏文件不影响它。损坏项目项仍遮蔽全局，不回退；被遮蔽文件不解析。显式选择全局源用于维护不会自动修改项目源。

## 项目定位与快照

库函数必须显式接收宿主 cwd，不读 process.cwd()；MCP 调用方从已验证身份取得 cwd，CLI 从命令当前目录传入。从实际 cwd 的 realpath 只读查询 Git worktree 根；Git 不可执行与非仓库分开处理。Git 内只使用 worktree 根的项目定义，不沿子目录重新选择项目。非 Git 时向上寻找最近 `.runweft/agents`，排除与全局目录相同的位置，在用户 home 前停止（不包含 home）；未发现则将当前 cwd 作为项目创建位置。缺少定义时读取不建目录或 client.sqlite。

解析保留 sourceCwd、projectRoot、定义 scope/path、遮蔽来源、声明 runtime、个人绑定来源、实际 runtimeId/machineId/flavor。definitionVersion 是规范化生效定义的 SHA-256，resolvedVersion 加入本次明确绑定、目标、connectionName 和已认证 namespace；不把探测时间、mtime 或绝对来源路径当内容版本。快照为普通可序列化 JSON，包含连接与 namespace；下游续接必须检查连接身份匹配。返回内容副本，之后文件编辑不改变已取得的快照。

instructions 单独交给任务输入装配，description 留给发现；不编写或覆盖 AGENTS.md/CLAUDE.md。公共解析输出 HAPI launchOptions：agent 为实际 flavor，非空 model 原样附加，reasoningEffort 映射为 Codex 的 modelReasoningEffort 或 Claude 的 effort，始终带 disabledMcpServers:['runweft']。不包含权限覆盖、requestId、任务输入或启动 directory；消费者在共享 cwd 或已准备 worktree cwd 启动，并保存定义快照。本 Change 不启动执行。

## 个人绑定与连接

个人绑定存在 `<home>/client.sqlite` 的 agent_runtime_bindings，键为来源身份、现有 connectionName(config)、已认证 namespace，值为 runtimeId 和更新时间；这是用户对定义的选择，不是第二份资源登记。全局定义绑定跨项目使用，全局来源身份为 global/<id>；Git 项目以 realpath(git --git-common-dir) 加 id 标识来源，同仓库 worktree 共享绑定但各读各自定义；非 Git 使用项目根 realpath 加 id。不同 clone 隔离，local 改端口不丢绑定，local 与 hub 即使同 URL 仍隔离。被项目覆盖的全局项不会把自己的绑定传给项目项。

bind 先通过现有 HAPI 认证获取 namespace，再查询指定 runtime，核对当前连接可见和 local 模式本机约束后保存。已知离线或取消登记的目标可以保存引用，但输出当前不可选原因；新任务解析仍严格使用 ResourceClient.resolveExecutionTarget。提供在线批量发现，复用一次 runtimes(all) 查询（每机器一次探测）输出每项选定引用、资格或错误；单项错误不吞掉其他项，不能将批量观察替代派生时的严格解析。绑定优先于文件 runtime，unbind 只删除当前作用域/连接/namespace 的个人绑定，随后回到文件引用；文件为空时明确未绑定。切换连接不复制引用或按名字猜目标。

list/show 离线读取定义及当前连接已有的个人绑定，namespace 明确列出并标注尚未认证，不能把任一历史记录宣称为当前选用。check 认证后只选择精确 namespace 的绑定，或文件声明；缺少有效引用提示 bind，目标失效保留资源错误和明确 ID，不回退其他定义/runtime。与现有 SQLite 表兼容，读取不存在数据库不创建空库；写入才初始化自己的表，保留已有工作区与 hook 数据。

## CLI 与维护

- `agent init <id> [--scope global|project] [--runtime <ID>]`：默认 global，创建带说明 YAML，name 可选；已存在文件明确拒绝覆盖。共享项目可留空 runtime，输出文件与 bind/check 命令。文件本身可离线编辑，无自动安装或启动。
- `agent list`、`agent show <id> [--scope global|project]`：从当前 cwd 发现生效定义、来源和未认证的个人绑定。show 展示完整定义及遮蔽来源。list --check 在线批量检查选用目标；配置或目标错误逐项显示并非零退出。
- `agent validate [id]`：离线检查当前目录可见定义与结构，不查询模型/服务；指定 id 不存在、空列表或解析错误非零（runtime 为空是有效共享定义），空列表给 init 命令。
- `agent check <id> [--scope global|project]`：在线解析定义与新任务目标，成功输出快照、可选参数和模型认证/组合未检查；失败保留 code/message/hint，非零退出。
- `agent bind <id> --runtime <ID> [--scope global|project]`、`agent unbind <id> [--scope global|project]`：默认变更生效来源，显式 scope 可维护被遮蔽项；只变更个人绑定，不修改共享 YAML、机器/runtime 或原生配置。

维护职责直接编辑 init 给出的文件；不引入编辑器进程、同步平台或完整 CRUD 控制台。paths 展示全局定义位置及个人绑定所在库；文档说明项目定位、整体覆盖、解绑、连接更换和 remote 只接收快照而非发起机 home。

## 失败与验证

文件错误按对应 id 报告，目录、数据库和服务错误由顶层明确报告；不静默跳过坏定义、不自动重试写入或选其他目标。init 使用排他创建，避免覆盖已有配置；绑定使用 SQLite 唯一键更新。

文件测试覆盖全局/项目整体覆盖、Git 子目录/独立 worktree/无 Git、空值、重复键与未知字段、来源和内容版本；SQLite/API 组合覆盖连接/namespace/来源隔离、显式绑定/解绑、离线引用与严格解析。CLI 子进程与配套编译程序验证从空配置到完整定义检查、两种 flavor 参数映射和不创建执行副作用。原生模型运行及独立/远端 cwd 的工程配置加载留给已声明消费者，不改 HAPI 或重复无关全量模型测试。
