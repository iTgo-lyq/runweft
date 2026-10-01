# npm Beta tag 发布技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-10-02

## 现状与就绪性

npm-publish.yml 已监听 v*，但 CLI 标签门禁与 isRelease 只接受稳定版本，npm 参数固定 latest，版本前进检查只比较三段稳定整数。网站构建也只接受稳定版本。五包可信 publisher 绑定同一 npm-publish.yml；新增单独工作流会偏离既有授权，采用同一文件内的通道路由。

## 方案

在 Node-only 发布脚本中集中识别规范稳定版本与 X.Y.Z-beta.N，N 为无前导零的非负整数；只接受匹配版本的 push/tag。导出通道和数值版本比较给 CLI 标签检查与聚焦测试使用，避免 CLI 和发布 job 两份标签规则。Beta npm 参数为 --tag=beta，stable 为 --tag=latest；预演也使用对应通道。

正式上传前按核心三段、stable 高于同核心 beta、Beta 数值序号比较：Beta 必须高于当前 beta 与 latest，stable 只检查 latest；同版本允许原候选恢复。导出参数构造与前进检查，预演/上传共用。回执记录 channel 与上传前五包 latest，恢复必须匹配通道；本工作流的新回执无需兼容旧 run 的格式。全部公开确认后核对实际 dist-tags：本通道为目标版本，Beta 的 latest 与上传前相同，写入回执；不一致报出人工检查提示，不自动修改标签。沿用原候选 hash、五包精确依赖、顺序上传/确认与未知状态停止规则。

website-pages.yml 在 Node 24 安装后复用通道识别：稳定版本沿用全部构建/公共 npm/生产或预览步骤；仅 codex/** push/dispatch 的 Beta 执行原聚焦测试、写入 job summary 并跳过静态构建、准备、上传与静态产物。main 或 PR 出现 Beta 版本直接失败，避免误合入后停止生产更新。CLI 标签门禁也移到 Node 24 后，使用共用函数。website/build.mjs 本身保持稳定版本约束，不产生未标明的 Beta 产品站点。

## 操作约定

操作文档保存到维护者开发说明与发行 Specs，不修改属于冻结输入和官网参考源的 docs/usage.md。

从最新 main 创建 codex 开发分支，准备如 1.1.2-beta.1 的根版本与常规说明，提交干净源码后推送同名 v1.1.2-beta.1 tag。工作流发布到 beta；用户通过 runweft@beta 或精确 Beta 版本安装。稳定发布仍准备稳定源码版本与同名 tag。Beta 源版本不合入 main，测试后以稳定版本交付 main。

## 权限、失败与证据

无需新凭证或 workflow 文件；原 GitHub OIDC 与 Cloudflare secrets 不变。全发布工作流仍全局串行。未知上传不改回执强行重发，只核对原 run 与公开版本；新通道不允许跨候选恢复。

在 1.1.1 Change 关闭后实施。验证包括标签格式/通道、Beta 数值前进、稳定防回退、恢复通道与上传次序的聚焦测试、根检查/actionlint及真实 main OIDC/无上传预演。此 Change 不实际推送首个 Beta tag；Beta tag 门禁、beta 参数和官网跳过仅取得聚焦本地证据，main CI 只验证稳定路径，不能描述为真实 Beta 工作流或上传已验证。
